import { NextRequest, NextResponse } from "next/server";
import { CommentRadarResult } from "@/components/comment-radar/types";

function seeded(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
}

function buildResult(comments: string, platform: string): CommentRadarResult {
  const lines = comments.split("\n").map(l => l.trim()).filter(Boolean);
  const total = Math.max(lines.length, 20);
  const rand = seeded(comments);

  const healthScore = Math.round(60 + rand() * 35);
  const buyScore = Math.round(50 + rand() * 45);
  const commercialScore = Math.round(65 + rand() * 30);

  return {
    overview: {
      total,
      valid: Math.round(total * (0.7 + rand() * 0.2)),
      invalid: Math.round(total * (0.05 + rand() * 0.1)),
      emotional: Math.round(total * (0.3 + rand() * 0.2)),
      questions: Math.round(total * (0.25 + rand() * 0.2)),
      buyInquiry: Math.round(total * (0.08 + rand() * 0.12)),
      healthScore,
    },
    freqQuestions: [
      { question: "AI小白怎么开始学？", count: Math.round(40 + rand() * 30), percent: Math.round(18 + rand() * 10) },
      { question: "不会写提示词怎么办？", count: Math.round(30 + rand() * 25), percent: Math.round(13 + rand() * 8) },
      { question: "需要学编程吗？", count: Math.round(25 + rand() * 20), percent: Math.round(11 + rand() * 7) },
      { question: "用哪个AI工具最好？", count: Math.round(20 + rand() * 18), percent: Math.round(9 + rand() * 6) },
      { question: "AI副业真的能赚钱吗？", count: Math.round(18 + rand() * 15), percent: Math.round(8 + rand() * 5) },
      { question: "每天要花多少时间学习？", count: Math.round(15 + rand() * 12), percent: Math.round(7 + rand() * 4) },
      { question: "有没有系统的学习路径？", count: Math.round(12 + rand() * 10), percent: Math.round(5 + rand() * 4) },
      { question: "如何避免学AI踩坑？", count: Math.round(10 + rand() * 8), percent: Math.round(4 + rand() * 3) },
      { question: "国内能用ChatGPT吗？", count: Math.round(8 + rand() * 7), percent: Math.round(3 + rand() * 3) },
      { question: "变现方式有哪些？", count: Math.round(7 + rand() * 6), percent: Math.round(3 + rand() * 2) },
    ],
    realNeeds: [
      { surface: "有没有适合新手的方法？", real: ["害怕踩坑浪费时间", "希望有人带着走", "想快速看到结果", "担心自己学不会"] },
      { surface: "能赚多少钱？", real: ["对现状不满足", "想改变收入结构", "需要看到真实案例", "渴望财务自由"] },
      { surface: "多久能学会？", real: ["时间成本焦虑", "急于求成心理", "缺乏长期规划", "想快速验证可行性"] },
      { surface: "有没有课程？", real: ["希望系统化学习", "不信任碎片化信息", "愿意为确定性付费", "需要社群支持"] },
      { surface: "和别人有什么不一样？", real: ["市场信息过载", "难以判断真假", "需要权威背书", "希望找到差异化路径"] },
    ],
    emotions: [
      { emotion: "焦虑", percent: Math.round(25 + rand() * 15) },
      { emotion: "迷茫", percent: Math.round(18 + rand() * 10) },
      { emotion: "好奇", percent: Math.round(15 + rand() * 10) },
      { emotion: "认可", percent: Math.round(12 + rand() * 8) },
      { emotion: "怀疑", percent: Math.round(10 + rand() * 6) },
      { emotion: "兴奋", percent: Math.round(8 + rand() * 5) },
      { emotion: "反对", percent: Math.round(5 + rand() * 4) },
      { emotion: "吐槽", percent: Math.round(4 + rand() * 3) },
    ],
    userProfile: {
      stages: [
        { label: "小白", percent: Math.round(35 + rand() * 15) },
        { label: "入门", percent: Math.round(28 + rand() * 12) },
        { label: "进阶", percent: Math.round(20 + rand() * 10) },
        { label: "专业", percent: Math.round(8 + rand() * 6) },
      ],
      goals: [
        { label: "副业赚钱", percent: Math.round(32 + rand() * 15) },
        { label: "转行", percent: Math.round(22 + rand() * 12) },
        { label: "涨粉变现", percent: Math.round(18 + rand() * 10) },
        { label: "接单", percent: Math.round(15 + rand() * 8) },
        { label: "创业", percent: Math.round(8 + rand() * 5) },
      ],
      summary: "主要是25-35岁的职场人，有一定学习意愿，但缺乏系统方法。核心诉求是用最短时间找到一条可以实际落地的AI变现路径，对「省时间、快出结果、有人带」这三点最为敏感。",
    },
    buyIntent: {
      score: buyScore,
      comments: [
        { text: "有没有系统课程可以报名？", intent: "high" },
        { text: "怎么加你的付费社群？", intent: "high" },
        { text: "能不能一对一带做？", intent: "high" },
        { text: "有没有资料包？多少钱？", intent: "high" },
        { text: "训练营什么时候开？", intent: "mid" },
        { text: "有没有免费的先看看？", intent: "mid" },
        { text: "能不能出个系列视频？", intent: "mid" },
      ],
    },
    opportunities: [
      { name: "AI副业入门训练营", grade: "S", reason: "需求集中、付费意愿高、可持续招生" },
      { name: "新手提示词模板包", grade: "A", reason: "低门槛、高需求、可作为引流产品" },
      { name: "AI变现路线图社群", grade: "A", reason: "用户渴望归属感和持续指导" },
      { name: "一对一AI起步咨询", grade: "B", reason: "高单价但时间成本高，可作为高端产品" },
      { name: "AI工具测评合集", grade: "B", reason: "流量大但变现链路较长" },
      { name: "直播间AI教学", grade: "S", reason: "即时互动、快速成交、低制作成本" },
    ],
    objections: [
      { text: "AI都是割韭菜的", response: "理解你的顾虑，市面上确实有很多噱头。我一直坚持的是先教方法、先出结果，你可以先看免费内容判断。" },
      { text: "AI根本赚不到钱", response: "赚不到钱往往是方向选错了。我可以分享几个真实月入5位数的案例，看看是不是你想要的路径。" },
      { text: "学AI太难了我不适合", response: "你现在用手机点外卖的逻辑就够用了。我教的方法不需要写代码，零基础3天就能出第一个作品。" },
      { text: "又是卖课的", response: "课程只是其中一种形式，更多内容我都在视频里免费分享。你可以先消化免费的，觉得有价值再考虑深入。" },
      { text: "这种方法会不会很快过时？", response: "工具会变，但用AI提效的底层思维不会变。我教的框架在GPT-3时代就有效，现在依然适用。" },
    ],
    topics: [
      { title: "为什么你学AI半年还赚不到钱？", source: "大量用户反映学了但没变现", viralScore: 92, difficulty: "低", hook: "很多人学AI半年都没赚到钱，其实第一步就做错了。", body: "分析三大原因：方向错、工具错、没有实战", cta: "评论区回复「路径」领取AI变现路线图" },
      { title: "AI小白第一周应该做什么？", source: "新手不知道从哪里开始", viralScore: 88, difficulty: "低", hook: "如果我重新学AI，第一周只做这3件事。", body: "具体步骤：工具选择、基础练习、第一个作品", cta: "关注后发你详细计划表" },
      { title: "不会写提示词？这个方法三天学会", source: "提示词是最高频的问题", viralScore: 85, difficulty: "低", hook: "95%的人写提示词都犯了同一个错误。", body: "万能提示词公式拆解", cta: "评论区留言发你模板" },
      { title: "我用AI接单的第一个月真实收入", source: "用户对变现数据极度好奇", viralScore: 95, difficulty: "中", hook: "说个真实的数字：我用AI接单第一个月收了X元。", body: "还原接单全过程，包括失败和成功", cta: "想复制这个路径？评论区扣1" },
      { title: "国内用AI不需要翻墙的5个替代方案", source: "工具使用门槛是痛点", viralScore: 82, difficulty: "低", hook: "不会翻墙？这5个工具在国内直接用。", body: "逐一测评国内可用AI工具", cta: "关注我，每周更新AI工具测评" },
    ],
    replies: [
      {
        comment: "不会写提示词怎么办？",
        pro: "提示词写作有固定框架：角色+任务+背景+格式。建议从简单任务开始练习，逐步积累。",
        warm: "完全理解！我刚开始也觉得好难。其实掌握一个万能公式就够了，要我发给你吗？",
        sell: "我整理了一份新手提示词模板包，涵盖50个常用场景，私信我发你参考。",
      },
      {
        comment: "AI副业真的能赚钱吗？",
        pro: "AI变现的核心是找到需求缺口+可交付的技能。有真实案例可以参考，关键在于方向选择。",
        warm: "能！我身边有好几个人已经在靠AI赚副业了。关键是找对方向，你现在是什么职业背景？",
        sell: "我有一份AI副业变现路线图，整理了6条最适合普通人的路径，需要的话可以发你。",
      },
      {
        comment: "需要学编程吗？",
        pro: "不需要。目前主流AI应用场景（内容创作、数据分析、图像生成）均无需编程基础。",
        warm: "完全不需要！我自己也不会写代码，照样用AI做了很多有价值的东西。",
        sell: "零基础3天入门AI的方法我整理成了资料，私信我「零基础」发你。",
      },
    ],
    radar: [
      { name: "需求热度", value: Math.round(70 + rand() * 25) },
      { name: "流量潜力", value: Math.round(65 + rand() * 28) },
      { name: "购买潜力", value: Math.round(60 + rand() * 30) },
      { name: "产品潜力", value: Math.round(68 + rand() * 25) },
      { name: "内容潜力", value: Math.round(72 + rand() * 22) },
    ],
    opportunities_summary: {
      bestVideos: ["为什么你学AI半年还赚不到钱？", "我用AI接单的第一个月真实收入", "不会写提示词？这个方法三天学会"],
      bestProduct: "AI副业入门训练营（7天），定价499-999元",
      bestLive: "AI工具实操直播：从0到第一个AI作品",
      bestMaterial: "AI变现路线图 + 新手提示词模板包（作为引流礼品）",
    },
    commercialScore,
  };
}

export async function POST(req: NextRequest) {
  let body: { platform?: string; comments?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const comments = (body.comments ?? "").trim();
  if (!comments || comments.length < 10) {
    return NextResponse.json({ error: "请粘贴至少几条评论内容" }, { status: 400 });
  }

  await new Promise(r => setTimeout(r, 500));
  return NextResponse.json(buildResult(comments, body.platform ?? "抖音"));
}
