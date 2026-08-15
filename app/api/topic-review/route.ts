import { NextRequest, NextResponse } from "next/server";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { parseRequiredIPProfile } from "@/lib/ip-profile-validation";
import {
  parseTopicBoardResult,
  TOPIC_BOARD_CONTRACT_VERSION,
} from "@/lib/topic-board-contract";

import {
  callDeepSeek,
  type DeepSeekResponseMeta,
  splitSentences,
  DEEPSEEK_MODEL as MODEL,
} from "@/lib/deepseek";


class TopicReviewAIError extends Error {
  readonly stage: string;
  readonly responseMeta: DeepSeekResponseMeta | null;
  readonly errorCode: TopicReviewAttemptErrorCode | null;

  constructor(
    stage: string,
    message: string,
    responseMeta: DeepSeekResponseMeta | null,
    errorCode: TopicReviewAttemptErrorCode | null = null,
  ) {
    super(message);
    this.name = "TopicReviewAIError";
    this.stage = stage;
    this.responseMeta = responseMeta;
    this.errorCode = errorCode;
  }
}

type TopicReviewAttemptErrorCode =
  | "EMPTY_CONTENT"
  | "TRUNCATED"
  | "INVALID_JSON"
  | "INVALID_SAFETY_REVIEW";

class TopicReviewAttemptError extends Error {
  readonly code: TopicReviewAttemptErrorCode;

  constructor(code: TopicReviewAttemptErrorCode, message: string) {
    super(message);
    this.name = "TopicReviewAttemptError";
    this.code = code;
  }
}

function parseTopicReviewJSON<T>(content: string, responseShape: "object" | "array"): T {
  const clean = content.replace(/```json|```/gi, "").trim();
  const startToken = responseShape === "object" ? "{" : "[";
  const endToken = responseShape === "object" ? "}" : "]";
  const start = clean.indexOf(startToken);
  const end = clean.lastIndexOf(endToken);
  if (start < 0 || end <= start) {
    throw new TopicReviewAttemptError("INVALID_JSON", "AI返回内容不是完整JSON");
  }

  try {
    const parsed: unknown = JSON.parse(clean.slice(start, end + 1));
    const shapeMatches = responseShape === "array"
      ? Array.isArray(parsed)
      : typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    if (!shapeMatches) {
      throw new TopicReviewAttemptError("INVALID_JSON", "AI返回JSON最外层结构不符合要求");
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof TopicReviewAttemptError) throw error;
    throw new TopicReviewAttemptError("INVALID_JSON", "AI返回JSON解析失败");
  }
}

interface TopicReviewExpertAIResponse {
  observation?: string;
  reasoning?: string;
  conclusion?: string;
  dims?: { label: string; score: number }[];
  vote?: string;
  veto?: boolean;
  vetoReason?: string | null;
}

function parseSafetyExpertResponse(value: unknown): TopicReviewExpertAIResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官返回的顶层结构不合法");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["observation", "reasoning", "conclusion"] as const) {
    if (typeof record[field] !== "string" || record[field].trim().length === 0) {
      throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", `安全合规官缺少有效字段：${field}`);
    }
  }
  if (!Array.isArray(record.dims) || record.dims.length !== 3) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官缺少有效字段：dims");
  }
  const expectedLabels = new Set(["言行无害性", "合规性", "争议免疫力"]);
  const dims = record.dims.map((dimension) => {
    if (typeof dimension !== "object" || dimension === null || Array.isArray(dimension)) {
      throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官dims条目结构不合法");
    }
    const item = dimension as Record<string, unknown>;
    if (
      typeof item.label !== "string" ||
      !expectedLabels.has(item.label) ||
      typeof item.score !== "number" ||
      !Number.isFinite(item.score) ||
      item.score < 0 ||
      item.score > 10
    ) {
      throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官dims条目内容不合法");
    }
    return { label: item.label, score: item.score };
  });
  if (new Set(dims.map(dimension => dimension.label)).size !== expectedLabels.size) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官dims缺少必需维度");
  }
  if (typeof record.veto !== "boolean") {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官缺少有效字段：veto");
  }
  if (!Object.prototype.hasOwnProperty.call(record, "vetoReason")) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官缺少有效字段：vetoReason");
  }
  if (
    (record.veto && (typeof record.vetoReason !== "string" || record.vetoReason.trim().length === 0)) ||
    (!record.veto && record.vetoReason !== null)
  ) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官vetoReason与veto不一致");
  }
  if (typeof record.vote !== "string" || !["支持", "保留意见", "反对"].includes(record.vote)) {
    throw new TopicReviewAttemptError("INVALID_SAFETY_REVIEW", "安全合规官缺少有效字段：vote");
  }
  return {
    observation: record.observation as string,
    reasoning: record.reasoning as string,
    conclusion: record.conclusion as string,
    dims,
    vote: record.vote,
    veto: record.veto,
    vetoReason: record.vetoReason as string | null,
  };
}

