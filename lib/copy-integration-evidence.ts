import { createHash } from "node:crypto";
import type {
  EvidenceClassification,
  EvidenceConfidence,
  EvidenceFact,
  EvidenceFactCandidate,
  EvidenceRelation,
  EvidenceRelationType,
  EvidenceReviewResult,
  EvidenceStatus,
  EvidenceTable,
  SynthesisResult,
} from "./copy-integration-internal-types";
import type { CopyIntegrationSource } from "./copy-integration-types";

export class CopyIntegrationValidationError extends Error {
  readonly diagnosticCode: string;

  constructor(diagnosticCode: string, message: string) {
    super(message);
    this.name = "CopyIntegrationValidationError";
    this.diagnosticCode = diagnosticCode;
  }
}

function fail(code: string, message: string): never {
  throw new CopyIntegrationValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail("INVALID_FIELD", `${field}无效`);
  return value.trim();
}

function parseJsonObject(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    fail("INVALID_JSON", "模型输出不是有效JSON");
  }
  if (!isRecord(parsed)) fail("INVALID_ROOT", "模型输出根节点无效");
  return parsed;
}

function normalizedWithRawIndexes(text: string) {
  let normalized = "";
  const rawIndexes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (/\s/u.test(text[index])) continue;
    normalized += text[index];
    rawIndexes.push(index);
  }
  return { normalized, rawIndexes };
}

export function strictMatch(source: string, originalQuote: string) {
  const sourceMap = normalizedWithRawIndexes(source);
  const quoteMap = normalizedWithRawIndexes(originalQuote);
  if (!quoteMap.normalized) fail("EMPTY_ORIGINAL_QUOTE", "原文引文不能为空");
  const normalizedStart = sourceMap.normalized.indexOf(quoteMap.normalized);
  if (normalizedStart < 0) fail("ORIGINAL_QUOTE_NOT_FOUND", "原文引文未在素材中找到");
  const rawStart = sourceMap.rawIndexes[normalizedStart];
  const rawEndIndex = sourceMap.rawIndexes[normalizedStart + quoteMap.normalized.length - 1];
  if (rawStart === undefined || rawEndIndex === undefined) {
    fail("ORIGINAL_QUOTE_NOT_FOUND", "原文引文位置无效");
  }
  return {
    quoteStart: rawStart,
    quoteEnd: rawEndIndex + 1,
    sourceHash: createHash("sha256").update(source).digest("hex"),
  };
}

const CLASSIFICATIONS = new Set<EvidenceClassification>([
  "usable", "evidence_gap", "exclude_time_prediction", "context_only",
]);
const CONFIDENCES = new Set<EvidenceConfidence>(["high", "medium", "low"]);
const RELATION_TYPES = new Set<EvidenceRelationType>(["overlap", "complement", "conflict"]);

function hasConcreteTimeReference(text: string): boolean {
  return /(?:20\d{2}年(?:\d{1,2}月)?|\d{1,2}月份?|\d{1,2}月\d{1,2}日|(?:今|明|后|大后)(?:天|晚|早)|今年(?:年底)?|明年|年底|月底|年内|(?:本|这|下|下下)(?:周|星期|礼拜|月|季度|半年)|上半年|下半年|周[一二三四五六日天]|星期[一二三四五六日天]|未来\d+(?:年|月|天)|近期|届时)/u.test(text);
}

function looksLikeUnsupportedTimePrediction(text: string): boolean {
  if (!hasConcreteTimeReference(text)) return false;
  const hasUnsupportedProphecy = /(?:神|灵魂|能量|命运|时代).{0,16}(?:归位|觉醒|转折|巨变|灾难|终结|重启)/u.test(text);
  if (hasUnsupportedProphecy) return true;
  const hasGroundedSchedule = /(?:公告|通知|合同|日程|已发布|已确定|按计划|按安排)/u.test(text);
  if (hasGroundedSchedule) return false;
  const hasFutureAssertion = /(?:将|将会|必将|预计|预测|预言|届时|会|一定(?:会)?|必然(?:会)?|注定(?:会)?|肯定(?:会)?)/u.test(text);
  return hasFutureAssertion || hasUnsupportedProphecy;
}

