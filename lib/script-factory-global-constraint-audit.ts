import {
  detectGlobalBlockingConstraints,
  type GlobalBlockingConstraintMatch,
} from "./global-content-constraint-detector";

export type ScriptFactoryConstraintMatchSource =
  | "标题"
  | "封面文案"
  | "口播正文"
  | "评论区引导"
  | "分镜时间"
  | "分镜画面"
  | "分镜口播"
  | "分镜字幕"
  | "分镜镜头"
  | "分镜素材"
  | "分镜剪辑建议"
  | "拍摄建议"
  | "镜头提示词"
  | "剪辑建议";

export interface ScriptFactoryConstraintMatch extends GlobalBlockingConstraintMatch {
  sources: ScriptFactoryConstraintMatchSource[];
}

export interface ScriptFactoryConstraintAuditInput {
  titles: ReadonlyArray<{
    title: string;
    formula?: string;
    platform?: string;
    whyFitsIP?: string;
    role?: string;
  }>;
  coverCopy: readonly string[];
  outline: ReadonlyArray<{
    label?: string;
    timeRange?: string;
    content: string;
    subPoints?: readonly string[];
  }>;
  commentGuidance: {
    interactionPrompt: string;
    keywordReplies: ReadonlyArray<{ keyword: string; reply: string }>;
    dmGuidance: string;
    materialPackGuidance: string;
  };
  storyboard: ReadonlyArray<{
    time: string;
    scene: string;
    voiceover: string;
    subtitle: string;
    shot: string;
    material: string;
    editingTip: string;
  }>;
  shootingSuggestions: readonly string[];
  shotPrompts: ReadonlyArray<{ scene: string; prompt: string }>;
  editingRhythm: {
    subtitleHighlights: readonly string[];
    soundEffects: readonly string[];
    screenRecordingCuts: readonly string[];
    caseInserts: readonly string[];
    pauses: readonly string[];
  };
}

interface SurfaceOccurrence {
  match: GlobalBlockingConstraintMatch;
  logicalKey: string;
}

interface AuditedSurface {
  id: string;
  source: ScriptFactoryConstraintMatchSource;
  text: string;
  occurrences: SurfaceOccurrence[];
}

interface SurfaceRelation {
  surface: AuditedSurface;
  parentTextOffset: number;
  childTextOffset: number;
}

function uniqueTextOffset(haystack: string, needle: string): number | null {
  const first = haystack.indexOf(needle);
  return first !== -1 && first === haystack.lastIndexOf(needle) ? first : null;
}

