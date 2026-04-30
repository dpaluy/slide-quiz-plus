import {
  broadcastTo,
  handlePost,
  jsonResponse,
  syncStream,
  validateSyncBody,
} from "./_shared";

export const onRequest = handlePost(validateSyncBody, async (body, env) => {
  console.log("[quiz-sync]", {
    activeQuestionId: body.activeQuestionId,
    quizGroupId: body.quizGroupId,
    questionIndex: body.questionIndex,
    totalCount: body.totalCount,
  });

  try {
    await broadcastTo(env, syncStream(body.quizGroupId), {
      activeQuestionId: body.activeQuestionId,
      sessionId: body.sessionId,
      results: body.results,
      question: body.question,
      questionIndex: body.questionIndex,
      totalCount: body.totalCount,
    });
    console.log("[quiz-sync] broadcast ok");
  } catch (err) {
    console.error("[quiz-sync] broadcast failed:", err);
    return jsonResponse({ error: "Broadcast failed" }, 502);
  }

  return jsonResponse({ ok: true });
});
