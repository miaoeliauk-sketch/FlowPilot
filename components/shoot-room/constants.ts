export const TIME_OPTIONS: { value: "2h" | "4h" | "full"; label: string }[] = [
  { value: "2h", label: "2 小时" },
  { value: "4h", label: "4 小时" },
  { value: "full", label: "全天" },
];

export const CATEGORY_OPTIONS = [
  "干货",
  "观点",
  "故事",
  "案例",
  "直播切片",
  "产品营销",
];

export const DURATION_OPTIONS = ["30秒", "60秒", "90秒"];

export const PRIORITY_OPTIONS: { value: "S" | "A" | "B"; label: string }[] = [
  { value: "S", label: "S级" },
  { value: "A", label: "A级" },
  { value: "B", label: "B级" },
];

export const READINESS_OPTIONS: { value: "done" | "partial" | "todo"; label: string }[] = [
  { value: "done", label: "已完成" },
  { value: "partial", label: "部分完成" },
  { value: "todo", label: "未完成" },
];

export const SCENE_OPTIONS = ["办公室", "书房", "咖啡馆", "户外", "绿幕", "直播间"];

export const RESHOOT_OPTIONS = [
  "屏幕录制",
  "软件操作",
  "案例展示",
  "聊天记录",
  "网页截图",
  "素材镜头",
];

export const EQUIPMENT_ITEMS: { key: "props" | "outfit" | "mic" | "lighting" | "teleprompter"; label: string }[] = [
  { key: "props", label: "道具" },
  { key: "outfit", label: "服装" },
  { key: "mic", label: "麦克风" },
  { key: "lighting", label: "灯光" },
  { key: "teleprompter", label: "提词器" },
];