const SUPPORT_STOP_CHARACTERS = new Set("的了是和与也而在把被将为对从到中上下一其该就又都".split(""));
function normalizeSupportText(text: string): string {
  return text
    .replace(/(?:两份|多份|双方|各份)?素材(?:都|分别)?(?:认为|指出|提到|说明|强调)?/gu, "")
    .replace(/(?:这部分说法)?.{0,12}(?:缺乏|缺少|没有|尚无|暂无|不足|未经|尚未).{0,24}(?:来源|依据|证据|研究|支持|验证|核实|核验|证实).{0,24}(?:建议|需要|需|应).{0,12}(?:使用前)?(?:核实|验证|查证|确认|核验)/gu, "")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

function supportUnits(text: string): { characters: Set<string>; bigrams: Set<string> } {
  const normalized = normalizeSupportText(text);
  const characters = new Set([...normalized].filter(character => !SUPPORT_STOP_CHARACTERS.has(character)));
  const compact = [...normalized].filter(character => !SUPPORT_STOP_CHARACTERS.has(character)).join("");
  const bigrams = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.add(compact.slice(index, index + 2));
  }
  return { characters, bigrams };
}

function supportCoverage(claim: string, evidence: string): { characterCoverage: number; bigramCoverage: number } {
  const claimUnits = supportUnits(claim);
  if (claimUnits.characters.size < 2) return { characterCoverage: 0, bigramCoverage: 0 };
  const evidenceUnits = supportUnits(evidence);
  const matchedCharacters = [...claimUnits.characters].filter(character => evidenceUnits.characters.has(character)).length;
  const characterCoverage = matchedCharacters / claimUnits.characters.size;
  const matchedBigrams = [...claimUnits.bigrams].filter(bigram => evidenceUnits.bigrams.has(bigram)).length;
  const bigramCoverage = claimUnits.bigrams.size === 0 ? 1 : matchedBigrams / claimUnits.bigrams.size;
  return { characterCoverage, bigramCoverage };
}

function isStatementExtractive(statement: string, originalQuote: string): boolean {
  const normalizedStatement = normalizedWithRawIndexes(statement).normalized;
  const normalizedQuote = normalizedWithRawIndexes(originalQuote).normalized;
  return normalizedStatement.length > 0 && normalizedQuote.includes(normalizedStatement);
}

function hasCertaintyEscalation(statement: string, originalQuote: string): boolean {
  const certaintyWords = ["一定", "必然", "必定", "肯定", "绝对", "注定", "永久", "永远", "从不", "毫无疑问"];
  return certaintyWords.some(word => statement.includes(word) && !originalQuote.includes(word));
}

function looksPotentiallyOverGrouped(text: string): boolean {
  const sentenceCount = text.split(/[。！？!?；;\n]+/u).filter(part => /[\p{L}\p{N}]/u.test(part)).length;
  return sentenceCount > 1 ||
    /(?:第一|首先).{2,}(?:第二|其次)|(?:第二|其次).{2,}(?:第三|再次)/u.test(text) ||
    /(?:而且|并且|同时|另外|此外|另一方面|但是|然而|不过|可是|所以|因此|方法是|原因是)/u.test(text) ||
    normalizedWithRawIndexes(text).normalized.length > 120;
}

function relationLooksObvious(first: EvidenceFact, second: EvidenceFact): boolean {
  const forward = supportCoverage(first.originalQuote, second.originalQuote);
  const backward = supportCoverage(second.originalQuote, first.originalQuote);
  return (
    forward.characterCoverage >= 0.5 && forward.bigramCoverage >= 0.15
  ) || (
    backward.characterCoverage >= 0.5 && backward.bigramCoverage >= 0.15
  );
}

function validateSourceCoverage(sources: CopyIntegrationSource[], facts: EvidenceFact[]): void {
  for (const source of sources) {
    const sourceFacts = facts.filter(fact => fact.sourceId === source.id);
    if (sourceFacts.length === 0) fail("SOURCE_EVIDENCE_MISSING", "每份素材都必须至少提取一条原子观点");
    for (let index = 0; index < source.content.length; index += 1) {
      if (!/[\p{L}\p{N}]/u.test(source.content[index])) continue;
      if (!sourceFacts.some(fact => index >= fact.quoteStart && index < fact.quoteEnd)) {
        fail("SOURCE_CONTENT_OMITTED", "素材中存在未被证据覆盖的独立内容");
      }
    }
  }
}

