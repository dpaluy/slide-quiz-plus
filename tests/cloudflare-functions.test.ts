import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest as quizAnswer } from "../functions/cloudflare/api/quiz-answer";
import { onRequest as quizSync } from "../functions/cloudflare/api/quiz-sync";

const ENV = {
  ANYCABLE_BROADCAST_URL: "https://broadcast.example/_broadcast",
  ANYCABLE_BROADCAST_KEY: "secret-key",
};

function createContext(
  pathname: string,
  {
    method = "POST",
    body,
    env = ENV,
  }: {
    method?: string;
    body?: unknown;
    env?: typeof ENV | {};
  } = {},
) {
  const init: RequestInit = { method };

  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  return {
    request: new Request(`https://talk.example${pathname}`, init),
    env,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cloudflare Pages quiz functions", () => {
  it("handles CORS preflight requests", async () => {
    const res = await quizAnswer(createContext("/api/quiz-answer", { method: "OPTIONS" }));

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects invalid answer payloads", async () => {
    const res = await quizAnswer(createContext("/api/quiz-answer", {
      body: {
        quizId: "q1",
        answer: "",
        sessionId: "session-1",
        quizGroupId: "group-1",
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid field: answer" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("broadcasts answers to AnyCable with an auth header when configured", async () => {
    const res = await quizAnswer(createContext("/api/quiz-answer", {
      body: {
        quizId: "q1",
        answer: "A",
        sessionId: "session-1",
        quizGroupId: "group-1",
      },
    }));

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      ENV.ANYCABLE_BROADCAST_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${ENV.ANYCABLE_BROADCAST_KEY}`,
        }),
      }),
    );

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      stream: "quiz:group-1:results",
      data: JSON.stringify({
        quizId: "q1",
        answer: "A",
        sessionId: "session-1",
      }),
    });
  });

  it("rejects malformed sync payloads", async () => {
    const res = await quizSync(createContext("/api/quiz-sync", {
      body: {
        activeQuestionId: "q1",
        sessionId: "session-1",
        quizGroupId: "group-1",
        results: [],
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid field: results" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 502 when a broadcast fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    const res = await quizSync(createContext("/api/quiz-sync", {
      body: {
        activeQuestionId: "q1",
        sessionId: "session-1",
        quizGroupId: "group-1",
        results: {
          q1: {
            votes: { A: 1 },
            total: 1,
          },
        },
        question: {
          quizId: "q1",
          question: "Where are you deploying?",
          type: "choice",
          options: [{ label: "A", text: "Cloudflare" }],
        },
        questionIndex: 0,
        totalCount: 1,
      },
    }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Broadcast failed" });
  });

  it("rejects unsupported methods with 405", async () => {
    const res = await quizSync(createContext("/api/quiz-sync", { method: "GET" }));

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });
});
