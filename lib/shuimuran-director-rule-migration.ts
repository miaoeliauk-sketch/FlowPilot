import { buildScriptDirectorBlock, type ScriptDirectorProfileId } from "./script-director-profile";
import {
  calculateScriptDirectorRuleContentHash,
  parseScriptDirectorRule,
  type ScriptDirectorRule,
  type ScriptDirectorRuleItem,
} from "./script-director-rule";
import {
  getScriptDirectorRules,
  saveScriptDirectorRule,
} from "./script-director-rule-store";

const MIGRATION_VERSION = "1.0.0";

function item(
  id: string,
  text: string,
  level: ScriptDirectorRuleItem["level"],
  enforcement: ScriptDirectorRuleItem["enforcement"],
  scope: ScriptDirectorRuleItem["scope"],
): ScriptDirectorRuleItem {
  return { id, text, level, enforcement, scope };
}

function migratedRawMarkdown(): string {
  return `${buildScriptDirectorBlock("shuimuran-v1")}

【已验证的独立执行要求】
1. 初稿完成后单独压缩20%至30%，但保留核心案例、事实、因果关系、经典解释和最终结论。
2. 禁止短距离机械清单；命中“第一、第二、第三”“一是、二是、三是”或“首先、其次、最后”时必须重组为一条推理链。
3. 禁止用“1%的人”“值得反复琢磨”“记住这三个字”等脱离本文仍成立的通用结尾。
4. 压缩后必须重新检查禁用开头、单一核心思想、推理支撑和标题—正文—结尾闭环。`;
}

export function buildMigratedShuimuranDirectorRule(input: {
  ipId: string;
  ipName: string;
  migratedAt: string;
}): ScriptDirectorRule {
  const rawMarkdown = migratedRawMarkdown();
  const rule: ScriptDirectorRule = {
    id: `director-rule:${input.ipId}:${MIGRATION_VERSION}:${calculateScriptDirectorRuleContentHash(rawMarkdown).slice(0, 12)}`,
    ipId: input.ipId,
    name: "水木然专属编导规则",
    version: MIGRATION_VERSION,
    status: "draft",
    source: {
      type: "built_in",
      fileName: null,
      rawMarkdown,
      contentHash: calculateScriptDirectorRuleContentHash(rawMarkdown),
      importedAt: input.migratedAt,
    },
    profileContext: {
      ipNameSnapshot: input.ipName,
      source: "ip_profile",
      usePlatformPositioningFromProfile: true,
    },
    targetAudience: [],
    language: {
      catchphrases: [],
      forbiddenExpressions: [
        item("shuimuran-forbidden-generic-opening", "禁止使用‘大家有没有发现一个很有意思的现象’等通用开头。", "quality_warning", "deterministic", "opening"),
        item("shuimuran-forbidden-generic-ending", "禁止使用‘1%的人’‘值得反复琢磨’‘记住这三个字’等通用结尾。", "quality_warning", "deterministic", "ending"),
      ],
      toneGuidelines: [
        item("shuimuran-tone", "表达锋利、明确、有判断，但每个判断后面都要有推理。", "preference", "prompt_only", "body"),
      ],
    },
    opening: {
      requirements: [
        item("shuimuran-opening-contrast", "先否定大众答案，再呈现反常行为和矛盾，最后揭晓经典或规律。", "quality_warning", "model_review", "opening"),
      ],
      forbiddenPatterns: [
        item("shuimuran-opening-banned", "不得以‘大家有没有发现’‘今天跟大家聊一个话题’‘最近发生了一件事’‘你知道为什么吗’开头。", "quality_warning", "deterministic", "opening"),
      ],
    },
    body: {
      reasoningSequence: [
        item("shuimuran-reasoning-chain", "具体现象→反常矛盾→经典原句或老师观点→解释→现实机制→人性或时代规律→最终判断。", "quality_warning", "model_review", "body"),
        item("shuimuran-single-core", "每篇内容只保留一条核心思想，不得机械罗列多个观点。", "quality_warning", "model_review", "body"),
      ],
      casePolicy: {
        maximumCasesPerClaim: 2,
        level: "quality_warning",
        enforcement: "model_review",
        scope: "body",
        requirements: [
          item("shuimuran-case-evidence", "案例必须真正支撑核心判断，不得虚构人物动机或老师经历。", "hard_block", "model_review", "fact"),
        ],
      },
      materialPolicies: [
        item("shuimuran-example-boundary", "格式示例不属于本次创作素材，不得复用其中的人物、企业、事件和结论。", "hard_block", "model_review", "attribution"),
      ],
    },
    ending: {
      requirements: [
        item("shuimuran-ending-loop", "结尾必须回答标题悬念，并回扣本篇案例、经典或核心规律。", "quality_warning", "model_review", "ending"),
      ],
      forbiddenPatterns: [
        item("shuimuran-ending-actions", "不得堆叠点赞、转发、评论和直播预约；需要互动时最多保留一个动作。", "quality_warning", "deterministic", "ending"),
      ],
    },
    examples: [{
      id: "shuimuran-confirmed-title-example",
      kind: "title",
      content: "《胖东来的经营秘诀，就是《道德经》的这八个字》",
      demonstrates: "具体对象＋经典概念＋未揭晓答案",
      sourceReference: "老师已确认标题",
      confirmationStatus: "confirmed",
      materialPermission: false,
      protectedEntities: ["胖东来"],
    }],
    compression: {
      enabled: true,
      targetReduction: {
        minimumPercent: 20,
        maximumPercent: 30,
        level: "quality_warning",
        enforcement: "deterministic",
        scope: "compression",
      },
      mustKeep: [
        item("shuimuran-compression-keep", "保留核心案例、事实、因果关系、经典解释和最终结论。", "hard_block", "model_review", "compression"),
      ],
      preferRemove: [
        item("shuimuran-compression-remove", "优先删除重复观点、相近排比、空泛过渡和通用感悟。", "quality_warning", "prompt_only", "compression"),
      ],
      otherRequirements: [
        item("shuimuran-compression-review", "压缩后重新执行完整质量终审。", "quality_warning", "model_review", "compression"),
      ],
    },
    specialRules: [
      item("shuimuran-spoken-punctuation", "正式作品名称保留书名号；老师原话必须逐字对应IP原始内容；普通强调不用引号；人物对话和明确主体的模拟对话可保留中文引号。", "hard_block", "model_review", "output"),
    ],
    validationRequirements: [
      item("shuimuran-quality-review", "检查禁用开头、机械清单、单一思想、推理支撑、通用结尾、具体闭环和压缩完整性。", "quality_warning", "model_review", "output"),
    ],
    createdAt: input.migratedAt,
    updatedAt: input.migratedAt,
  };
  const parsed = parseScriptDirectorRule(rule);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rule;
}

