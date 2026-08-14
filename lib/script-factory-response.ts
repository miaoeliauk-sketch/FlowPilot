export type ScriptFactoryResponseErrorCode =
  | "empty_content"
  | "invalid_json"
  | "incomplete_fields"
  | "quality_retry";

export class ScriptFactoryResponseError extends Error {
  readonly code: ScriptFactoryResponseErrorCode;

  constructor(code: ScriptFactoryResponseErrorCode, message: string) {
    super(message);
    this.name = "ScriptFactoryResponseError";
    this.code = code;
  }
}

export interface ScriptContentResponse {
  titles: Array<{
    title: string;
    formula: string;
    platform: string;
    whyFitsIP: string;
    role?: "主推" | "流量" | "安全";
    recommended?: boolean;
  }>;
  coverCopy: string[];
  outline: Array<{
    label: string;
    timeRange: string;
    content: string;
    subPoints: string[];
  }>;
  commentGuidance: {
    interactionPrompt: string;
    keywordReplies: Array<{ keyword: string; reply: string }>;
    dmGuidance: string;
    materialPackGuidance: string;
  };
  ipStyleExplanation: string;
  pendingVerification: string[];
}

export interface ScriptStoryboardResponse {
  storyboard: Array<{
    time: string;
    scene: string;
    voiceover: string;
    subtitle: string;
    shot: string;
    material: string;
    editingTip: string;
  }>;
  shootingSuggestions: string[];
  shotPrompts: Array<{ scene: string; prompt: string }>;
  editingRhythm: {
    subtitleHighlights: string[];
    soundEffects: string[];
    screenRecordingCuts: string[];
    caseInserts: string[];
    pauses: string[];
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(
  object: Record<string, unknown>,
  field: string,
  label = field,
): string {
  const value = optionalString(object[field]);
  if (!value) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      `脚本结果字段不完整：${label}`,
    );
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const item = value.trim();
    return item ? [item] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCompleteJSONObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character !== "{") continue;
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseJSONObject(content: unknown): Record<string, unknown> {
  if (typeof content !== "string" || !content.trim()) {
    throw new ScriptFactoryResponseError(
      "empty_content",
      "AI未返回有效脚本内容",
    );
  }
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const jsonText = extractCompleteJSONObject(cleaned);
  if (!jsonText) {
    throw new ScriptFactoryResponseError(
      "invalid_json",
      "AI返回的脚本JSON不完整",
    );
  }
  try {
    const object = asObject(JSON.parse(jsonText));
    if (!object) throw new Error("not_object");
    return object;
  } catch {
    throw new ScriptFactoryResponseError(
      "invalid_json",
      "AI返回的脚本JSON格式异常",
    );
  }
}

function requiredObjectArray(
  value: unknown,
  field: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      `脚本结果字段不完整：${field}`,
    );
  }
  const items = value.map(asObject);
  if (items.some(item => item === null)) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      `脚本结果字段不完整：${field}`,
    );
  }
  return items as Record<string, unknown>[];
}

