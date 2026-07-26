import { NextRequest, NextResponse } from "next/server";
import { IPProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { callDeepSeek, parseDeepSeekJSONArray } from "@/lib/deepseek";

// ── AI 编导提案：每周选题会的"考生"，为董事会（考官）供给候选选题 ──

const PROPOSAL_SYSTEM = `你是一位短视频编导，负责在每周选题会上为特定 IP 提出可拍选题。你的提案将被送入选题董事会接受四标准评审，所以提案必须务实、可拍、贴人设。

## 提案规则
1. 产出 10 个选题，来源配比严格遵守：
   - 6 个"蹭势"：从本周热点情报和爆款拆解结论延伸，借势但必须结合该IP的专业视角做出增量
   - 2 个"顺势"：从上期复盘中观众反应强烈的点延伸，观众已经用行为投票想看什么
   - 2 个"造势"：纯原创、体现该IP特立独行一面的选题——一味迎合用户会失去特色
   （若某路情报为空，将该配额挪给"造势"，配比总数保持10个）
2. 每个选题必须写明：为什么是现在拍（时效依据）、为什么是这个IP拍（人设依据）、预判的钩子方向。
3. 选题之间不许同质化，覆盖至少3种内容形态（教程/观点/揭秘/实测/故事/清单等）。
4. 禁止提出点名曝光、指控、批判具体公司/品牌/个人的选题（此类选题会被董事会安全否决）。
5. 选题标题必须符合该IP的表达风格，禁止使用它明确禁用的表达。

## 输出格式
只输出JSON数组，无其他文字，不用代码块包裹，第一个字符必须是[：
[{"topic":"一句话选题","timing":"为什么是现在拍（1句话）","fit":"为什么是这个IP拍（1句话，点名人设优势）","hook":"预判的钩子方向（1句话）","type":"内容形态","source":"蹭势或顺势或造势"}]`;

const PROPOSAL_PROMPT = (
  ipBlock: string,
  hotspots: string,
  viralCases: string,
  reviewNotes: string,
  commentNeeds: string,
) => `${ipBlock}

## 本周情报输入

【上周热点情报】
${hotspots || "（本周无热点情报输入）"}

【爆款案例库摘要】
${viralCases || "（暂无爆款案例）"}

【上期复盘要点】
${reviewNotes || "（暂无复盘记录）"}

【评论区需求信号】
${commentNeeds || "（暂无评论需求记录）"}

请基于以上情报和这个IP的人设，按提案规则产出10个可拍选题。`;

interface ProposalItem {
  topic: string;
  timing: string;
  fit: string;
  hook: string;
  type: string;
  source: string;
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: {
    ipProfile?: IPProfile;
    hotspots?: string;
    viralCases?: string;
    reviewNotes?: string;
    commentNeeds?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  if (!body.ipProfile) {
    return NextResponse.json({ error: "请先在 IP 身份中心选择当前操盘 IP" }, { status: 400 });
  }

  const ipBlock = buildIPContextBlock(body.ipProfile);

  try {
    const raw = await callDeepSeek(
      PROPOSAL_SYSTEM,
      PROPOSAL_PROMPT(
        ipBlock,
        (body.hotspots ?? "").trim(),
        (body.viralCases ?? "").trim(),
        (body.reviewNotes ?? "").trim(),
        (body.commentNeeds ?? "").trim(),
      ),
      2000,
      0.8, // 提案是发散型任务，温度略高于评审
      apiKey,
    );

    const parsed = parseDeepSeekJSONArray<ProposalItem>(raw, []);
    const proposals = (Array.isArray(parsed) ? parsed : [])
      .filter(p => p && typeof p.topic === "string" && p.topic.trim().length > 0)
      .slice(0, 12)
      .map(p => ({
        topic: p.topic.trim(),
        timing: p.timing ?? "",
        fit: p.fit ?? "",
        hook: p.hook ?? "",
        type: p.type ?? "其他",
        source: ["蹭势", "顺势", "造势"].includes(p.source) ? p.source : "蹭势",
      }));

    if (proposals.length === 0) {
      return NextResponse.json({ error: "提案生成失败，请重试" }, { status: 500 });
    }

    return NextResponse.json({ proposals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "提案生成失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
