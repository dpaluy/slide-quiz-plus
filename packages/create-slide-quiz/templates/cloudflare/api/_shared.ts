interface Env {
  ANYCABLE_BROADCAST_URL?: string;
  ANYCABLE_BROADCAST_KEY?: string;
}

interface QuizOption {
  label: string;
  text: string;
}

interface QuestionPayload {
  quizId: string;
  question: string;
  type?: "choice" | "text";
  options?: QuizOption[];
}

interface VoteState {
  votes: Record<string, number>;
  total: number;
}

export interface AnswerBody {
  quizId: string;
  answer: string;
  sessionId: string;
  quizGroupId: string;
}

export interface SyncBody {
  activeQuestionId?: string | null;
  sessionId: string;
  quizGroupId: string;
  results: Record<string, VoteState>;
  question?: QuestionPayload;
  questionIndex?: number;
  totalCount?: number;
}

interface PagesContext {
  request: Request;
  env: Env;
}

type PagesHandler = (context: PagesContext) => Promise<Response>;
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidField(field: string): ValidationResult<never> {
  return {
    ok: false,
    response: jsonResponse({ error: `Invalid field: ${field}` }, 400),
  };
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string> {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidField(field);
  }

  return { ok: true, value };
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string | undefined> {
  const value = body[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") return invalidField(field);
  return { ok: true, value };
}

function optionalNullableString(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<string | null | undefined> {
  const value = body[field];
  if (value === undefined || value === null) return { ok: true, value };
  if (typeof value !== "string") return invalidField(field);
  return { ok: true, value };
}

function optionalNumber(
  body: Record<string, unknown>,
  field: string,
): ValidationResult<number | undefined> {
  const value = body[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalidField(field);
  }
  return { ok: true, value };
}

function isOption(value: unknown): value is QuizOption {
  return isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.text === "string";
}

function isQuestionPayload(value: unknown): value is QuestionPayload {
  if (!isRecord(value)) return false;
  if (typeof value.quizId !== "string" || typeof value.question !== "string") {
    return false;
  }

  if (value.type !== undefined && value.type !== "choice" && value.type !== "text") {
    return false;
  }

  if (value.options !== undefined) {
    if (!Array.isArray(value.options) || !value.options.every(isOption)) {
      return false;
    }
  }

  return true;
}

function isVoteState(value: unknown): value is VoteState {
  if (!isRecord(value) || typeof value.total !== "number" || !Number.isFinite(value.total)) {
    return false;
  }

  if (!isRecord(value.votes)) return false;

  return Object.values(value.votes).every(
    (count) => typeof count === "number" && Number.isFinite(count),
  );
}

function isResultsMap(value: unknown): value is Record<string, VoteState> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isVoteState);
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function resultsStream(quizGroupId: string): string {
  return `quiz:${quizGroupId}:results`;
}

export function syncStream(quizGroupId: string): string {
  return `quiz:${quizGroupId}:sync`;
}

export async function broadcastTo(
  env: Env,
  stream: string,
  data: Record<string, unknown>,
): Promise<void> {
  const url = env.ANYCABLE_BROADCAST_URL;
  if (!url) throw new Error("ANYCABLE_BROADCAST_URL not set");

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (env.ANYCABLE_BROADCAST_KEY) {
    headers.Authorization = `Bearer ${env.ANYCABLE_BROADCAST_KEY}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ stream, data: JSON.stringify(data) }),
  });

  if (!res.ok) {
    throw new Error(`Broadcast failed: ${res.status} ${res.statusText}`);
  }
}

export function validateAnswerBody(body: unknown): ValidationResult<AnswerBody> {
  if (!isRecord(body)) return invalidField("body");

  const quizId = requiredString(body, "quizId");
  if (!quizId.ok) return quizId;

  const answer = requiredString(body, "answer");
  if (!answer.ok) return answer;

  const sessionId = requiredString(body, "sessionId");
  if (!sessionId.ok) return sessionId;

  const quizGroupId = requiredString(body, "quizGroupId");
  if (!quizGroupId.ok) return quizGroupId;

  return {
    ok: true,
    value: {
      quizId: quizId.value,
      answer: answer.value,
      sessionId: sessionId.value,
      quizGroupId: quizGroupId.value,
    },
  };
}

export function validateSyncBody(body: unknown): ValidationResult<SyncBody> {
  if (!isRecord(body)) return invalidField("body");

  const activeQuestionId = optionalNullableString(body, "activeQuestionId");
  if (!activeQuestionId.ok) return activeQuestionId;

  const sessionId = requiredString(body, "sessionId");
  if (!sessionId.ok) return sessionId;

  const quizGroupId = requiredString(body, "quizGroupId");
  if (!quizGroupId.ok) return quizGroupId;

  if (!isResultsMap(body.results)) return invalidField("results");

  const question = body.question;
  if (question !== undefined && !isQuestionPayload(question)) {
    return invalidField("question");
  }

  const questionIndex = optionalNumber(body, "questionIndex");
  if (!questionIndex.ok) return questionIndex;

  const totalCount = optionalNumber(body, "totalCount");
  if (!totalCount.ok) return totalCount;

  return {
    ok: true,
    value: {
      activeQuestionId: activeQuestionId.value,
      sessionId: sessionId.value,
      quizGroupId: quizGroupId.value,
      results: body.results,
      question: question as QuestionPayload | undefined,
      questionIndex: questionIndex.value,
      totalCount: totalCount.value,
    },
  };
}

export function handlePost<T>(
  validate: (body: unknown) => ValidationResult<T>,
  handler: (body: T, env: Env) => Promise<Response>,
): PagesHandler {
  return async (context) => {
    if (context.request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (context.request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const validated = validate(body);
    if (!validated.ok) return validated.response;

    return handler(validated.value, context.env);
  };
}
