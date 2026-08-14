import {
  COMPLETE_VIDEO_SECTION_ROLES,
  COMPLETE_VIDEO_SUPPLEMENTAL_KINDS,
  type CompleteVideoPlanSection,
  type CompleteVideoSupplementalKind,
} from "./live-clips-types";

const SUPPLEMENTAL_SUGGESTIONS: Record<CompleteVideoSupplementalKind, string> = {
  problem_hook: "补录一句直接提出本条视频要解决的问题，不增加新的事实。",
  conflict_hook: "补录一句指出观众常见误区，并立即承接主体原片，不增加新的事实。",
  summary_closure: "补录一句重新概括主体已经表达的核心观点，不增加新的事实或承诺。",
  action_closure: "补录一句邀请观众根据本条内容采取下一步行动，不增加产品、价格或效果承诺。",
};

export function isCompleteVideoSupplementalKind(value: unknown): value is CompleteVideoSupplementalKind {
  return typeof value === "string" && COMPLETE_VIDEO_SUPPLEMENTAL_KINDS.includes(value as CompleteVideoSupplementalKind);
}

export function supplementalSuggestion(kind: CompleteVideoSupplementalKind) {
  return SUPPLEMENTAL_SUGGESTIONS[kind];
}

export function isSupplementalKindAllowedForRole(
  role: unknown,
  kind: CompleteVideoSupplementalKind,
) {
  return role === "opening"
    ? kind === "problem_hook" || kind === "conflict_hook"
    : role === "ending"
      ? kind === "summary_closure" || kind === "action_closure"
      : false;
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

export function isCompleteVideoPlanSection(value: unknown): value is CompleteVideoPlanSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const section = value as Record<string, unknown>;
  if (
    typeof section.role !== "string"
    || !COMPLETE_VIDEO_SECTION_ROLES.includes(section.role as typeof COMPLETE_VIDEO_SECTION_ROLES[number])
    || typeof section.transitionNote !== "string"
    || !nullableString(section.startTime)
    || !nullableString(section.endTime)
  ) return false;
  if (section.sourceType === "supplemental") {
    return isCompleteVideoSupplementalKind(section.supplementalKind)
      && isSupplementalKindAllowedForRole(section.role, section.supplementalKind)
      && section.candidateId === null
      && section.startParagraph === null
      && section.endParagraph === null
      && section.rawText === null
      && section.cleanedText === null
      && section.supplementalSuggestion === supplementalSuggestion(section.supplementalKind);
  }
  return section.sourceType === "transcript"
    && (section.candidateId === null || typeof section.candidateId === "string")
    && typeof section.startParagraph === "number"
    && Number.isInteger(section.startParagraph)
    && section.startParagraph > 0
    && typeof section.endParagraph === "number"
    && Number.isInteger(section.endParagraph)
    && section.endParagraph >= section.startParagraph
    && typeof section.rawText === "string"
    && typeof section.cleanedText === "string"
    && section.supplementalKind === null
    && section.supplementalSuggestion === null;
}

export function completeVideoSectionsError(sections: CompleteVideoPlanSection[]) {
  if (sections.length < 3 || sections.length > 5) return "完整成片方案段落数量必须在3到5之间";
  const roles = sections.map(section => section.role);
  if (new Set(roles).size !== roles.length || !roles.includes("opening") || !roles.includes("body") || !roles.includes("ending")) {
    return "完整成片方案必须有且仅有一个开头、主体和结尾";
  }
  const ranks = roles.map(role => COMPLETE_VIDEO_SECTION_ROLES.indexOf(role));
  if (ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1])) return "成片段落顺序必须从开头到结尾";
  const body = sections.find(section => section.role === "body");
  if (!body || body.sourceType !== "transcript") return "主体必须来自直播原片";
  for (let left = 0; left < sections.length; left += 1) {
    const leftSection = sections[left];
    if (leftSection.sourceType !== "transcript") continue;
    for (let right = left + 1; right < sections.length; right += 1) {
      const rightSection = sections[right];
      if (rightSection.sourceType !== "transcript") continue;
      if (Math.max(leftSection.startParagraph, rightSection.startParagraph) <= Math.min(leftSection.endParagraph, rightSection.endParagraph)) {
        return "成片方案不能重复使用同一段原文";
      }
    }
  }
  return null;
}
