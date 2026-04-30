import type { ParticipantConfig, QuizEndpoints } from "./quiz-types";

const FALLBACK_ORIGIN = "http://localhost";

export const PARTICIPANT_URL_PARAMS = {
  wsUrl: "wsUrl",
  quizGroupId: "quizGroupId",
  answerEndpoint: "answerEndpoint",
  syncEndpoint: "syncEndpoint",
} as const;

type ParticipantLinkConfig = Pick<ParticipantConfig, "wsUrl" | "quizGroupId" | "endpoints">;

function getBaseOrigin(baseOrigin?: string): string {
  if (baseOrigin) return baseOrigin;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return FALLBACK_ORIGIN;
}

function buildEndpointParams(endpoints?: Partial<QuizEndpoints>): URLSearchParams {
  const params = new URLSearchParams();

  if (endpoints?.answer) {
    params.set(PARTICIPANT_URL_PARAMS.answerEndpoint, endpoints.answer);
  }

  if (endpoints?.sync) {
    params.set(PARTICIPANT_URL_PARAMS.syncEndpoint, endpoints.sync);
  }

  return params;
}

export function buildParticipantQuizUrl(
  quizUrl: string | undefined,
  config: ParticipantLinkConfig | undefined,
  baseOrigin?: string,
): string | undefined {
  if (!quizUrl || !config) return quizUrl;

  const url = new URL(quizUrl, getBaseOrigin(baseOrigin));
  url.searchParams.set(PARTICIPANT_URL_PARAMS.wsUrl, config.wsUrl);
  url.searchParams.set(PARTICIPANT_URL_PARAMS.quizGroupId, config.quizGroupId);

  for (const [key, value] of buildEndpointParams(config.endpoints)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export function formatQuizUrlDisplay(
  quizUrl: string | undefined,
  baseOrigin?: string,
): string {
  if (!quizUrl) return "";

  const url = new URL(quizUrl, getBaseOrigin(baseOrigin));
  return `${url.host}${url.pathname}`;
}

export function participantConfigFromUrlParams(
  params: URLSearchParams,
): Pick<ParticipantConfig, "wsUrl" | "quizGroupId" | "endpoints"> {
  const endpoints: Partial<QuizEndpoints> = {};
  const answer = params.get(PARTICIPANT_URL_PARAMS.answerEndpoint);
  const sync = params.get(PARTICIPANT_URL_PARAMS.syncEndpoint);

  if (answer) endpoints.answer = answer;
  if (sync) endpoints.sync = sync;

  return {
    wsUrl: params.get(PARTICIPANT_URL_PARAMS.wsUrl) || "",
    quizGroupId: params.get(PARTICIPANT_URL_PARAMS.quizGroupId) || "",
    endpoints: Object.keys(endpoints).length > 0 ? endpoints : undefined,
  };
}