export function parseAndValidateEvidenceExtraction(
  content: string,
  sources: CopyIntegrationSource[],
): EvidenceTable {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.facts) || parsed.facts.length === 0 || !Array.isArray(parsed.relations)) {
    fail("INVALID_EVIDENCE_STRUCTURE", "证据提取结构无效");
  }
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const factIds = new Set<string>();
  const facts = parsed.facts.map((rawFact, index): EvidenceFact => {
    if (!isRecord(rawFact)) fail("INVALID_FACT", `facts[${index}]无效`);
    const candidate: EvidenceFactCandidate = {
      id: requiredString(rawFact.id, `facts[${index}].id`),
      statement: requiredString(rawFact.statement, `facts[${index}].statement`),
      originalQuote: requiredString(rawFact.originalQuote, `facts[${index}].originalQuote`),
      sourceId: requiredString(rawFact.sourceId, `facts[${index}].sourceId`),
      classification: requiredString(rawFact.classification, `facts[${index}].classification`) as EvidenceClassification,
      confidence: requiredString(rawFact.confidence, `facts[${index}].confidence`) as EvidenceConfidence,
    };
    if (!/^F\d{2,}$/.test(candidate.id) || factIds.has(candidate.id)) fail("INVALID_FACT_ID", "Fact_ID无效或重复");
    if (!CLASSIFICATIONS.has(candidate.classification) || !CONFIDENCES.has(candidate.confidence)) {
      fail("INVALID_FACT_CLASSIFICATION", "证据分类或置信度无效");
    }
    const source = sourceMap.get(candidate.sourceId);
    if (!source) fail("UNKNOWN_SOURCE_ID", "证据引用了未知素材");
    factIds.add(candidate.id);
    const match = strictMatch(source.content, candidate.originalQuote);
    const classification: EvidenceClassification = candidate.classification === "context_only"
      ? "context_only"
      : looksLikeUnsupportedTimePrediction(`${candidate.statement}\n${candidate.originalQuote}`)
        ? "exclude_time_prediction"
        : candidate.classification;
    const status: EvidenceStatus = classification === "exclude_time_prediction"
      ? "rejected"
      : classification === "context_only"
        ? "pending_user_review"
      : classification === "evidence_gap"
        ? "needs_review"
        : "verified";
    return {
      ...candidate,
      originalQuote: source.content.slice(match.quoteStart, match.quoteEnd),
      classification,
      ...match,
      status,
    };
  });
  const factContentKeys = facts.map((fact) => {
    const normalizedQuote = normalizedWithRawIndexes(fact.originalQuote).normalized
      .replace(/[。！？!?；;，,、：:]+$/u, "");
    return `${fact.sourceId}::${normalizedQuote}`;
  });
  if (new Set(factContentKeys).size !== factContentKeys.length) {
    fail("DUPLICATE_FACT_CONTENT", "同一素材中的同一段原文不能重复登记为多个事实");
  }
  validateSourceCoverage(sources, facts);
  const relationIds = new Set<string>();
  const relations = parsed.relations.map((rawRelation, index): EvidenceRelation => {
    if (!isRecord(rawRelation)) fail("INVALID_RELATION", `relations[${index}]无效`);
    const id = requiredString(rawRelation.id, `relations[${index}].id`);
    const type = requiredString(rawRelation.type, `relations[${index}].type`) as EvidenceRelationType;
    const relationFactIds = Array.isArray(rawRelation.factIds)
      ? rawRelation.factIds.map((value, factIndex) => requiredString(value, `relations[${index}].factIds[${factIndex}]`))
      : fail("INVALID_RELATION_FACTS", "关系引用无效");
    if (!/^R\d{2,}$/.test(id) || relationIds.has(id) || !RELATION_TYPES.has(type)) {
      fail("INVALID_RELATION", "关系编号或类型无效");
    }
    const uniqueFactIds = Array.from(new Set(relationFactIds));
    if (
      uniqueFactIds.length < 2 ||
      (type === "conflict" && uniqueFactIds.length !== 2) ||
      uniqueFactIds.some(factId => !factIds.has(factId))
    ) {
      fail("INVALID_RELATION_FACTS", "关系引用了不存在的事实");
    }
    relationIds.add(id);
    return {
      id,
      type,
      factIds: uniqueFactIds,
      summary: requiredString(rawRelation.summary, `relations[${index}].summary`),
    };
  });
  const relationContentKeys = relations.map(relation =>
    `${relation.type}::${[...relation.factIds].sort().join("::")}`);
  if (new Set(relationContentKeys).size !== relationContentKeys.length) {
    fail("DUPLICATE_RELATION_CONTENT", "同一组事实不能重复登记相同关系");
  }
  for (let firstIndex = 0; firstIndex < facts.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < facts.length; secondIndex += 1) {
      const first = facts[firstIndex];
      const second = facts[secondIndex];
      if (first.sourceId === second.sourceId || !relationLooksObvious(first, second)) continue;
      if (!relations.some(relation => relation.factIds.includes(first.id) && relation.factIds.includes(second.id))) {
        fail("OBVIOUS_RELATION_MISSING", "明显重叠的跨素材观点缺少关系标记");
      }
    }
  }
  return { sources, facts, relations };
}

function specificDetailTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/(?:学员|朋友|客户|同事|网友|老师|老板)(?:叫|名叫)?([小老阿][\u4e00-\u9fff]{1,2})/gu)) {
    if (match[1]) tokens.add(match[1]);
  }
  const excludedNicknameWords = new Set(["小时", "小时候", "小标题", "小问题", "老人", "老年", "阿姨"]);
  for (const match of text.matchAll(/(?:^|[，。！？；、\s])([小老阿][\u4e00-\u9fff]{1,2})(?=(?:每天|曾经|后来|当时|去|到|说|认为|发现|购买|买|做|是|，|。|、|；))/gu)) {
    if (match[1] && !excludedNicknameWords.has(match[1])) tokens.add(match[1]);
  }
  for (const match of text.matchAll(/\d+(?:\.\d+)?(?:年|月|日|天|周|岁|个|次|分钟|小时|万|元|%|％)?/gu)) {
    tokens.add(match[0]);
  }
  for (const match of text.matchAll(/[一二两三四五六七八九十百半]+(?:年|个月|月|天|周|小时|分钟)(?:后|前)?/gu)) {
    tokens.add(match[0]);
  }
  for (const match of text.matchAll(/(?:在|去|到)([\u4e00-\u9fff]{2,8}(?:机场|医院|学校|公司|门店|村|县|市))/gu)) {
    if (match[1]) tokens.add(match[1]);
  }
  return [...tokens];
}

export function requiresRiskReview(table: EvidenceTable): boolean {
  // 内容是否真正原子化、观点关系是否成立都属于语义判断，无法靠有限规则完整覆盖。
  // 首版固定执行独立复核；函数名保留以便未来在有可靠缓存或人工审核后再分流。
  if (table.facts.length > 0) return true;
  for (let firstIndex = 0; firstIndex < table.facts.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < table.facts.length; secondIndex += 1) {
      const first = table.facts[firstIndex];
      const second = table.facts[secondIndex];
      if (
        first.sourceId !== second.sourceId &&
        normalizedWithRawIndexes(first.originalQuote).normalized !== normalizedWithRawIndexes(second.originalQuote).normalized
      ) return true;
    }
  }
  if (table.relations.some(relation => relation.type === "conflict" || relation.type === "complement")) return true;
  if (table.relations.some(relation =>
    relation.type === "overlap" && new Set(relation.factIds.map((factId) => {
      const fact = table.facts.find(item => item.id === factId);
      return fact ? normalizedWithRawIndexes(fact.originalQuote).normalized : "";
    })).size > 1)) return true;
  if (table.facts.some(fact => fact.classification === "exclude_time_prediction")) return true;
  if (table.facts.some(fact => hasConcreteTimeReference(`${fact.statement}\n${fact.originalQuote}`))) return true;
  if (table.facts.some(fact => looksPotentiallyOverGrouped(fact.originalQuote))) return true;
  if (table.facts.some(fact => fact.confidence === "low" || fact.status === "needs_review")) return true;
  return table.facts.some(fact =>
    !isStatementExtractive(fact.statement, fact.originalQuote) ||
    hasCertaintyEscalation(fact.statement, fact.originalQuote) ||
    specificDetailTokens(fact.originalQuote).length > 0 ||
    /医疗|诊断|治疗|法律|诉讼|投资|收益|贷款|药物|疾病/u.test(fact.statement));
}