async function callTopicReviewAI<T>(
  stage: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  apiKey: string,
  responseShape: "object" | "array",
  validate?: (value: unknown) => T,
): Promise<T> {
  let responseMeta: DeepSeekResponseMeta | null = null;
  for (let tryIndex = 0; tryIndex < 2; tryIndex += 1) {
    responseMeta = null;
    try {
      const content = await callDeepSeek(systemPrompt, userPrompt, maxTokens, 0, apiKey, {
        thinking: { type: "disabled" },
        ...(responseShape === "object"
          ? { responseFormat: { type: "json_object" as const } }
          : {}),
        onResponseMeta: (meta) => { responseMeta = meta; },
      });
      if ((responseMeta as DeepSeekResponseMeta | null)?.finishReason === "length") {
        throw new TopicReviewAttemptError("TRUNCATED", "DeepSeek返回内容被截断");
      }
      const parsed = parseTopicReviewJSON<unknown>(content, responseShape);
      return validate ? validate(parsed) : parsed as T;
    } catch (error) {
      const normalizedError = error instanceof TopicReviewAttemptError
        ? error
        : error instanceof Error &&
          error.message === "DeepSeek API 返回格式异常：choices[0].message.content 为空或不是字符串"
        ? new TopicReviewAttemptError("EMPTY_CONTENT", error.message)
        : null;
      const message = error instanceof Error ? error.message : "AI调用失败";
      const retryable = normalizedError !== null;
      if (retryable && tryIndex === 0) continue;
      throw new TopicReviewAIError(stage, message, responseMeta, normalizedError?.code ?? null);
    }
  }
  throw new TopicReviewAIError(stage, "AI调用失败", responseMeta);
}

