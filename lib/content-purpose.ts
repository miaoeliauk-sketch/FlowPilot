export const CONTENT_PURPOSES = [
  "流量增长",
  "直播导流",
  "线索获客",
  "信任建立",
  "成交转化",
  "人设强化",
] as const;

export type ContentPurpose = typeof CONTENT_PURPOSES[number];