export function applyEvidenceReview(content: string, table: EvidenceTable): EvidenceTable {
  const parsed = parseJsonObject(content);
  if (!Array.isArray(parsed.decisions) || !Array.isArray(parsed.relationDecisions)) {
    fail("INVALID_REVIEW", "证据复核结构无效");
  }
  const decisionValues = new Set(["passed", "needs_review", "rejected"]);
  const result: EvidenceReviewResult = {
    decisions: parsed.decisions.map((rawDecision, index) => {
      if (!isRecord(rawDecision)) fail("INVALID_REVIEW", `decisions[${index}]无效`);
      const decision = requiredString(rawDecision.decision, `decisions[${index}].decision`);
      if (!decisionValues.has(decision)) {
        fail("INVALID_REVIEW_DECISION", "证据复核结论无效");
      }
      return {
        factId: requiredString(rawDecision.factId, `decisions[${index}].factId`),
        decision: decision as EvidenceReviewResult["decisions"][number]["decision"],
        reason: requiredString(rawDecision.reason, `decisions[${index}].reason`),
        classification: requiredString(rawDecision.classification, `decisions[${index}].classification`) as EvidenceClassification,
        atomicity: requiredString(rawDecision.atomicity, `decisions[${index}].atomicity`) as EvidenceReviewResult["decisions"][number]["atomicity"],
      };
    }),
    relationDecisions: parsed.relationDecisions.map((rawDecision, index) => {
      if (!isRecord(rawDecision)) fail("INVALID_REVIEW", `relationDecisions[${index}]无效`);
      const decision = requiredString(rawDecision.decision, `relationDecisions[${index}].decision`);
      if (!decisionValues.has(decision)) fail("INVALID_REVIEW_DECISION", "关系复核结论无效");
      return {
        relationId: requiredString(rawDecision.relationId, `relationDecisions[${index}].relationId`),
        decision: decision as EvidenceReviewResult["relationDecisions"][number]["decision"],
        reason: requiredString(rawDecision.reason, `relationDecisions[${index}].reason`),
      };
    }),
    suggestedRelations: Array.isArray(parsed.suggestedRelations)
      ? parsed.suggestedRelations.map((rawRelation, index): EvidenceRelation => {
        if (!isRecord(rawRelation)) fail("INVALID_REVIEW_RELATION", `suggestedRelations[${index}]无效`);
        const id = requiredString(rawRelation.id, `suggestedRelations[${index}].id`);
        const type = requiredString(rawRelation.type, `suggestedRelations[${index}].type`) as EvidenceRelationType;
        const factIds = Array.isArray(rawRelation.factIds)
          ? Array.from(new Set(rawRelation.factIds.map((value, factIndex) =>
            requiredString(value, `suggestedRelations[${index}].factIds[${factIndex}]`))))
          : fail("INVALID_REVIEW_RELATION", "新增关系引用无效");
        if (
          !/^RR\d{2,}$/.test(id) ||
          !RELATION_TYPES.has(type) ||
          factIds.length < 2 ||
          (type === "conflict" && factIds.length !== 2) ||
          factIds.some(factId => !table.facts.some(fact => fact.id === factId))
        ) fail("INVALID_REVIEW_RELATION", "新增关系结构无效");
        return {
          id,
          type,
          factIds,
          summary: requiredString(rawRelation.summary, `suggestedRelations[${index}].summary`),
        };
      })
      : [],
  };
  const decisions = new Map(result.decisions.map(decision => [decision.factId, decision]));
  const relationDecisions = new Map(result.relationDecisions.map(decision => [decision.relationId, decision]));
  if (
    decisions.size !== result.decisions.length ||
    relationDecisions.size !== result.relationDecisions.length ||
    decisions.size !== table.facts.length ||
    table.facts.some(fact => !decisions.has(fact.id)) ||
    relationDecisions.size !== table.relations.length ||
    table.relations.some(relation => !relationDecisions.has(relation.id))
  ) {
    fail("INCOMPLETE_REVIEW", "复核结果没有完整覆盖证据和关系");
  }
  const facts = table.facts.map((fact) => {
      const review = decisions.get(fact.id);
      if (!review) return fact;
      if (!CLASSIFICATIONS.has(review.classification)) {
        fail("INVALID_REVIEW_CLASSIFICATION", "复核后的证据分类无效");
      }
      if (review.atomicity !== "atomic" && review.atomicity !== "over_grouped") {
        fail("INVALID_REVIEW_ATOMICITY", "复核后的原子性结论无效");
      }
      if (review.atomicity === "over_grouped") {
        fail("NON_ATOMIC_FACT", "证据混合了多个可独立使用的内容单元");
      }
      const classification: EvidenceClassification = review.classification === "exclude_time_prediction"
        ? "exclude_time_prediction"
        : review.classification === "context_only" && review.decision === "needs_review"
          ? "evidence_gap"
        : review.decision === "needs_review"
          ? "evidence_gap"
          : review.classification;
      const status: EvidenceStatus = classification === "context_only"
        ? "pending_user_review"
        : review.decision === "rejected" || classification === "exclude_time_prediction"
          ? "rejected"
        : review.decision === "needs_review" || classification === "evidence_gap"
          ? "needs_review"
          : "verified";
      return { ...fact, classification, status };
    });
  const acceptedFactIds = new Set(facts.filter(fact => fact.status !== "rejected").map(fact => fact.id));
  const candidateFactIds = new Set(facts.filter(fact => fact.status === "pending_user_review").map(fact => fact.id));
  const acceptedRelations = table.relations.filter((relation) => {
    if (relation.factIds.some(factId => candidateFactIds.has(factId))) return false;
    const relationDecision = relationDecisions.get(relation.id)?.decision;
    if (relationDecision === "rejected") return false;
    if (relation.type !== "conflict" && relationDecision !== "passed") return false;
    return relation.factIds.every(factId => acceptedFactIds.has(factId));
  });
  const suggestedRelations = result.suggestedRelations.filter(relation =>
    relation.factIds.every(factId => acceptedFactIds.has(factId)) &&
    relation.factIds.every(factId => !candidateFactIds.has(factId)));
  const allRelationIds = [...acceptedRelations, ...suggestedRelations].map(relation => relation.id);
  if (new Set(allRelationIds).size !== allRelationIds.length) {
    fail("DUPLICATE_REVIEW_RELATION", "复核关系编号重复");
  }
  const pairTypes = new Map<string, EvidenceRelationType>();
  const relationContentKeys = new Set<string>();
  for (const relation of [...acceptedRelations, ...suggestedRelations]) {
    const relationContentKey = `${relation.type}::${[...relation.factIds].sort().join("::")}`;
    if (relationContentKeys.has(relationContentKey)) {
      fail("DUPLICATE_RELATION_CONTENT", "同一组事实不能重复登记相同关系");
    }
    relationContentKeys.add(relationContentKey);
    for (let firstIndex = 0; firstIndex < relation.factIds.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < relation.factIds.length; secondIndex += 1) {
        const pairKey = [relation.factIds[firstIndex], relation.factIds[secondIndex]].sort().join("::");
        const existingType = pairTypes.get(pairKey);
        if (existingType && existingType !== relation.type) {
          fail("CONFLICTING_RELATION_TYPES", "同一对事实不能同时标记为互相矛盾的关系类型");
        }
        pairTypes.set(pairKey, relation.type);
      }
    }
  }
  return {
    ...table,
    relations: [...acceptedRelations, ...suggestedRelations],
    facts,
  };
}

