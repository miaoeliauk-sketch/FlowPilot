import type { CognitionHumanRevision, IPSourceAnalysisV2 } from "./types";
import { parseStoredIPSourceAnalysis } from "./ip-source-analysis-v2";

export type CognitionReviewAction =
  | { type: "confirm"; nodeId: string }
  | { type: "reject"; nodeId: string }
  | {
      type: "revise";
      nodeId: string;
      humanRevision: Omit<CognitionHumanRevision, "updatedAt">;
    };

export interface ApplyCognitionReviewInput {
  sourceId: string;
  rawContent: string;
  analysis: unknown;
  action: CognitionReviewAction;
}

export function applyCognitionReview(input: ApplyCognitionReviewInput): IPSourceAnalysisV2 {
  const parsed = parseStoredIPSourceAnalysis(input.analysis, input.rawContent, input.sourceId);
  if (!parsed.ok) throw new Error(parsed.error);
  if (parsed.version !== 2) throw new Error("旧版解析不能使用V2认知审核入口");
  const node = parsed.analysis.nodes.find(item => item.id === input.action.nodeId);
  if (!node) throw new Error("找不到要审核的认知节点");
  const action = input.action;

  const nextNode = (() => {
    if (action.type === "reject") {
      const { humanRevision: _discardedRevision, ...originalNode } = node;
      return { ...originalNode, reviewStatus: "rejected" as const };
    }
    if (action.type === "confirm") {
      return { ...node, reviewStatus: "human_confirmed" as const };
    }
    const claim = action.humanRevision.claim?.trim();
    const reasoningSteps = action.humanRevision.reasoningSteps?.map(step => ({
      order: step.order,
      content: step.content.trim(),
    }));
    if (!claim && (!reasoningSteps || reasoningSteps.length === 0)) {
      throw new Error("人工修订内容不能为空");
    }
    return {
      ...node,
      reviewStatus: "human_confirmed" as const,
      humanRevision: {
        ...(claim ? { claim } : {}),
        ...(reasoningSteps?.length ? { reasoningSteps } : {}),
        updatedAt: new Date().toISOString(),
      },
    };
  })();
  const nextAnalysis: IPSourceAnalysisV2 = {
    ...parsed.analysis,
    nodes: parsed.analysis.nodes.map(item => item.id === node.id ? nextNode : item),
  };
  const verified = parseStoredIPSourceAnalysis(nextAnalysis, input.rawContent, input.sourceId);
  if (!verified.ok || verified.version !== 2) {
    throw new Error(verified.ok ? "人工审核结果版本错误" : verified.error);
  }
  return verified.analysis;
}
