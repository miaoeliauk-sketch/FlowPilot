import type { EvidenceTable } from "./copy-integration-internal-types";
import type { CopyIntegrationSource } from "./copy-integration-types";

export const EXTRACTION_SYSTEM_PROMPT = `你负责从多份素材中提取可核验的原子观点，不负责写母稿。
必须覆盖每份素材中的独立观点、案例和故事，不得整份遗漏；重复观点仍分别保留为事实，再用overlap关系连接。
每条originalQuote必须逐字复制自对应素材，不得改写、拼接或补充。
关系只能是overlap、complement、conflict。
具体时间预测归类为exclude_time_prediction；重要但缺乏权威依据的观点归类为evidence_gap；其余归类为usable。
严格输出JSON，不要输出解释。`;

export const REVIEW_SYSTEM_PROMPT = `你是独立证据复核员，判断观点是否超出原文支持范围，以及usable、evidence_gap、exclude_time_prediction分类是否正确。
你必须检查每条Fact是否只表达一个完整观点、一个独立案例或一个完整故事。若把多个可独立使用的观点、原因、方法或案例混成一条，atomicity必须为over_grouped；否则为atomic。
你还必须检查关系图是否漏掉、错标或漏判overlap、complement、conflict。已有错误关系应标记rejected；漏掉或类型错误的关系用suggestedRelations补齐。
事实只能返回passed、needs_review或rejected，不得改写证据原文，不得新增事实。
严格输出JSON，不要输出解释。`;

export const SYNTHESIS_SYSTEM_PROMPT = `你只负责规划已校验证据的章节顺序和段落分组，不直接撰写正文。
每个未被拒绝的Fact_ID必须出现且只能出现一次。
只有已声明为同一关系的Fact_ID才能放进同一个paragraphPlan；存在关系的Fact_ID必须放在同一个paragraphPlan。
不得输出标题、正文、连接句、案例、解释或任何其他字段。服务器会用原文证据和固定连接句生成最终母稿。
不得生成标题建议、爆款开头、CTA或拍摄建议。
严格输出JSON，不要输出解释。`;

export function buildExtractionPrompt(sources: CopyIntegrationSource[], instruction: string): string {
  const materials = sources.map((source, index) => `【素材${index + 1}】\nid：${source.id}\n正文：\n${source.content}`).join("\n\n");
  return `${materials}${instruction ? `\n\n用户补充整理要求：${instruction}` : ""}\n\n输出结构：\n{\n  "facts": [{ "id": "F01", "statement": "观点摘要", "originalQuote": "素材逐字原文", "sourceId": "source-1", "classification": "usable", "confidence": "high" }],\n  "relations": [{ "id": "R01", "type": "complement", "factIds": ["F01", "F02"], "summary": "关系说明" }]\n}`;
}

export function buildReviewPrompt(table: EvidenceTable): string {
  return `请复核以下证据及观点关系。\n${JSON.stringify({
    facts: table.facts.map(fact => ({
      id: fact.id,
      statement: fact.statement,
      originalQuote: fact.originalQuote,
      sourceId: fact.sourceId,
      classification: fact.classification,
    })),
    relations: table.relations,
  })}\n\n输出结构：\n{ "decisions": [{ "factId": "F01", "decision": "passed", "classification": "usable", "atomicity": "atomic", "reason": "简要理由" }], "relationDecisions": [{ "relationId": "R01", "decision": "passed", "reason": "简要理由" }], "suggestedRelations": [{ "id": "RR01", "type": "complement", "factIds": ["F01", "F02"], "summary": "简要关系说明" }] }`;
}

export function buildSynthesisPrompt(table: EvidenceTable, instruction: string): string {
  return `请根据以下已校验证据规划母稿结构。\n${JSON.stringify({
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
