import type { PartialScriptFailedStage } from "./script-factory-contract";

export const SCRIPT_FACTORY_DRAFT_STORAGE_KEY =
  "flowpilot_script_factory_partial_drafts_v1";

export interface ScriptGenerationSettings {
  generationMode?: "standard" | "ip";
  platform: string;
  formatCategory: string;
  durationSeconds: number;
  goal: string;
  videoType: string;
  needsStoryboard: boolean;
  needsShootingTips: boolean;
}

export interface PartialScriptDraft<T = unknown> {
  version: 1;
  ipId: string;
  topicId?: string;
  topic: string;
  savedAt: string;
  failedStage: PartialScriptFailedStage;
  warning: string;
  generationSettings: ScriptGenerationSettings;
  result: T;
}

export interface ScriptDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredDrafts {
  version: 1;
  draftsByIP: Record<string, PartialScriptDraft>;
}

function getBrowserStorage(): ScriptDraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredDrafts(storage: ScriptDraftStorage): StoredDrafts {
  const raw = storage.getItem(SCRIPT_FACTORY_DRAFT_STORAGE_KEY);
  if (!raw) return { version: 1, draftsByIP: {} };

  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    !(parsed as { draftsByIP?: unknown }).draftsByIP ||
    typeof (parsed as { draftsByIP?: unknown }).draftsByIP !== "object"
  ) {
    return { version: 1, draftsByIP: {} };
  }
  return parsed as StoredDrafts;
}

function isGenerationSettings(value: unknown): value is ScriptGenerationSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<ScriptGenerationSettings>;
  return (
    (settings.generationMode === undefined || settings.generationMode === "standard" || settings.generationMode === "ip") &&
    typeof settings.platform === "string" &&
    typeof settings.formatCategory === "string" &&
    typeof settings.durationSeconds === "number" &&
    typeof settings.goal === "string" &&
    typeof settings.videoType === "string" &&
    typeof settings.needsStoryboard === "boolean" &&
    typeof settings.needsShootingTips === "boolean"
  );
}

export function savePartialScriptDraft<T>(
  draft: PartialScriptDraft<T>,
  storage: ScriptDraftStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const stored = readStoredDrafts(storage);
    storage.setItem(
      SCRIPT_FACTORY_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        draftsByIP: { ...stored.draftsByIP, [draft.ipId]: draft },
      } satisfies StoredDrafts),
    );
    return true;
  } catch {
    return false;
  }
}

export function getPartialScriptDraft<T = unknown>(
  ipId: string,
  storage: ScriptDraftStorage | null = getBrowserStorage(),
): PartialScriptDraft<T> | null {
  if (!storage) return null;
  try {
    const draft = readStoredDrafts(storage).draftsByIP[ipId];
    if (
      !draft ||
      draft.version !== 1 ||
      draft.ipId !== ipId ||
      (draft.topicId !== undefined &&
        (typeof draft.topicId !== "string" || !draft.topicId.trim())) ||
      typeof draft.topic !== "string" ||
      typeof draft.savedAt !== "string" ||
      (draft.failedStage !== "storyboard" && draft.failedStage !== "execution") ||
      typeof draft.warning !== "string" ||
      !isGenerationSettings(draft.generationSettings) ||
      !draft.result ||
      typeof draft.result !== "object"
    ) {
      return null;
    }
    return draft as PartialScriptDraft<T>;
  } catch {
    return null;
  }
}

export function clearPartialScriptDraft(
  ipId: string,
  storage: ScriptDraftStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const stored = readStoredDrafts(storage);
    const draftsByIP = { ...stored.draftsByIP };
    delete draftsByIP[ipId];
    storage.setItem(
      SCRIPT_FACTORY_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1, draftsByIP } satisfies StoredDrafts),
    );
    return true;
  } catch {
    return false;
  }
}
