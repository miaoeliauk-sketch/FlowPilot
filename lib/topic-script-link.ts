import { addScriptAsset, getTopicAsset } from "./ip-store";
import type { ScriptAsset, TopicAsset } from "./types";

export class TopicScriptLinkError extends Error {
  readonly code:
    | "INVALID_TOPIC_ID"
    | "INVALID_IP_ID"
    | "TOPIC_NOT_FOUND"
    | "TOPIC_NOT_ELIGIBLE"
    | "TOPIC_IP_MISMATCH";

  constructor(code: TopicScriptLinkError["code"], message: string) {
    super(message);
    this.name = "TopicScriptLinkError";
    this.code = code;
  }
}

export type TopicLinkedScriptInput = Omit<
  ScriptAsset,
  "id" | "createdAt" | "topicId"
> & {
  topicId: string;
};

export function resolveTopicForScript(
  topicId: string,
  activeIPId: string,
): TopicAsset;
export function resolveTopicForScript(
  topicIdInput: unknown,
  activeIPIdInput: unknown,
): TopicAsset {
  if (typeof topicIdInput !== "string" || !topicIdInput.trim()) {
    throw new TopicScriptLinkError(
      "INVALID_TOPIC_ID",
      "选题ID格式不正确",
    );
  }
  if (typeof activeIPIdInput !== "string" || !activeIPIdInput.trim()) {
    throw new TopicScriptLinkError(
      "INVALID_IP_ID",
      "当前操盘IP缺少有效ID",
    );
  }
  const topicId = topicIdInput.trim();
  const activeIPId = activeIPIdInput.trim();
  const topic = getTopicAsset(topicId);
  if (!topic) {
    throw new TopicScriptLinkError(
      "TOPIC_NOT_FOUND",
      "没有找到要带入脚本工厂的选题",
    );
  }
  if (
    (topic.status !== "已评估" && topic.status !== "已采用") ||
    !topic.boardResult
  ) {
    throw new TopicScriptLinkError(
      "TOPIC_NOT_ELIGIBLE",
      "只有已评估或已采用且评估结果完整的选题才能生成脚本",
    );
  }
  if (topic.ipId !== activeIPId) {
    throw new TopicScriptLinkError(
      "TOPIC_IP_MISMATCH",
      "选题所属IP与当前操盘IP不一致，已阻止关联",
    );
  }
  return topic;
}

export function addScriptAssetForTopic(
  input: TopicLinkedScriptInput,
): ScriptAsset {
  const topic = resolveTopicForScript(input.topicId, input.ipId);
  return addScriptAsset({
    ...input,
    topicId: topic.id,
    ipId: topic.ipId,
  });
}