export function parseScriptContentResponse(
  content: unknown,
  options: {
    expectedOutlineCount?: number;
    minimumTranscriptChars?: number;
    outputMode?: "default" | "shuimuran-confirmed";
  } = {},
): ScriptContentResponse {
  const object = parseJSONObject(content);
  const titles = requiredObjectArray(object.titles, "titles").map(title => {
    const roleValue = optionalString(title.role);
    const role: "主推" | "流量" | "安全" | undefined =
      roleValue === "主推" || roleValue === "流量" || roleValue === "安全"
        ? roleValue
        : undefined;
    return {
      title: requiredString(title, "title", "titles[].title"),
      formula: optionalString(title.formula),
      platform: optionalString(title.platform),
      whyFitsIP: optionalString(title.whyFitsIP),
      ...(role ? { role } : {}),
      ...(typeof title.recommended === "boolean"
        ? { recommended: title.recommended }
        : {}),
    };
  });
  if (options.outputMode === "shuimuran-confirmed") {
    const expectedFields = ["fullScript", "pendingVerification", "titles"];
    const actualFields = Object.keys(object).sort();
    const pendingVerification = object.pendingVerification;
    if (
      actualFields.length !== expectedFields.length ||
      actualFields.some((field, index) => field !== expectedFields[index]) ||
      !Array.isArray(pendingVerification) ||
      pendingVerification.some(item => typeof item !== "string") ||
      titles.length !== 1
    ) {
      throw new ScriptFactoryResponseError(
        "incomplete_fields",
        "脚本结果字段不完整：shuimuran-confirmed",
      );
    }
    const fullScript = requiredString(object, "fullScript");
    if (
      options.minimumTranscriptChars &&
      fullScript.length < options.minimumTranscriptChars
    ) {
      throw new ScriptFactoryResponseError(
        "incomplete_fields",
        "脚本结果字段不完整：fullScript.length",
      );
    }
    return {
      titles,
      coverCopy: [],
      outline: [{
        label: "完整口播文案",
        timeRange: "完整口播",
        content: fullScript,
        subPoints: [],
      }],
      commentGuidance: {
        interactionPrompt: "",
        keywordReplies: [],
        dmGuidance: "",
        materialPackGuidance: "",
      },
      ipStyleExplanation: "",
      pendingVerification: pendingVerification.map(item => item.trim()).filter(Boolean),
    };
  }
  const coverCopy = stringArray(object.coverCopy);
  if (coverCopy.length === 0) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：coverCopy",
    );
  }
  const outline = requiredObjectArray(object.outline, "outline").map(section => ({
    label: requiredString(section, "label", "outline[].label"),
    timeRange: requiredString(section, "timeRange", "outline[].timeRange"),
    content: requiredString(section, "content", "outline[].content"),
    subPoints: stringArray(section.subPoints),
  }));
  if (
    options.expectedOutlineCount &&
    outline.length !== options.expectedOutlineCount
  ) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：outline.length",
    );
  }
  const transcriptChars = outline.reduce(
    (total, section) => total + section.content.length,
    0,
  );
  if (
    options.minimumTranscriptChars &&
    transcriptChars < options.minimumTranscriptChars
  ) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：outline.content_length",
    );
  }
  const guidance = asObject(object.commentGuidance);
  if (!guidance) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：commentGuidance",
    );
  }
  const keywordReplies = Array.isArray(guidance.keywordReplies)
    ? guidance.keywordReplies.flatMap((item) => {
        const reply = asObject(item);
        if (!reply) return [];
        const keyword = optionalString(reply.keyword);
        const text = optionalString(reply.reply);
        return keyword && text ? [{ keyword, reply: text }] : [];
      })
    : [];

  return {
    titles,
    coverCopy,
    outline,
    commentGuidance: {
      interactionPrompt: requiredString(
        guidance,
        "interactionPrompt",
        "commentGuidance.interactionPrompt",
      ),
      keywordReplies,
      dmGuidance: optionalString(guidance.dmGuidance),
      materialPackGuidance: optionalString(guidance.materialPackGuidance),
    },
    ipStyleExplanation: requiredString(object, "ipStyleExplanation"),
    pendingVerification: stringArray(object.pendingVerification),
  };
}

export function parseScriptStoryboardResponse(
  content: unknown,
  requirements: {
    needsStoryboard: boolean;
    needsShootingTips: boolean;
  },
): ScriptStoryboardResponse {
  const object = parseJSONObject(content);
  const storyboardItems = Array.isArray(object.storyboard)
    ? object.storyboard
    : [];
  if (requirements.needsStoryboard && storyboardItems.length === 0) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：storyboard",
    );
  }
  const storyboard = storyboardItems.map((item) => {
    const row = asObject(item);
    if (!row) {
      throw new ScriptFactoryResponseError(
        "incomplete_fields",
        "脚本结果字段不完整：storyboard[]",
      );
    }
    return {
      time: requiredString(row, "time", "storyboard[].time"),
      scene: requiredString(row, "scene", "storyboard[].scene"),
      voiceover: requiredString(row, "voiceover", "storyboard[].voiceover"),
      subtitle: optionalString(row.subtitle),
      shot: optionalString(row.shot),
      material: optionalString(row.material),
      editingTip: optionalString(row.editingTip),
    };
  });
  const shootingSuggestions = stringArray(object.shootingSuggestions);
  if (requirements.needsShootingTips && shootingSuggestions.length === 0) {
    throw new ScriptFactoryResponseError(
      "incomplete_fields",
      "脚本结果字段不完整：shootingSuggestions",
    );
  }
  const shotPrompts = Array.isArray(object.shotPrompts)
    ? object.shotPrompts.flatMap((item) => {
        const prompt = asObject(item);
        if (!prompt) return [];
        const scene = optionalString(prompt.scene);
        const text = optionalString(prompt.prompt);
        return scene && text ? [{ scene, prompt: text }] : [];
      })
    : [];
  const rawRhythm = asObject(object.editingRhythm);

  return {
    storyboard,
    shootingSuggestions,
    shotPrompts,
    editingRhythm: {
      subtitleHighlights: stringArray(rawRhythm?.subtitleHighlights),
      soundEffects: stringArray(rawRhythm?.soundEffects),
      screenRecordingCuts: stringArray(rawRhythm?.screenRecordingCuts),
      caseInserts: stringArray(rawRhythm?.caseInserts),
      pauses: stringArray(rawRhythm?.pauses),
    },
  };
}