export function isMigratedShuimuranDirectorRule(input: {
  ipId: string;
  ipName: string;
  rule: ScriptDirectorRule;
}): boolean {
  if (input.ipName.trim() !== "水木然" || input.rule.source.type !== "built_in") return false;
  const expected = buildMigratedShuimuranDirectorRule({
    ipId: input.ipId,
    ipName: input.ipName,
    migratedAt: input.rule.source.importedAt,
  });
  return input.rule.ipId === input.ipId
    && input.rule.id === expected.id
    && input.rule.source.contentHash === expected.source.contentHash;
}

export async function ensureShuimuranDirectorRuleMigrated(input: {
  ipId: string;
  ipName: string;
  legacyProfileId: ScriptDirectorProfileId | null | undefined;
  migratedAt?: string;
}): Promise<ScriptDirectorRule | null> {
  if (input.legacyProfileId !== "shuimuran-v1" || input.ipName.trim() !== "水木然") return null;

  const existing = getScriptDirectorRules(input.ipId);
  const migrated = buildMigratedShuimuranDirectorRule({
    ipId: input.ipId,
    ipName: input.ipName,
    migratedAt: input.migratedAt ?? new Date().toISOString(),
  });
  const current = existing.find(rule => rule.id === migrated.id);
  if (!current && existing.length > 0) {
    return existing.find(rule => rule.status === "active") ?? null;
  }
  if (!current) saveScriptDirectorRule(migrated);

  const stored = current ?? migrated;
  return getScriptDirectorRules(input.ipId).find(rule => rule.id === stored.id) ?? null;
}
