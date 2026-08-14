import { IPProfile, IPStyleProfile } from "./types";

/**
 * 把一个IP的完整身份信息序列化成注入AI Prompt的上下文块。
 * 这个函数是唯一数据源：IP管理页/选题董事会的"查看上下文"按钮预览的内容，
 * 与真正发给DeepSeek的Prompt内容完全一致，不存在两套逻辑。
 *
 * styleProfile 为可选参数：传入则在末尾追加"风格画像"区块（来自口播逐字稿样本库的学习结果），
 * 不传则行为与之前完全一致——其他模块（选题董事会/脚本工厂等）无需改动即可继续使用。
 */
export function buildIPContextBlock(ip: IPProfile, styleProfile?: IPStyleProfile | null): string {
  const list = (arr: string[] | undefined, empty: string) => (arr && arr.length > 0 ? arr.join("、") : empty);
  const yn = (v: boolean | undefined) => (v ? "是" : "否");

  let block = `【当前操盘IP身份档案】
■ 基础信息
IP名称：${ip.name}
IP定位：${ip.positioning || "未填写"}
运营平台：${list(ip.platforms, "未填写")}
目标受众：${ip.audience || "未填写"}
内容方向：${list(ip.contentDirection, "未填写")}

■ 人设信息
人设关键词：${list(ip.personaKeywords, "未填写")}
专业身份：${ip.professionalIdentity || "未填写"}
性格标签：${list(ip.personalityTags, "未填写")}
可信度来源：${ip.credibilitySource || "未填写"}
代表观点：${list(ip.representativeViewpoints, "未填写")}

■ 表达风格
说话语气：${ip.tone || "未填写"}
常用开头句式：${list(ip.commonOpenings, "无特定要求")}
常用结尾句式：${list(ip.commonClosings, "无特定要求")}
常用口头禅：${list(ip.catchphrases, "无")}
文案节奏：${ip.pacing || "未填写"}
禁止使用的表达：${list(ip.forbiddenExpressions, "无")}

■ 拍摄信息（生成拍摄/分镜建议时必须遵守）
常用拍摄场景：${list(ip.commonScenes, "未填写")}
常用镜头形式：${list(ip.commonShotTypes, "未填写")}
是否露脸：${yn(ip.showsFace)}
是否录屏：${yn(ip.usesScreenRecording)}
是否需要B-roll：${yn(ip.needsBroll)}
是否需要案例截图：${yn(ip.needsCaseScreenshots)}
是否需要字幕重点强调：${yn(ip.needsSubtitleHighlight)}

■ 历史内容参考
历史爆款标题示例：${list(ip.sampleViralTitles, "暂无")}
账号爆款风格说明：${ip.styleNotes || "暂无"}`;

  if (styleProfile) {
    block += `

■ 风格画像（从「${list(styleProfile.sourceSampleTitles, "未知样本")}」共${styleProfile.sourceSampleTitles.length}篇真实口播逐字稿中学习提取，比上面"表达风格"字段更具体、更贴近这个IP真实的语感，二者冲突时以此为准）
开头习惯：${list(styleProfile.openingHabits, "未提取")}
观点表达方式：${styleProfile.viewpointStyle || "未提取"}
句子长度特征：${styleProfile.sentenceLength}
情绪风格：${list(styleProfile.emotionalTone, "未提取")}
高频用词：${list(styleProfile.commonPhrases, "未提取")}
结尾方式：${list(styleProfile.closingHabits, "未提取")}
额外禁用表达（从真实样本反推出的AI味/书面语/不像本人的表达，与上面"禁止使用的表达"共同生效）：${list(styleProfile.forbiddenExpressions, "无")}
整体语感摘要：${styleProfile.styleSummary || "无"}`;
  }

  block += `

【强制要求】
你必须把以上IP身份当作不可更改的事实前提。你的所有观察、推理、结论、标题、文案、脚本、拍摄建议都必须从这个IP的人设、受众、表达风格和拍摄习惯出发，
而不是给出一个适用于任何账号的通用回答。如果换成另一个定位完全不同的IP，你的输出应该在语言风格、受众视角、内容重点、结尾引导、拍摄建议上都明显不同。
绝对不要使用"禁止使用的表达"里列出的词汇或句式。常用口头禅、常用开头/结尾只能在语义合适时自然、选择性使用，不要求全部出现，
不得为了贴人设标签而密集堆叠。`;

  return block;
}