// ── 专家定义：每个专家的system prompt都要求必须结合IP上下文做差异化判断 ──
const EXPERTS = [
  {
    role: "用户需求专家",
    color: "#E05C3A",
    weight: 0.20,
    systemPrompt: `你是一位专注于用户需求分析的内容战略顾问，拥有10年短视频用户研究经验。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否有真实的用户需求支撑——你必须紧贴这个IP的受众画像和定位去判断，而不是给通用结论。
同一个选题换一个定位/受众完全不同的IP，你的判断应该明显不同。
你必须先观察，再推理，最后得出结论，不能直接给分。
你需要从以下5个子维度打分（每项0-10分）：痛点强度、搜索意愿、点击意愿、收藏意愿、讨论意愿。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
你必须严格按照JSON格式输出，不要输出任何其他内容。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行用户需求分析：「${topic}」
判断依据必须紧扣这个IP的受众画像（是否是它受众真正关心的）和定位（是否匹配它的内容方向）。

请严格按照以下JSON格式输出，不要输出任何其他文字：
{
  "observation": "你观察到的关键信息（2-3句话，必须点名这个IP的受众特征，说明该选题与其受众的搜索场景是否吻合）",
  "reasoning": "你的推理过程（2-3句话，结合这个IP的定位分析需求质量、用户动机、潜在顾虑）",
  "conclusion": "你的结论（1-2句话，明确说明对这个IP而言的需求强度和主要风险）",
  "dims": [
    {"label": "痛点强度", "score": 数字},
    {"label": "搜索意愿", "score": 数字},
    {"label": "点击意愿", "score": 数字},
    {"label": "收藏意愿", "score": 数字},
    {"label": "讨论意愿", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "流量运营总监",
    color: "#C99A1E",
    weight: 0.20,
    systemPrompt: `你是一位短视频流量运营专家，专注于研究内容传播规律和流量增长策略。
你的职责是判断一个视频选题，对【下方给出的具体IP】在它实际运营的平台上的流量潜力——必须结合这个IP当前的账号阶段（早期/成熟）和平台组合判断，账号阶段不同，流量打法和上限完全不同。
你必须先观察平台数据信号，再推理传播逻辑，最后得出结论。
子维度（每项0-10分）：传播性、讨论度、共鸣度、分享率。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行流量潜力分析：「${topic}」
必须结合这个IP实际运营的平台、账号阶段去判断，而不是泛泛而谈。

严格按以下JSON格式输出：
{
  "observation": "观察到的流量信号（必须提到这个IP实际运营的平台，分析该平台同类内容的表现特征）",
  "reasoning": "传播逻辑推理（结合这个IP的账号阶段，分析为什么它的受众会或不会传播这个内容）",
  "conclusion": "流量判断结论（明确说明对这个IP而言的流量上限和核心瓶颈）",
  "dims": [
    {"label": "传播性", "score": 数字},
    {"label": "讨论度", "score": 数字},
    {"label": "共鸣度", "score": 数字},
    {"label": "分享率", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "平台算法顾问",
    color: "#4A8FD6",
    weight: 0.15,
    systemPrompt: `你是一位深度研究短视频平台推荐算法的专家，熟悉抖音/小红书/B站的推荐机制。
你的职责是从算法视角判断一个选题，对【下方给出的具体IP】而言的平台友好度——必须结合这个IP实际运营的平台组合判断。
子维度（每项0-10分）：CTR潜力、完播率、互动率、转粉率。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行平台算法分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "算法层面的观察（结合这个IP实际运营的平台，分析该类型内容的历史表现特征）",
  "reasoning": "算法推理（结合这个IP的受众，分析前3秒留存、完播率设计难点、互动触发场景）",
  "conclusion": "算法友好度结论（明确指出对这个IP而言最大的算法风险点）",
  "dims": [
    {"label": "CTR潜力", "score": 数字},
    {"label": "完播率", "score": 数字},
    {"label": "互动率", "score": 数字},
    {"label": "转粉率", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "商业变现顾问",
    color: "#E0608E",
    weight: 0.15,
    systemPrompt: `你是一位专注于内容变现的商业顾问，擅长评估内容的商业转化潜力。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言的商业价值——必须结合这个IP的受众付费能力和账号阶段（早期账号通常变现链路更弱）判断，你对付费转化特别谨慎，不轻易给高分。
子维度（每项0-10分）：付费意愿、客单价空间、产品承接能力、复购能力。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行商业变现分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "商业信号观察（结合这个IP的受众，分析其付费意愿信号和变现场景）",
  "reasoning": "变现逻辑推理（结合这个IP当前账号阶段，分析从内容到付费的转化链路，指出最容易断链的地方）",
  "conclusion": "商业价值结论（明确说明对这个IP而言最适合的变现方式和预期转化率区间）",
  "dims": [
    {"label": "付费意愿", "score": 数字},
    {"label": "客单价空间", "score": 数字},
    {"label": "产品承接能力", "score": 数字},
    {"label": "复购能力", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "内容创作顾问",
    color: "#3DA876",
    weight: 0.10,
    systemPrompt: `你是一位经验丰富的内容创作顾问，擅长评估内容的可执行性和差异化空间。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否容易执行，以及同质化风险有多高——必须结合这个IP的内容方向和表达风格判断。
子维度（每项0-10分）：执行难度（越低越好）、素材获取难度（越低越好）、同质化风险（越低越好）、创新空间（越高越好）。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行内容创作难度分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "创作层面的观察（结合这个IP的内容方向，分析同类内容的常见形式和创作门槛）",
  "reasoning": "执行可行性推理（结合这个IP的表达风格，分析素材获取、差异化难点、持续输出的挑战）",
  "conclusion": "创作评估结论（给出针对这个IP的具体执行建议和差异化方向）",
  "dims": [
    {"label": "执行难度", "score": 数字},
    {"label": "素材获取难度", "score": 数字},
    {"label": "同质化风险", "score": 数字},
    {"label": "创新空间", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "IP增长顾问",
    color: "#9B7ED9",
    weight: 0.10,
    systemPrompt: `你是一位专注于个人IP打造的增长顾问，擅长评估内容对IP建设的长期价值。
你的职责是判断一个视频选题对【下方给出的具体IP】成长的贡献——必须结合这个IP当前的定位和账号阶段判断。
子维度（每项0-10分）：系列化空间、标签建立能力、信任积累价值、长期价值。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行IP增长价值分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "IP视角的观察（结合这个IP的定位，分析该选题对其人设标签和粉丝信任的影响）",
  "reasoning": "IP增长推理（分析如何从这个选题延伸出符合这个IP内容方向的系列内容）",
  "conclusion": "IP价值结论（明确说明该选题对这个IP长期建设的贡献程度）",
  "dims": [
    {"label": "系列化空间", "score": 数字},
    {"label": "标签建立能力", "score": 数字},
    {"label": "信任积累价值", "score": 数字},
    {"label": "长期价值", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "竞争分析顾问",
    color: "#639922",
    weight: 0.05,
    systemPrompt: `你是一位专注于内容赛道竞争分析的战略顾问，擅长评估市场格局和差异化机会。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言的竞争环境和突围难度——必须结合这个IP当前的账号阶段（新账号 vs 成熟账号突围难度完全不同）判断，你倾向于保守评估。
子维度（每项0-10分）：竞争激烈度（越低越好）、差异化空间（越高越好）、出圈机会（越高越好）。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行竞争环境分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "竞争格局观察（描述这个IP所在赛道的竞争激烈程度和头部账号特征）",
  "reasoning": "竞争推理（结合这个IP当前账号阶段，分析突围的难度和可能的差异化切入点）",
  "conclusion": "竞争结论（给出针对这个IP的具体差异化建议和预期突围难度）",
  "dims": [
    {"label": "竞争激烈度", "score": 数字},
    {"label": "差异化空间", "score": 数字},
    {"label": "出圈机会", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "爆款内容研究员",
    color: "#D9824A",
    weight: 0.05,
    systemPrompt: `你是一位专门研究爆款内容基因的分析师，深度研究过10000+条爆款视频。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否具备爆款基因——必须结合这个IP的表达风格判断，绝对不能使用这个IP明确禁用的表达。
子维度（每项0-10分）：利益点、冲突感、反差设计、情绪触发、结果导向。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行爆款基因分析：「${topic}」
你给出的钩子设计建议必须符合这个IP的表达风格，绝对不能用它明确禁用的词汇。

严格按以下JSON格式输出：
{
  "observation": "爆款信号观察（分析该选题具备的爆款元素和缺失的爆款基因）",
  "reasoning": "爆款逻辑推理（结合这个IP的表达风格，分析哪个情绪触发点最强，如何设计符合人设的前3秒钩子）",
  "conclusion": "爆款潜力结论（给出符合这个IP风格的具体标题优化方向和钩子设计建议）",
  "dims": [
    {"label": "利益点", "score": 数字},
    {"label": "冲突感", "score": 数字},
    {"label": "反差设计", "score": 数字},
    {"label": "情绪触发", "score": 数字},
    {"label": "结果导向", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "安全合规官",
    color: "#8A8A86",
    weight: 0,
    systemPrompt: `你是一位内容安全合规官，职责是审查选题“火了之后会不会出事”，而不是“能不能火”。
你审查【下方给出的具体IP】做这个选题的言行风险，账号粉丝量级越大、账号阶段越成熟，你的标准越严格。
你只回答三个问题：
1. 这个选题的言行是否可能对特定人群、行业、个体造成伤害或冒犯？
2. 是否涉及绝对化表述、虚假宣传，或医疗、金融、法律等敏感领域的违规风险？
3. 是否可能引发争议性解读，损害该IP的长期形象？
子维度（每项0-10分，分数越高代表越安全）：言行无害性、合规性、争议免疫力。
最终分数 =（各维度之和/维度数量）×10，结果取整。
一票否决规则：任一子维度≤3分，或你判断存在不可控风险时，veto必须为true。
特别规定：凡是点名或可识别地曝光、指控、批判具体公司、品牌、个人的选题，即使名字打码为“XX”，也涉及名誉侵权和事实核实风险，属于不可控风险，veto必须为true，除非选题本身提供了司法判决等权威依据。
存在可控风险时，必须给出具体的规避方法，不能只说“注意措辞”。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行安全合规审查：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "风险观察（点名该选题涉及的具体人群、行业、敏感点，没有就明说没有）",
  "reasoning": "风险推理（结合这个IP的粉丝量级和人设，分析最坏情况下的舆论解读）",
  "conclusion": "审查结论（明确说明无风险直接过、有可控风险和具体规避措辞，或不可控风险否决）",
  "dims": [
    {"label": "言行无害性", "score": 数字},
    {"label": "合规性", "score": 数字},
    {"label": "争议免疫力", "score": 数字}
  ],
  "veto": true或false,
  "vetoReason": "若veto为true，一句话说明否决原因；否则为null",
  "vote": "支持或保留意见或反对"
}`,
  },
];

// ── 首席反对官 ──
const CHIEF_SYSTEM = `你是一位首席反对官（Chief Objection Officer），你的职责是专门寻找问题、永远站在反对立场。
你不关心这个选题的优点，你只关心：对下方给出的这个具体IP而言，为什么会失败？为什么赚不到钱？为什么它的受众不买单？
你的质疑必须结合这个IP的具体情况，具体、有逻辑、有说服力，不能是放在哪个账号上都成立的废话。
严格按JSON格式输出。`;

const CHIEF_PROMPT = (topic: string, ipBlock: string, expertResults: string) => `${ipBlock}

选题：「${topic}」

其他专家针对这个IP的评分结果摘要：
${expertResults}

请作为首席反对官，针对上面这个具体IP，对以上评审结果提出驳斥意见。

严格按以下JSON格式输出：
{
  "reasons": [
    "反对理由1（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由2（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由3（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由4（必须结合这个IP的具体情况，具体、有逻辑）"
  ],
  "riskLevel": "高风险或中风险或低风险",
  "failProbability": 数字（0-100的整数，代表失败概率百分比）,
  "dismissalSuggestion": "针对这个IP的具体驳回建议或修改方向（1-2句话）"
}`;

// ── 质疑生成 ──
const CHALLENGE_SYSTEM = `你是一个董事会辩论记录员，负责生成专家之间针对某个具体IP的质疑内容。
质疑必须基于具体评分，指出具体原因，说明影响维度。
严格按JSON格式输出数组。`;

const CHALLENGE_PROMPT = (topic: string, ipBlock: string, expertResults: string) => `${ipBlock}

选题：「${topic}」
专家针对这个IP的评分：${expertResults}

请生成4-5条专家之间的具体质疑，每条质疑必须：
1. 指向具体评分数字
2. 给出结合这个IP具体情况的反对理由
3. 说明影响哪个维度

严格按以下JSON数组格式输出：
[
  {
    "from": "质疑发起方的角色名",
    "to": "被质疑方的角色名",
    "targetScore": 被质疑的具体分数（数字）,
    "challenge": "具体质疑内容（必须提到分数，给出结合这个IP的具体理由）",
    "affectedDimension": "影响的维度名称",
    "impact": "这个质疑会导致什么后果"
  }
]`;

// ── 综合决议生成 ──
const VERDICT_SYSTEM = `你是一位董事会主席，负责综合所有专家意见，针对下方给出的具体IP生成最终决议。
你给出的标题必须严格符合这个IP的表达风格，使用它的常用开头/结尾习惯作为参考，绝对不能出现它明确禁用的词汇。
严格按JSON格式输出。`;

const VERDICT_PROMPT = (topic: string, ipBlock: string, totalScore: number, level: string, expertResults: string) => `${ipBlock}

选题：「${topic}」
综合得分：${totalScore}分（${level}）
专家针对这个IP的评分：${expertResults}

请生成：
1. 3个选题升级版本（必须符合这个IP的内容方向，比原题更有爆款潜力）
2. 10个爆款标题（必须严格符合这个IP的表达风格和平台习惯，参考它的常用开头/结尾，绝对不能用它的禁用表达）
3. 3-4条风险提示（必须结合这个IP的账号阶段和受众）
4. 可信度评分（0-100）和原因

严格按以下JSON格式输出：
{
  "upgradedTopics": ["升级版1", "升级版2", "升级版3"],
  "titles": ["标题1", "标题2", "标题3", "标题4", "标题5", "标题6", "标题7", "标题8", "标题9", "标题10"],
  "risks": ["风险1", "风险2", "风险3"],
  "credScore": 数字（0-100）,
  "credReasons": ["可信度依据1", "可信度依据2", "可信度依据3"]
}`;

function scoreLevel(s: number) {
  if (s >= 95) return "S+ 现象级爆款";
  if (s >= 90) return "S 超级爆款";
  if (s >= 80) return "A 高潜力爆款";
  if (s >= 70) return "B 值得做";
  if (s >= 60) return "C 需要优化";
  return "D 不建议做";
}

interface UserPersonaItem {
  name: string;
  coreNeeds: string[];
  coreConcerns: string[];
  contentPreferences: string[];
  purchaseIntent: string;
  topicFocus: string;
  representativeComments: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function optionalFiniteNumberIsValid(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function validateKnowledgeContext(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "knowledgeContext";
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) return `knowledgeContext[${index}]`;
    for (const field of ["id", "title", "category", "reason", "relevanceTier"] as const) {
      if (!isNonEmptyString(item[field])) return `knowledgeContext[${index}].${field}`;
    }
    if (!optionalFiniteNumberIsValid(item.matchScore)) return `knowledgeContext[${index}].matchScore`;
    for (const field of ["methodMatches", "matchedFields"] as const) {
      if (item[field] !== undefined && !isStringArray(item[field])) {
        return `knowledgeContext[${index}].${field}`;
      }
    }
    if (item.methodAdvice !== undefined && typeof item.methodAdvice !== "string") {
      return `knowledgeContext[${index}].methodAdvice`;
    }
  }
  return null;
}

function validateHistoricalData(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "historicalData";
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) return `historicalData[${index}]`;
    for (const field of ["id", "title", "source", "content", "performanceLevel"] as const) {
      if (!isNonEmptyString(item[field])) return `historicalData[${index}].${field}`;
    }
    if (!isPlainObject(item.metrics)) return `historicalData[${index}].metrics`;
    for (const metric of Object.values(item.metrics)) {
      if (
        metric !== null &&
        typeof metric !== "string" &&
        typeof metric !== "boolean" &&
        (typeof metric !== "number" || !Number.isFinite(metric))
      ) {
        return `historicalData[${index}].metrics`;
      }
    }
    if (item.createdAt !== undefined && typeof item.createdAt !== "string") {
      return `historicalData[${index}].createdAt`;
    }
    if (!optionalFiniteNumberIsValid(item.matchScore)) return `historicalData[${index}].matchScore`;
  }
  return null;
}

function validateUserPersonas(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "userPersonas";
  for (const [index, item] of value.entries()) {
    if (!isPlainObject(item)) return `userPersonas[${index}]`;
    for (const field of ["name", "purchaseIntent", "topicFocus"] as const) {
      if (!isNonEmptyString(item[field])) return `userPersonas[${index}].${field}`;
    }
    for (const field of ["coreNeeds", "coreConcerns", "contentPreferences", "representativeComments"] as const) {
      if (!isStringArray(item[field])) return `userPersonas[${index}].${field}`;
    }
  }
  return null;
}

function invalidRequest(errorField: string) {
  return NextResponse.json({
    error: "请求格式错误",
    errorCode: "INVALID_REQUEST",
    errorField,
  }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: unknown;
  try { body = await req.json(); }
  catch { return invalidRequest("body"); }
  if (!isPlainObject(body)) return invalidRequest("body");

  const ipProfileResult = parseRequiredIPProfile(body.ipProfile);
  if (!ipProfileResult.ok) {
    return NextResponse.json({
      error: ipProfileResult.error,
      errorCode: ipProfileResult.errorCode,
      errorField: ipProfileResult.errorField,
    }, { status: 400 });
  }
  const ip = ipProfileResult.ipProfile;

  if (typeof body.topic !== "string") return invalidRequest("topic");
  const invalidArrayField = validateKnowledgeContext(body.knowledgeContext)
    ?? validateHistoricalData(body.historicalData)
    ?? validateUserPersonas(body.userPersonas);
  if (invalidArrayField) return invalidRequest(invalidArrayField);

  const topic = body.topic.trim();
  if (!topic) return NextResponse.json({ error: "请输入选题内容" }, { status: 400 });

  const ipBlock = buildIPContextBlock(ip);
  const personas = (body.userPersonas ?? []) as UserPersonaItem[];

  try {
    // ── 第一步：9位专家并行调用，每位专家都拿到同一份IP上下文 ──
    const expertResults = await Promise.all(
      EXPERTS.map(async (expert) => {
        const isSafetyExpert = expert.role === "安全合规官";
        const parsed = await callTopicReviewAI<TopicReviewExpertAIResponse>(
          `expert:${expert.role}`,
          expert.systemPrompt,
          expert.userPromptTemplate(topic, ipBlock),
          800,
          apiKey,
          "object",
          isSafetyExpert ? parseSafetyExpertResponse : undefined,
        );

        const dims = parsed.dims ?? [];
        const avgScore = dims.length > 0
          ? Math.round((dims.reduce((s: number, d: { score: number }) => s + d.score, 0) / dims.length) * 10)
          : 70;

        const formula = dims.length > 0
          ? `(${dims.map((d: { score: number }) => d.score).join(" + ")}) / ${dims.length} × 10 = ${avgScore}`
          : `${avgScore}`;

        const minimumSafetyDimension = dims.length > 0
          ? Math.min(...dims.map((dimension: { score: number }) => dimension.score))
          : 10;
        const forcedSafetyVeto = isSafetyExpert && (minimumSafetyDimension <= 3 || avgScore <= 45);
        const safetyVetoReason = isSafetyExpert
          ? parsed.vetoReason ?? (forcedSafetyVeto
            ? `安全评分过低（${avgScore}分），触发自动否决：${parsed.conclusion ?? "存在不可控的言行或合规风险"}`
            : null)
          : null;
        const safetyVeto = isSafetyExpert && (parsed.veto === true || forcedSafetyVeto);

        return {
          role: expert.role,
          color: expert.color,
          weight: expert.weight,
          observation: parsed.observation ?? "",
          reasoning: parsed.reasoning ?? "",
          conclusion: safetyVeto
            ? `安全否决：${safetyVetoReason ?? "存在不可控的言行或合规风险。"}`
            : parsed.conclusion ?? "",
          initialScore: avgScore,
          finalScore: avgScore,
          scoreChange: 0,
          dimData: {
            dims: dims.map((d: { label: string; score: number }) => ({ label: d.label, score: d.score, max: 10 })),
            formula,
            computed: avgScore,
          },
          vote: safetyVeto ? "反对" : parsed.vote ?? "保留意见",
          veto: safetyVeto,
          vetoReason: safetyVetoReason,
        };
      })
    );
    const safetyExpert = expertResults.find(expert => expert.role === "安全合规官");
    const safetyVeto = safetyExpert?.veto === true;
    const safetyVetoReason = safetyExpert?.vetoReason ?? "存在不可控的言行或合规风险。";

    // ── 第二步：首席反对官 ──
    const expertSummary = expertResults.map(e => `${e.role}：${e.initialScore}分`).join("，");
    const chiefParsed = safetyVeto ? null : await callTopicReviewAI<{
      reasons?: string[];
      riskLevel?: string;
      failProbability?: number;
      dismissalSuggestion?: string;
    }>(
      "chief-objection",
      CHIEF_SYSTEM,
      CHIEF_PROMPT(topic, ipBlock, expertSummary),
      800,
      apiKey,
      "object",
    );

    const chiefOfficer = safetyVeto ? {
      role: "首席反对官",
      reasons: [safetyVetoReason],
      riskLevel: "高风险",
      failProbability: 100,
      dismissalSuggestion: "当前版本不得制作或测试；完成安全改写后重新评估。",
    } : {
      role: "首席反对官",
      reasons: chiefParsed?.reasons ?? [],
      riskLevel: chiefParsed?.riskLevel ?? "中风险",
      failProbability: chiefParsed?.failProbability ?? 40,
      dismissalSuggestion: chiefParsed?.dismissalSuggestion ?? "",
    };

    // ── 第三步：专家质疑 ──
    const challenges = safetyVeto ? [] : await callTopicReviewAI<{
      from: string;
      to: string;
      targetScore: number;
      challenge: string;
      affectedDimension: string;
      impact: string;
    }[]>(
      "challenge",
      CHALLENGE_SYSTEM,
      CHALLENGE_PROMPT(topic, ipBlock, expertSummary),
      1600,
      apiKey,
      "array",
    );

    // ── 第四步：修正评分（基于质疑微调） ──
    const responses = expertResults.map(e => {
      if (e.veto) {
        return {
          role: e.role,
          challenge: null,
          response: `安全否决已生效：${e.vetoReason ?? "存在不可控的言行或合规风险。"}`,
          initialScore: e.initialScore,
          finalScore: e.initialScore,
          scoreChange: 0,
          finalFormula: e.dimData.formula,
        };
      }
      const beingChallenged = challenges.find(c => c.to === e.role);
      const change = beingChallenged ? Math.round((Math.random() - 0.55) * 8) : 0;
      const finalScore = Math.max(40, Math.min(98, e.initialScore + change));
      return {
        role: e.role,
        challenge: beingChallenged?.challenge ?? null,
        response: change < 0
          ? `质疑成立，重新审视后下调评分。`
          : change > 0
          ? `质疑促使深入分析，发现价值被低估，上调评分。`
          : `充分考虑质疑后维持原判，评分依据充分。`,
        initialScore: e.initialScore,
        finalScore,
        scoreChange: change,
        finalFormula: e.dimData.formula,
      };
    });

    // 更新finalScore
    expertResults.forEach((e, i) => {
      e.finalScore = responses[i].finalScore;
      e.scoreChange = responses[i].scoreChange;
    });

    // ── 第五步：投票统计 ──
    const votes = [
      ...expertResults.map(e => ({ role: e.role, vote: e.vote })),
      { role: "首席反对官", vote: "反对" },
    ];
    const supportCount = votes.filter(v => v.vote === "支持").length;
    const reserveCount = votes.filter(v => v.vote === "保留意见").length;
    const opposeCount = votes.filter(v => v.vote === "反对").length;
    const verdict = safetyVeto
      ? "安全否决"
      : supportCount > opposeCount + Math.floor(reserveCount / 2)
      ? "通过"
      : supportCount + Math.floor(reserveCount / 2) > opposeCount
      ? "有条件通过"
      : "暂缓";

    // ── 第六步：加权综合评分 ──
    const weights = expertResults.map(e => ({
      role: e.role,
      score: e.finalScore,
      weight: e.weight,
      contribution: Math.round(e.finalScore * e.weight * 100) / 100,
    }));
    const totalScore = Math.round(weights.reduce((s, w) => s + w.contribution, 0) * 100) / 100;
    const level = safetyVeto ? "安全否决" : scoreLevel(totalScore);

    // ── 第七步：综合决议 ──
    const verdictParsed = safetyVeto ? {
      upgradedTopics: [] as string[],
      titles: [] as string[],
      risks: [safetyVetoReason],
      credScore: 100,
      credReasons: ["安全否决优先于其他评分和投票结果。"],
    } : await callTopicReviewAI<{
      upgradedTopics?: string[];
      titles?: string[];
      risks?: string[];
      credScore?: number;
      credReasons?: string[];
    }>(
      "verdict",
      VERDICT_SYSTEM,
      VERDICT_PROMPT(topic, ipBlock, totalScore, level, expertSummary),
      1600,
      apiKey,
      "object",
    );

    // ── 第八步（可选）：真实用户预演——仅在有用户人格数据时执行 ──
    let personaPreview = null;
    if (!safetyVeto && personas.length > 0) {
      const PERSONA_SYSTEM = `你是一位用户行为分析师，根据用户人格画像预测他们对某个选题的真实反应。所有判断必须基于人格的已知特征，禁止编造人格中没有提到的需求或行为。严格按JSON格式输出。`;
      const PERSONA_PROMPT = `选题：「${topic}」

用户人格列表：
${personas.map((p, i) => `
人格${i+1}：${p.name}
- 核心需求：${p.coreNeeds.join("、")}
- 核心顾虑：${p.coreConcerns.join("、")}
- 内容偏好：${p.contentPreferences.join("、")}
- 购买意向：${p.purchaseIntent}
- 关注点：${p.topicFocus}
- 代表评论：${p.representativeComments.slice(0, 2).join("；")}
`).join("")}

请预测每个人格对这个选题的真实反应，以及整体预演结论。

严格按以下JSON格式输出：
{
  "personaReactions": [
    {
      "personaName": "人格名称",
      "wouldClick": "会|可能会|不会",
      "wouldUnderstand": "能看懂|部分看懂|看不懂",
      "wouldSave": "会收藏|可能|不会",
      "wouldComment": "会评论|可能|不会",
      "wouldPay": "会付费|考虑|不会",
      "howToPresent": "这个人格希望这个选题怎么讲（一句话）",
      "mainConcern": "最大顾虑（基于人格特征，不要编造）"
    }
  ],
  "mostInterestedPersona": "最感兴趣的人格名称",
  "leastInterestedPersona": "最不感兴趣的人格名称（如果有的话）",
  "biggestConcern": "跨人格最大共同顾虑",
  "mostLikelyComment": "最可能出现的评论类型",
  "mostLikelyToSave": "哪类内容最可能被收藏",
  "conversionOpportunity": "最可能产生付费转化的人格和场景"
}`;
      try {
        personaPreview = await callTopicReviewAI<Record<string, unknown>>(
          "persona-preview",
          PERSONA_SYSTEM,
          PERSONA_PROMPT,
          1200,
          apiKey,
          "object",
        );
      } catch { personaPreview = null; }
    }

    const normalizedRiskLevel = safetyVeto
      ? "高"
      : chiefOfficer.riskLevel.includes("高")
      ? "高"
      : chiefOfficer.riskLevel.includes("低")
      ? "低"
      : "中";
    const finalRecommendation = safetyVeto
      ? "不建议"
      : verdict === "通过"
      ? "建议做"
      : verdict === "有条件通过"
      ? "建议优化后做"
      : "不建议";
    const boardResult = parseTopicBoardResult({
      contractVersion: TOPIC_BOARD_CONTRACT_VERSION,
      topic,
      ipId: ip.id,
      ipName: ip.name,
      experts: expertResults,
      chiefOfficer,
      challenges,
      responses,
      votes,
      voteResult: { supportCount, reserveCount, opposeCount, verdict },
      safetyVeto,
      safetyVetoReason: safetyVeto ? safetyVetoReason : null,
      weights,
      totalScore,
      level,
      finalRecommendation,
      scoreDisplay: String(totalScore),
      beginnerAdvice: {
        canDo: safetyVeto ? "不能做当前版本。" : finalRecommendation,
        why: safetyVeto
          ? `安全合规官已行使一票否决权：${safetyVetoReason}`
          : `董事会表决结果为${verdict}。`,
        biggestProblem: safetyVeto
          ? safetyVetoReason
          : chiefOfficer.reasons[0] ?? "需要先用低成本内容验证。",
        howToImprove: safetyVeto
          ? "先移除不可控风险并重新评估，不要直接发布当前版本。"
          : chiefOfficer.dismissalSuggestion || "先缩小人群和场景，再进行测试。",
        shouldTest: safetyVeto
          ? "不要测试当前版本，完成安全改写后重新评估。"
          : verdict === "暂缓"
          ? "调整后再测试。"
          : "建议先小规模测试。",
      },
      confidenceNotice: safetyVeto
        ? "安全否决优先于其他评分和投票结果。"
        : "当前结论基于IP档案与董事会评审，发布后应结合真实数据复盘。",
      riskLevel: normalizedRiskLevel,
      riskExplanation: safetyVeto
        ? safetyVetoReason
        : chiefOfficer.reasons[0] ?? "暂无额外风险说明。",
      scoreBreakdown: weights.map(weight => ({
        label: weight.role,
        score: weight.score,
        explanation: `按${Math.round(weight.weight * 100)}%权重计入综合评分。`,
      })),
      dataEvidence: {
        matchedHighPerformance: false,
        matchedCount: 0,
        items: [],
        impact: "本次没有接入历史表现数据，不对评分进行额外加权。",
        debugMessage: "未提供历史表现数据。",
        calibration: {
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          matchedCount: 0,
          dominant: "none",
          hasConflict: false,
          topMatchScore: 0,
        },
      },
      knowledgeDiagnosis: {
        matched: false,
        reason: "本次接口未提供知识库匹配结果。",
        nextStep: "可补充相关知识条目后重新评估。",
      },
      scoringBasis: {
        knowledgeRules: [],
        historicalData: [],
        ipInfo: [`当前IP：${ip.name}`, `定位：${ip.positioning}`, `受众：${ip.audience}`],
        positiveFactors: [],
        negativeFactors: chiefOfficer.reasons,
      },
      optimizationPlan: {
        coreReason: safetyVeto
          ? safetyVetoReason
          : chiefOfficer.reasons[0] ?? "需要进一步验证选题角度。",
        keepParts: safetyVeto ? [] : [topic],
        weakenParts: safetyVeto ? [safetyVetoReason] : [],
        rewrittenDirections: safetyVeto ? [] : verdictParsed.upgradedTopics ?? [],
        retestSuggestion: safetyVeto
          ? "当前版本不得测试；完成安全改写后重新评估。"
          : verdict === "暂缓"
          ? "优化后重新评估。"
          : "建议先小规模测试。",
      },
      credScore: verdictParsed.credScore ?? 60,
      credReasons: verdictParsed.credReasons ?? [],
      risks: verdictParsed.risks ?? [],
      upgradedTopics: verdictParsed.upgradedTopics ?? [],
      titles: verdictParsed.titles ?? [],
      personaPreview,
      hasPersonas: personas.length > 0,
    });
    return NextResponse.json(boardResult);

  } catch (err) {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const topicError = err instanceof TopicReviewAIError ? err : null;
    if (topicError?.errorCode === "INVALID_SAFETY_REVIEW") {
      return NextResponse.json({
        error: "安全校验异常，无法确认，请稍后重试。",
        errorCode: "SAFETY_REVIEW_INVALID",
        errorStage: topicError.stage,
      }, { status: 502 });
    }
    return NextResponse.json({
      error: isDevelopment && err instanceof Error ? err.message : "AI评审失败，请重试",
      ...(isDevelopment && topicError
        ? {
            errorStage: topicError.stage,
            requestId: topicError.responseMeta?.requestId ?? null,
            finishReason: topicError.responseMeta?.finishReason ?? null,
            completionTokens: topicError.responseMeta?.completionTokens ?? null,
          }
        : {}),
    }, { status: 500 });
  }
}
