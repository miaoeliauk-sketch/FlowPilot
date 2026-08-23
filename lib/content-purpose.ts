export const CONTENT_PURPOSES = [
  "流量增长",
  "互动讨论",
  "知识教育",
  "直播导流",
  "线索获客",
  "信任建立",
  "成交转化",
  "人设强化",
  "老客维护",
  "其他",
] as const;

export type ContentPurpose = typeof CONTENT_PURPOSES[number];
