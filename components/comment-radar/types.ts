export interface CommentRadarInput {
  platform: string;
  comments: string;
}

export interface FreqQuestion {
  question: string;
  count: number;
  percent: number;
}

export interface RealNeed {
  surface: string;
  real: string[];
}

export interface EmotionItem {
  emotion: string;
  percent: number;
}

export interface BuyComment {
  text: string;
  intent: "high" | "mid";
}

export interface ProductOpportunity {
  name: string;
  grade: "S" | "A" | "B" | "C";
  reason: string;
}

export interface Objection {
  text: string;
  response: string;
}

export interface TopicIdea {
  title: string;
  source: string;
  viralScore: number;
  difficulty: "低" | "中" | "高";
  hook: string;
  body: string;
  cta: string;
}

export interface ReplySet {
  comment: string;
  pro: string;
  warm: string;
  sell: string;
}

export interface CommentRadarResult {
  overview: {
    total: number;
    valid: number;
    invalid: number;
    emotional: number;
    questions: number;
    buyInquiry: number;
    healthScore: number;
  };
  freqQuestions: FreqQuestion[];
  realNeeds: RealNeed[];
  emotions: EmotionItem[];
  userProfile: {
    stages: { label: string; percent: number }[];
    goals: { label: string; percent: number }[];
    summary: string;
  };
  buyIntent: {
    score: number;
    comments: BuyComment[];
  };
  opportunities: ProductOpportunity[];
  objections: Objection[];
  topics: TopicIdea[];
  replies: ReplySet[];
  radar: {
    name: string;
    value: number;
  }[];
  opportunities_summary: {
    bestVideos: string[];
    bestProduct: string;
    bestLive: string;
    bestMaterial: string;
  };
  commercialScore: number;
}
