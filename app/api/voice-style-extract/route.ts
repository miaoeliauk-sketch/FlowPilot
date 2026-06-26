import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

interface SampleInput {
  id: string;
  title: string;
  rawText: string;
}

interface RequestBody {
  ipName?: string;
  samples?: SampleInput[];
}

const EXTRACT_SYSTEM = `你是一位资深的内容风格分析师，专门从一个人/一个账号的多篇真实口播逐字稿中，反向提炼出这个人独特的"语感画像"，
目的是让后续的AI改写能真正写出"像这个人在说话"的效果，而不是泛泛的风格分类。

你必须做到具体、可执行、有证据支撑，严禁输出"理性""专业""有深度"这类空洞标签而不给出具体例子。
每一项结论都应该能让人指着某一句原文说"对，就是这种感觉"。
句子长度的判断要基于实际逐字稿里的句子做统计感受，不是猜测。
禁用表达要重点找"AI生成感"强的、和这个人真实语感不符的表达（比如过于书面、过于客套、过于宏大空洞的词），而不是泛泛而谈。
严格按JSON格式输出，不要输出任何其他文字。`;

const EXTRACT_PROMPT = (ipName: string, samplesText: string) => `分析对象：${ipName}

以下是这个IP的${samplesText ? "" : "（无样本）"}多篇真实口播逐字稿样本，请逐篇通读后提炼出统一的风格画像：

${samplesText}

请严格按以下JSON格式输出：
{
  "openingHabits": ["从样本中实际出现过的开头句式或开头模式，3-5条，尽量贴近原文措辞，不要泛化成抽象描述"],
  "viewpointStyle": "这个人表达观点的方式（例如：先抛结论再补案例 / 先讲一个故事再引出观点 / 先说现象再拆解本质），1-2句话，要具体",
  "sentenceLength": "短句为主 | 中句为主 | 长句为主 | 长短句结合，根据样本实际句子长度分布判断，四选一",
  "emotionalTone": ["情绪风格标签，2-4个，例如理性、犀利、陪伴感、操盘手视角、导师型、朋友型，必须是样本里真实体现出来的，不要套模板"],
  "commonPhrases": ["从样本中提取的真实高频词/口头禅，5-10个"],
  "closingHabits": ["从样本中实际出现过的结尾方式，3-5条，例如具体的引导语句式"],
  "forbiddenExpressions": ["这个人明显不会说的话/不符合其真实语感的AI味表达或书面语，3-6条，给出具体词句而不是空泛分类"],
  "styleSummary": "用3-4句话，像介绍一个真实的人一样，描述这个IP说话的整体感觉，要让人读完能在脑子里听见这个人的声音"
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return NextResponse.json(
      { error: "请求格式错误", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } },
      { status: 400 }
    );
  }

  const samples = (body.samples ?? []).filter((s) => s.rawText && s.rawText.trim().length > 0);
  const ipName = body.ipName ?? "未指定IP";

  if (samples.length === 0) {
    return NextResponse.json(
      { error: "至少需要1篇有效的口播逐字稿样本才能学习风格，建议3-5篇", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: ipName, mockHit: false } },
      { status: 400 }
    );
  }

  const samplesText = samples
    .map((s, i) => `【样本${i + 1}：${s.title || "未命名样本"}】\n${s.rawText.trim()}`)
    .join("\n\n");

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: ipName, mockHit: false };

  try {
    const raw = await callDeepSeek(EXTRACT_SYSTEM, EXTRACT_PROMPT(ipName, samplesText), 2500, 0.3, apiKey);
    const parsed = parseJSON(raw, {
      openingHabits: [] as string[],
      viewpointStyle: "",
      sentenceLength: "长短句结合" as const,
      emotionalTone: [] as string[],
      commonPhrases: [] as string[],
      closingHabits: [] as string[],
      forbiddenExpressions: [] as string[],
      styleSummary: "（AI返回内容解析失败，请重试）",
    });

    return NextResponse.json({
      openingHabits: parsed.openingHabits ?? [],
      viewpointStyle: parsed.viewpointStyle ?? "",
      sentenceLength: parsed.sentenceLength ?? "长短句结合",
      emotionalTone: parsed.emotionalTone ?? [],
      commonPhrases: parsed.commonPhrases ?? [],
      closingHabits: parsed.closingHabits ?? [],
      forbiddenExpressions: parsed.forbiddenExpressions ?? [],
      styleSummary: parsed.styleSummary ?? "",
      sourceSampleIds: samples.map((s) => s.id),
      sourceSampleTitles: samples.map((s) => s.title || "未命名样本"),
      extractedAt: calledAt,
      model: MODEL,
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "风格提取失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
