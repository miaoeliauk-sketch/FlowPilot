export type Readiness = "done" | "partial" | "todo";

export interface VideoTask {
  id: string;
  name: string;
  category: string; // 干货/观点/故事/案例/直播切片/产品营销
  duration: string; // 30秒/60秒/90秒
  priority: "S" | "A" | "B";
  scriptStatus: Readiness;
  titleReady: boolean;
  coverCopyReady: boolean;
  caseReady: boolean;
  dataReady: boolean;
  screenshotReady: boolean;
  scenes: string[]; // 拍摄场景，支持多选
}

export interface ShootRoomInput {
  date: string;
  availableTime: "2h" | "4h" | "full";
  location: string;
  soloShoot: boolean;
  hasPhotographer: boolean;
  videos: VideoTask[];
  props: boolean;
  outfit: boolean;
  mic: boolean;
  lighting: boolean;
  teleprompter: boolean;
  reshootNeeds: string[]; // 屏幕录制/软件操作/案例展示/聊天记录/网页截图/素材镜头
}

export interface ShootRoomResult {
  completion: {
    total: number;
    dimensions: { label: string; score: number }[];
  };
  risks: { level: "高" | "中" | "低"; text: string }[];
  shootOrder: { step: number; title: string }[];
  shootOrderReason: string;
  timeEstimate: {
    script: number; // 分钟
    shooting: number;
    reshoot: number;
    total: number;
  };
  reminders: string[];
  schedule: { time: string; task: string }[];
  viralAssessment: {
    videoName: string;
    potential: number; // 1-5
    risk: string;
    suggestion: string;
  }[];
  checklist: string[];
}
