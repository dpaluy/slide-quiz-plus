import {
  broadcastTo,
  handlePost,
  jsonResponse,
  resultsStream,
  validateAnswerBody,
} from "./_shared";

export const onRequest = handlePost(validateAnswerBody, async (body, env) => {
  console.log("[quiz-answer]", {
    quizId: body.quizId,
    answer: body.answer,
    quizGroupId: body.quizGroupId,
  });

  try {
    await broadcastTo(env, resultsStream(body.quizGroupId), {
      quizId: body.quizId,
      answer: body.answer,
      sessionId: body.sessionId,
    });
    console.log("[quiz-answer] broadcast ok");
  } catch (err) {
    console.error("[quiz-answer] broadcast failed:", err);
    return jsonResponse({ error: "Broadcast failed" }, 502);
  }

  return jsonResponse({ ok: true });
});