function sameFactSet(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every(factId => second.includes(factId));
}

function endWithChinesePunctuation(text: string): string {
  const clean = text.trim();
  return /[。！？；]$/u.test(clean) ? clean : `${clean}。`;
}

function orderFactsByRelations(facts: EvidenceFact[], relations: EvidenceRelation[]): EvidenceFact[] {
  if (facts.length <= 1) return facts;
  const remaining = new Map(facts.map(fact => [fact.id, fact]));
  const ordered: EvidenceFact[] = [];
  const first = facts[0];
  ordered.push(first);
  remaining.delete(first.id);
  while (remaining.size > 0) {
    const next = [...remaining.values()].find(fact => relations.some(relation =>
      relation.factIds.includes(fact.id) && ordered.some(item => relation.factIds.includes(item.id))));
    if (!next) fail("DISCONNECTED_PARAGRAPH_PLAN", "段落计划包含没有关系连接的观点");
    ordered.push(next);
    remaining.delete(next.id);
  }
  return ordered;
}

function buildGroundedParagraph(facts: EvidenceFact[], relations: EvidenceRelation[]): string {
  let paragraph: string;
  if (relations.length === 0) {
    paragraph = endWithChinesePunctuation(facts[0].originalQuote);
  } else {
    const ordered = orderFactsByRelations(facts, relations);
    paragraph = `${relations.some(relation => relation.type === "overlap") ? "多份素材表达了相近观点。" : ""}${endWithChinesePunctuation(ordered[0].originalQuote)}`;
    const renderedQuotes = new Set([normalizedWithRawIndexes(ordered[0].originalQuote).normalized]);
    for (let index = 1; index < ordered.length; index += 1) {
      const fact = ordered[index];
      const relation = relations.find(item =>
        item.factIds.includes(fact.id) && ordered.slice(0, index).some(previous => item.factIds.includes(previous.id)));
      if (!relation) fail("DISCONNECTED_PARAGRAPH_PLAN", "段落计划关系断裂");
      const normalizedQuote = normalizedWithRawIndexes(fact.originalQuote).normalized;
      if (relation.type === "overlap" && renderedQuotes.has(normalizedQuote)) continue;
      const prefix = relation.type === "conflict"
        ? "另一份素材提出了不同说法："
        : relation.type === "overlap"
          ? "另一份素材表达了相近观点，并保留了不同证据或细节："
          : "在此基础上，另一份素材补充：";
      paragraph += `${prefix}${endWithChinesePunctuation(fact.originalQuote)}`;
      renderedQuotes.add(normalizedQuote);
    }
    if (relations.some(relation => relation.type === "conflict")) {
      paragraph += "相关说法存在分歧，正式使用前需确定统一立场。";
    }
  }
  if (facts.some(fact => fact.status === "needs_review")) {
    paragraph += "这部分说法缺乏权威来源支撑，建议使用前核实。";
  }
  return paragraph;
}

