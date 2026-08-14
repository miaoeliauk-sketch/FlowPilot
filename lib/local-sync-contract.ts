/**
 * 本地同步默认关闭，仅供开发环境按需使用。
 * 当前没有身份验证，也没有多端写入冲突检测；正式启用前必须先补充访问身份验证，
 * 否则开启后可能导致本地数据被未授权读取或覆盖。
 */
export const LOCAL_SYNC_KEYS = [
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
  "ipwr:userProfile",
  "ipwr:videoReviews",
  "ipwr:userPersonas",
  "ipwr:topicCalibrationSamples",
  "ipwr:coverRefs",
  "flowpilot:materials",
  "ipwr:liveClipWorkspaces:v1",
] as const;

export const LOCAL_SYNC_MAX_BODY_BYTES = 10 * 1024 * 1024;

export type LocalSyncPayload = {
  updatedAt: string;
  data: Record<string, string>;
};

const localSyncKeySet = new Set<string>(LOCAL_SYNC_KEYS);

export function isLocalSyncKey(key: string) {
  return localSyncKeySet.has(key);
}

type LocalSyncEnvironment = {
  NODE_ENV?: string;
  ENABLE_LOCAL_SYNC?: string;
};

export function isLocalSyncEnabled(environment: LocalSyncEnvironment = process.env) {
  return environment.NODE_ENV === "development"
    && environment.ENABLE_LOCAL_SYNC === "true";
}