function uniqueRelatedParent(
  text: string,
  candidates: readonly AuditedSurface[],
): SurfaceRelation | null {
  const matches = candidates.flatMap(surface => {
    const parentTextOffset = uniqueTextOffset(surface.text, text);
    if (parentTextOffset !== null) {
      return [{ surface, parentTextOffset, childTextOffset: 0 }];
    }
    const childTextOffset = uniqueTextOffset(text, surface.text);
    return childTextOffset === null
      ? []
      : [{ surface, parentTextOffset: 0, childTextOffset }];
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function auditScriptFactoryGlobalConstraints(
  input: ScriptFactoryConstraintAuditInput,
  rules: readonly unknown[],
) {
  const grouped = new Map<string, ScriptFactoryConstraintMatch>();
  const equivalentMatchCanonical = new Map<string, { surfaceId: string; logicalKey: string }>();

  function addSurface(
    id: string,
    source: ScriptFactoryConstraintMatchSource,
    text: string,
    parentCandidates: readonly AuditedSurface[] = [],
    mergeEquivalentAcrossSurfaces = false,
  ): AuditedSurface {
    const parent = text ? uniqueRelatedParent(text, parentCandidates) : null;
    const detection = detectGlobalBlockingConstraints(text, rules);
    const surface: AuditedSurface = {
      id,
      source,
      text,
      occurrences: detection.matches.map(match => {
        const relativeStart = parent ? match.start - parent.childTextOffset : -1;
        const relativeEnd = parent ? match.end - parent.childTextOffset : -1;
        const parentOccurrence = parent
          && relativeStart >= 0
          && relativeEnd <= parent.surface.text.length
          ? parent.surface.occurrences.find(candidate =>
            candidate.match.ruleId === match.ruleId
            && candidate.match.start === parent.parentTextOffset + relativeStart
            && candidate.match.end === parent.parentTextOffset + relativeEnd)
          : undefined;
        const equivalentKey = mergeEquivalentAcrossSurfaces
          ? `${source}\u0000${match.ruleId}\u0000${match.matchedText}`
          : null;
        const canonical = equivalentKey ? equivalentMatchCanonical.get(equivalentKey) : undefined;
        const logicalKey = parentOccurrence?.logicalKey
          ?? (canonical && canonical.surfaceId !== id
            ? canonical.logicalKey
            : `${id}:${match.ruleId}:${match.start}:${match.end}`);
        if (equivalentKey && !canonical) {
          equivalentMatchCanonical.set(equivalentKey, { surfaceId: id, logicalKey });
        }
        const existing = grouped.get(logicalKey);
        if (existing) {
          if (!existing.sources.includes(source)) existing.sources.push(source);
        } else {
          grouped.set(logicalKey, { ...match, sources: [source] });
        }
        return { match, logicalKey };
      }),
    };
    return surface;
  }

  input.titles.forEach((item, index) => {
    addSurface(`title:${index}:title`, "标题", item.title, [], true);
    addSurface(`title:${index}:formula`, "标题", item.formula ?? "", [], true);
    addSurface(`title:${index}:platform`, "标题", item.platform ?? "", [], true);
    addSurface(`title:${index}:why`, "标题", item.whyFitsIP ?? "", [], true);
    addSurface(`title:${index}:role`, "标题", item.role ?? "", [], true);
  });
  input.coverCopy.forEach((text, index) => addSurface(`cover:${index}`, "封面文案", text));
  const outlineSurfaces = input.outline.map((item, index) => {
    addSurface(`outline:${index}:label`, "口播正文", item.label ?? "");
    addSurface(`outline:${index}:time`, "口播正文", item.timeRange ?? "");
    const content = addSurface(`outline:${index}:content`, "口播正文", item.content);
    item.subPoints?.forEach((text, subPointIndex) =>
      addSurface(`outline:${index}:sub-point:${subPointIndex}`, "口播正文", text, [content]));
    return content;
  });

  addSurface("comment:interaction", "评论区引导", input.commentGuidance.interactionPrompt);
  input.commentGuidance.keywordReplies.forEach((item, index) => {
    addSurface(`comment:keyword:${index}`, "评论区引导", item.keyword);
    addSurface(`comment:reply:${index}`, "评论区引导", item.reply);
  });
  addSurface("comment:dm", "评论区引导", input.commentGuidance.dmGuidance);
  addSurface("comment:material", "评论区引导", input.commentGuidance.materialPackGuidance);

  const storyboardSubtitleSurfaces: AuditedSurface[] = [];
  const storyboardSceneSurfaces: AuditedSurface[] = [];
  input.storyboard.forEach((row, index) => {
    addSurface(`storyboard:${index}:time`, "分镜时间", row.time);
    const scene = addSurface(`storyboard:${index}:scene`, "分镜画面", row.scene);
    storyboardSceneSurfaces.push(scene);
    const voiceover = addSurface(
      `storyboard:${index}:voiceover`,
      "分镜口播",
      row.voiceover,
      outlineSurfaces,
    );
    storyboardSubtitleSurfaces.push(addSurface(
      `storyboard:${index}:subtitle`,
      "分镜字幕",
      row.subtitle,
      [voiceover],
    ));
    addSurface(`storyboard:${index}:shot`, "分镜镜头", row.shot);
    addSurface(`storyboard:${index}:material`, "分镜素材", row.material);
    addSurface(`storyboard:${index}:editing`, "分镜剪辑建议", row.editingTip);
  });

  input.shootingSuggestions.forEach((text, index) =>
    addSurface(`shooting:${index}`, "拍摄建议", text));
  input.shotPrompts.forEach((item, index) => {
    addSurface(`shot-prompt:${index}:scene`, "镜头提示词", item.scene, storyboardSceneSurfaces);
    addSurface(`shot-prompt:${index}:prompt`, "镜头提示词", item.prompt);
  });
  input.editingRhythm.subtitleHighlights.forEach((text, index) =>
    addSurface(`editing:subtitle:${index}`, "剪辑建议", text, storyboardSubtitleSurfaces));
  input.editingRhythm.soundEffects.forEach((text, index) =>
    addSurface(`editing:sound:${index}`, "剪辑建议", text));
  input.editingRhythm.screenRecordingCuts.forEach((text, index) =>
    addSurface(`editing:screen:${index}`, "剪辑建议", text));
  input.editingRhythm.caseInserts.forEach((text, index) =>
    addSurface(`editing:case:${index}`, "剪辑建议", text));
  input.editingRhythm.pauses.forEach((text, index) =>
    addSurface(`editing:pause:${index}`, "剪辑建议", text));

  const matches = [...grouped.values()];
  return {
    reviewRequired: matches.length > 0,
    detectionMode: "keyword" as const,
    semanticAssessment: "not_implemented" as const,
    matches,
  };
}
