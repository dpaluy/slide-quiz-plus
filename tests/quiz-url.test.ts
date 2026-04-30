import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_URL_PARAMS,
  buildParticipantQuizUrl,
  formatQuizUrlDisplay,
  participantConfigFromUrlParams,
} from "../src/quiz-url";

describe("quiz URL helpers", () => {
  it("builds a participant URL with connection params", () => {
    const result = buildParticipantQuizUrl("/quiz.html", {
      wsUrl: "wss://slides.example.com/cable",
      quizGroupId: "conf-2026",
    }, "https://talk.example.com");

    const url = new URL(result!);
    expect(url.origin + url.pathname).toBe("https://talk.example.com/quiz.html");
    expect(url.searchParams.get(PARTICIPANT_URL_PARAMS.wsUrl)).toBe("wss://slides.example.com/cable");
    expect(url.searchParams.get(PARTICIPANT_URL_PARAMS.quizGroupId)).toBe("conf-2026");
  });

  it("preserves existing query params and includes custom endpoints", () => {
    const result = buildParticipantQuizUrl("https://talk.example.com/quiz.html?theme=seriph", {
      wsUrl: "wss://slides.example.com/cable",
      quizGroupId: "rbq-conf",
      endpoints: {
        answer: "/api/quiz-answer",
        sync: "/api/quiz-sync",
      },
    });

    const url = new URL(result!);
    expect(url.searchParams.get("theme")).toBe("seriph");
    expect(url.searchParams.get(PARTICIPANT_URL_PARAMS.answerEndpoint)).toBe("/api/quiz-answer");
    expect(url.searchParams.get(PARTICIPANT_URL_PARAMS.syncEndpoint)).toBe("/api/quiz-sync");
  });

  it("formats the display URL without protocol or query params", () => {
    expect(formatQuizUrlDisplay("https://talk.example.com/quiz.html?wsUrl=ignored")).toBe(
      "talk.example.com/quiz.html",
    );
  });

  it("extracts participant config from URL params", () => {
    const params = new URLSearchParams({
      [PARTICIPANT_URL_PARAMS.wsUrl]: "wss://slides.example.com/cable",
      [PARTICIPANT_URL_PARAMS.quizGroupId]: "speaker-notes",
      [PARTICIPANT_URL_PARAMS.answerEndpoint]: "/api/quiz-answer",
      [PARTICIPANT_URL_PARAMS.syncEndpoint]: "/api/quiz-sync",
    });

    expect(participantConfigFromUrlParams(params)).toEqual({
      wsUrl: "wss://slides.example.com/cable",
      quizGroupId: "speaker-notes",
      endpoints: {
        answer: "/api/quiz-answer",
        sync: "/api/quiz-sync",
      },
    });
  });
});
