import type { EvidenceTable } from "./copy-integration-internal-types";
import type { CopyIntegrationSource } from "./copy-integration-types";
import { formatContentShare, normalizeContentShares } from "./copy-integration-weights";

export const EXTRACTION_SYSTEM_PROMPT = `你负责从多份素材中提取可核验的原子观点，不负责写母稿。
必须覆盖每份素材中的独立观点、案例和故事，不得整份遗漏；重复观点仍分别保留为事实，再用overlap关系连接。
每条originalQuote必须逐字复制自对应素材，不得改写、拼接或补充。
statement必须是originalQuote中能够独立、完整表达核心意思的一句或连续几句原文，不得只截取单个词，不得改写；当文案内容份额不同时，服务器会用它安全压缩低占比文案的解释细节。
关系只能是overlap、complement、conflict。
具体时间预测归类为exclude_time_prediction；重要但缺乏权威依据的观点归类为evidence_gap；不承载观点的提问过渡、序号或自我表态归类为context_only；其余归类为usable。
context_only也必须逐字登记，保证素材没有被静默遗漏；它只是待用户确认的排除候选，不能在生成阶段直接删除。
严格输出JSON，不要输出解释。`;

export const REVIEW_SYSTEM_PROMPT = `你是独立证据复核员，判断观点是否超出原文支持范围，以及usable、evidence_gap、exclude_time_prediction、context_only分类是否正确。
context_only只能用于完全不承载可复用观点、原因、方法、案例或故事的口播支架，例如序号、承接句或互动问句；只要包含任何实质内容，就必须纠正为usable或evidence_gap，不能借context_only隐藏素材观点。
你必须检查每条Fact是否只表达一个完整观点、一个独立案例或一个完整故事。若把多个可独立使用的观点、原因、方法或案例混成一条，atomicity必须为over_grouped；否则为atomic。
你还必须单独判断statement是否能脱离上下文完整表达originalQuote的核心观点：完整则statementCompleteness为complete；若只是单个词、标题、条件前半句、因果前半句或其他残句，则为incomplete。incomplete不会删除事实，只会让服务器保留完整原文。
你还必须检查关系图是否漏掉、错标或漏判overlap、complement、conflict。已有错误关系应标记rejected；漏掉或类型错误的关系用suggestedRelations补齐。
事实只能返回passed、needs_review或rejected，不得改写证据原文，不得新增事实。只有你确认确实是纯口播支架时，才能返回passed + context_only；不确定时返回needs_review并改为evidence_gap，有实质内容时改为usable或evidence_gap。
严格输出JSON，不要输出解释。`;

export const SYNTHESIS_SYSTEM_PROMPT = `你只负责规划已校验证据的章节顺序和段落分组，不直接撰写正文。
每个未被拒绝的Fact_ID必须出现且只能出现一次。
状态为pending_user_review的Fact_ID必须独占一个section，且该section只能包含这一个Fact_ID的paragraphPlan；它在用户确认前仍属于母稿内容。
只有已声明为同一关系的Fact_ID才能放进同一个paragraphPlan；存在关系的Fact_ID必须放在同一个paragraphPlan。
不得输出标题、正文、连接句、案例、解释或任何其他字段。服务器会用原文证据和固定连接句生成最终母稿。
按目标内容占比安排章节顺序和叙述重心；高占比文案优先成为主叙述来源。比例只影响详略，不得遗漏Fact_ID、裁决冲突或编造内容。
不得生成标题建议、爆款开头、CTA或拍摄建议。
严格输出JSON，不要输出解释。`;

export function buildExtractionPrompt(sources: CopyIntegrationSource[], instruction: string): string {
  const shares = new Map(normalizeContentShares(sources).map(item => [item.sourceId, item]));
  const materials = sources.map((source, index) => `【文案${index + 1}：${source.name}】\nid：${source.id}\n目标内容占比：${formatContentShare(shares.get(source.id)?.sharePercent ?? 0)}\n正文：\n${source.content}`).join("\n\n");
  return `${materials}${instruction ? `\n\n用户补充整理要求：${instruction}` : ""}\n\n输出结构：\n{\n  "facts": [{ "id": "F01", "statement": "观点摘要", "originalQuote": "素材逐字原文", "sourceId": "source-1", "classification": "usable", "confidence": "high" }],\n  "relations": [{ "id": "R01", "type": "complement", "factIds": ["F01", "F02"], "summary": "关系说明" }]\n}`;
}

export function buildReviewPrompt(table: EvidenceTable): string {
  return `请复核以下证据及观点关系。\n${JSON.stringify({
    targetContentShares: normalizeContentShares(table.sources).map(item => ({
      sourceId: item.sourceId,
      sharePercent: Math.round(item.sharePercent * 10) / 10,
    })),
    facts: table.facts.map(fact => ({
      id: fact.id,
      statement: fact.statement,
      originalQuote: fact.originalQuote,
      sourceId: fact.sourceId,
      classification: fact.classification,
    })),
    relations: table.relations,
  })}\n\n输出结构：\n{ "decisions": [{ "factId": "F01", "decision": "passed", "classification": "usable", "atomicity": "atomic", "statementCompleteness": "complete", "reason": "简要理由" }], "relationDecisions": [{ "relationId": "R01", "decision": "passed", "reason": "简要理由" }], "suggestedRelations": [{ "id": "RR01", "type": "complement", "factIds": ["F01", "F02"], "summary": "简要关系说明" }] }`;
}

export function buildSynthesisPrompt(table: EvidenceTable, instruction: string): string {
  const targetContentShares = normalizeContentShares(table.sources).map(item => ({
      sourceId: item.sourceId,
      sharePercent: Math.round(item.sharePercent * 10) / 10,
    }));
  return `请根据以下已校验证据规划母稿结构。\n目标内容占比：${JSON.stringify(targetContentShares)}\n${JSON.stringify({
    targetContentShares,
    facts: table.facts
      .filter(fact => fact.status !== "rejected")
      .map(fact => ({
        id: fact.id,
        statement: fact.statement,
        originalQuote: fact.originalQuote,
        sourceId: fact.sourceId,
        status: fact.status,
      })),
    relations: table.relations,
  })}${instruction ? `\n\n用户补充的组织顺序要求：${instruction}` : ""}\n\n输出结构：\n{ "draft": { "sections": [{ "paragraphPlans": [{ "factIds": ["F01", "F02"] }] }] } }`;
}