function buildGroundedHeading(facts: EvidenceFact[], index: number): string {
  const raw = facts[0]?.originalQuote ?? `内容主题${index + 1}`;
  return raw.replace(/[。！？；]/gu, "").slice(0, 28) || `内容主题${index + 1}`;
}

function relationComponents(relations: EvidenceRelation[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const relation of relations) {
    for (const factId of relation.factIds) {
      const neighbors = adjacency.get(factId) ?? new Set<string>();
      relation.factIds.filter(otherId => otherId !== factId).forEach(otherId => neighbors.add(otherId));
      adjacency.set(factId, neighbors);
    }
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const factId of adjacency.keys()) {
    if (visited.has(factId)) continue;
    const stack = [factId];
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      adjacency.get(current)?.forEach(neighbor => stack.push(neighbor));
    }
    components.push(component);
  }
  return components;
}

export function parseAndValidateSynthesis(content: string, table: EvidenceTable): SynthesisResult {
  const parsed = parseJsonObject(content);
  if (
    Object.keys(parsed).some(key => key !== "draft") ||
    !isRecord(parsed.draft) ||
    Object.keys(parsed.draft).some(key => key !== "sections") ||
    !Array.isArray(parsed.draft.sections) ||
    parsed.draft.sections.length === 0
  ) {
    fail("INVALID_SYNTHESIS", "母稿结构无效");
  }
  const usableFacts = new Map(table.facts.filter(fact => fact.status !== "rejected").map(fact => [fact.id, fact]));
  const representedFactIds = new Set<string>();
  const components = relationComponents(table.relations);
  const sections = parsed.draft.sections.map((rawSection, sectionIndex) => {
    if (!isRecord(rawSection) || Object.keys(rawSection).some(key => key !== "paragraphPlans") || !Array.isArray(rawSection.paragraphPlans) || rawSection.paragraphPlans.length === 0) {
      fail("INVALID_SYNTHESIS_SECTION", `sections[${sectionIndex}]无效`);
    }
    const paragraphRefs = rawSection.paragraphPlans.map((rawPlan, paragraphIndex) => {
      if (!isRecord(rawPlan) || Object.keys(rawPlan).some(key => key !== "factIds") || !Array.isArray(rawPlan.factIds)) {
        fail("INVALID_PARAGRAPH_PLAN", `paragraphPlans[${paragraphIndex}]无效`);
      }
      const rawFactIds = rawPlan.factIds.map((value, factIndex) =>
        requiredString(value, `paragraphPlans[${paragraphIndex}].factIds[${factIndex}]`));
      const factIds = Array.from(new Set(rawFactIds));
      if (factIds.length !== rawFactIds.length) fail("DUPLICATE_FACT_REF", "段落计划不能重复引用同一事实");
      if (factIds.length === 0 || factIds.some(factId => !usableFacts.has(factId))) {
        fail("UNKNOWN_FACT_REF", "段落计划引用了不可用事实");
      }
      if (factIds.some(factId => usableFacts.get(factId)?.status === "pending_user_review") && factIds.length !== 1) {
        fail("EXCLUSION_CANDIDATE_NOT_ISOLATED", "待确认排除候选必须独立成段");
      }
      if (factIds.some(factId => representedFactIds.has(factId))) {
        fail("FACT_REPEATED", "同一观点不能在多个段落中重复使用");
      }
      const relatedComponent = components.find(component => component.includes(factIds[0]));
      if (relatedComponent && !sameFactSet(relatedComponent, factIds)) {
        fail("RELATION_COMPONENT_SPLIT", "同一关系链中的观点必须在一个段落计划中完整呈现");
      }
      if (!relatedComponent && factIds.length > 1) fail("UNDECLARED_FACT_GROUP", "没有关系的观点不能合并");
      factIds.forEach(factId => representedFactIds.add(factId));
      return { paragraphIndex, factIds };
    });
    const candidateRefs = paragraphRefs.filter(ref => ref.factIds.some(factId => usableFacts.get(factId)?.status === "pending_user_review"));
    if (candidateRefs.length > 0 && (paragraphRefs.length !== 1 || candidateRefs.length !== 1)) {
      fail("EXCLUSION_CANDIDATE_NOT_ISOLATED", "待确认排除候选必须独立成节");
    }
    const paragraphs = paragraphRefs.map((ref) => {
      const facts = ref.factIds.map(factId => usableFacts.get(factId)).filter((fact): fact is EvidenceFact => Boolean(fact));
      const relations = table.relations.filter(item => item.factIds.every(factId => ref.factIds.includes(factId)));
      return buildGroundedParagraph(facts, relations);
    });
    const firstRef = paragraphRefs[0];
    const firstFacts = firstRef.factIds.map(factId => usableFacts.get(factId)).filter((fact): fact is EvidenceFact => Boolean(fact));
    return {
      heading: buildGroundedHeading(firstFacts, sectionIndex),
      paragraphs,
      paragraphRefs,
    };
  });
  if ([...usableFacts.keys()].some(factId => !representedFactIds.has(factId))) {
    fail("FACT_NOT_REPRESENTED", "存在未真正写入母稿的可用观点");
  }
  for (const relation of table.relations) {
    if (!sections.some(section => section.paragraphRefs.some(ref => relation.factIds.every(factId => ref.factIds.includes(factId))))) {
      fail("RELATION_NOT_INTEGRATED", "关联观点没有在同一逻辑段落中完成融合");
    }
  }
  return { sections };
}
