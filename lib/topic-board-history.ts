import { addEvaluatedTopicAsset } from "./ip-store";
import { parseTopicBoardResult } from "./topic-board-contract";
import type { IPProfile, TopicAsset } from "./types";

export class TopicBoardOwnershipError extends Error {
  readonly code = "IP_ASSIGNMENT_MISMATCH" as const;

  constructor(requestIPId: string, responseIPId: string) {
    super(`评估结果所属IP（${responseIPId}）与发起请求的IP（${requestIPId}）不一致`);
    this.name = "TopicBoardOwnershipError";
  }
}

export function saveTopicBoardEvaluation(
  requestIP: Pick<IPProfile, "id">,
  responseBody: unknown,
): TopicAsset {
  const boardResult = parseTopicBoardResult(responseBody);
  if (boardResult.ipId !== requestIP.id) {
    throw new TopicBoardOwnershipError(requestIP.id, boardResult.ipId);
  }

  return addEvaluatedTopicAsset({
    ipId: requestIP.id,
    title: boardResult.topic,
    source: "manual",
  }, boardResult);
}
