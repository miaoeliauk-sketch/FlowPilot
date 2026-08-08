import {
  CONTENT_MASTER_STORAGE_KEY,
  assertValidContentMasterBackupData,
  runWithContentMasterWriteLock,
  type ContentMasterWriteLock,
} from "./content-master-store";
import { DECISION_MEMORY_STORAGE_KEY } from "./decision-memory-store";

export interface FlowPilotBackupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const FLOWPILOT_BACKUP_STORAGE_KEYS = [
  "ipwr:ips_v2",
  "ipwr:activeIpId",
  "ipwr:voiceSamples",
  "ipwr:voiceSamplesMigrated",
  "ipwr:ipStyleProfiles",
  "ipwr:topicAssets",
  "ipwr:commentAssets",
  "ipwr:scriptAssets",
  "ipwr:knowledgeEntries",
  "ipwr:hookEntries",
  "ipwr:hotAnalyses",
  "ipwr:videoReviews",
  "ipwr:userProfile",
  "ipwr:weeklyReports",
  DECISION_MEMORY_STORAGE_KEY,
  CONTENT_MASTER_STORAGE_KEY,
] as const;

export function createFlowPilotBackup(
  storage: FlowPilotBackupStorage,
  now = new Date(),
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    _meta: {
      version: "1.0",
      exportedAt: now.toISOString(),
      app: "FlowPilot Desktop Preview 0.1",
      note: "API Key 不在导出内容中",
    },
  };
  for (const key of FLOWPILOT_BACKUP_STORAGE_KEYS) {
    const value = storage.getItem(key);
    if (value === null) continue;
    try {
      data[key] = JSON.parse(value);
    } catch {
      data[key] = value;
    }
  }
  return data;
}

export async function restoreFlowPilotBackup(
  data: Record<string, unknown>,
  storage: FlowPilotBackupStorage,
  lock?: ContentMasterWriteLock | null,
): Promise<number> {
  if (!data._meta) throw new Error("文件格式不正确，请选择FlowPilot导出的备份文件");
  const includesContentMasters = CONTENT_MASTER_STORAGE_KEY in data;
  if (includesContentMasters) {
    assertValidContentMasterBackupData(data[CONTENT_MASTER_STORAGE_KEY]);
  }
  const restore = () => {
    let count = 0;
    for (const key of FLOWPILOT_BACKUP_STORAGE_KEYS) {
      if (!(key in data)) continue;
      storage.setItem(key, JSON.stringify(data[key]));
      count += 1;
    }
    return count;
  };
  if (!includesContentMasters) return restore();
  return runWithContentMasterWriteLock(lock, restore);
}
