"use client";

import { getAllIPs } from "./ip-store";

const KEY_TOPIC_CALIBRATION_SAMPLES = "ipwr:topicCalibrationSamples";
const SOURCE_FILE = "shikong_topic_calibration_v0.md";
const SOURCE_NAME = "石空账号选题校准样本";

export type TopicCalibrationPerformance = "high" | "medium" | "low";

export interface TopicCalibrationSample {
  id: string;
  title: string;
  content: string;
  performanceLevel: TopicCalibrationPerformance;
  originalCategory: "A类高表现" | "B类中等表现" | "C类低表现";
  likes: number;
  comments: number;
  collects: number;
  shares: number;
  interactionScore: number;
  videoUrl: string;
  publishedAt: string;
  tags: string[];
  ipName: string;
  ipId: string | null;
  source: string;
  sourceFile: string;
  createdAt: string;
  metadata: {
    sourceType: "topic_calibration_sample";
    ipName: "石空";
    samplePurpose: "topic_board_calibration";
    performanceLevel: TopicCalibrationPerformance;
    originalCategory: "A类高表现" | "B类中等表现" | "C类低表现";
    metrics: {
      likes: number;
      comments: number;
      collects: number;
      shares: number;
      interactionScore: number;
    };
    calibrationUsage: "用于校准选题董事会判断，不是普通方法论";
    originalBlock: string;
  };
}

interface RawSample {
  title: string;
  publishedAt: string;
  likes: number;
  comments: number;
  collects: number;
  shares: number;
  interactionScore: number;
  videoUrl: string;
  performanceLevel: TopicCalibrationPerformance;
  originalCategory: "A类高表现" | "B类中等表现" | "C类低表现";
  content: string;
}

export interface TopicCalibrationImportStatus {
  total: number;
  high: number;
  medium: number;
  low: number;
}

const COMMON_FEATURES: Record<TopicCalibrationPerformance, string> = {
  high: "具体问题强、实用价值强、收藏/分享动机强，多为指南、避坑、全流程、风格差异、设计细节类选题。",
  medium: "方向有价值，但通常需要更具体的人群、场景或利益点，适合作为建议优化后测试的校准样本。",
  low: "偏个人记录、旅行Vlog或与账号主定位弱相关，对用户装修决策帮助弱，适合做人设内容但不适合作为强转化/强收藏选题。",
};

const RAW_SAMPLES: RawSample[] = [
  {
    title: "厨卫灯光设计指南：告别阴影眩光，打造安全好用的光环境 #厨房设计 #卫生间设计 #灯…",
    publishedAt: "2025-12-20",
    likes: 41345,
    comments: 807,
    collects: 43618,
    shares: 17954,
    interactionScore: 205866,
    videoUrl: "https://www.douyin.com/video/7585443639141223722",
    performanceLevel: "high",
    originalCategory: "A类高表现",
    content: COMMON_FEATURES.high,
  },
  {
    title: "40种室内设计风格 ，一个视频带你看遍！ 风格大盘点来啦！#装修设计 #装修风格 #…",
    publishedAt: "2024-12-02",
    likes: 25066,
    comments: 1058,
    collects: 20307,
    shares: 19867,
    interactionScore: 137550,
    videoUrl: "https://www.douyin.com/video/7443751920411381028",
    performanceLevel: "high",
    originalCategory: "A类高表现",
    content: COMMON_FEATURES.high,
  },
  {
    title: "轻中古的精髓：不牺牲明亮舒适，照样有复古味 #中古风 #中古风装修 #全案设计 #成…",
    publishedAt: "2025-11-07",
    likes: 22212,
    comments: 1470,
    collects: 18618,
    shares: 10866,
    interactionScore: 104295,
    videoUrl: "https://www.douyin.com/video/7569810322706418994",
    performanceLevel: "high",
    originalCategory: "A类高表现",
    content: COMMON_FEATURES.high,
  },
  {
    title: "装修全流程干货：从预算规划到家电进场，一环扣一环少走弯路 #装修干货 #装修设计#施…",
    publishedAt: "2025-11-14",
    likes: 13546,
    comments: 276,
    collects: 16301,
    shares: 5558,
    interactionScore: 71524,
    videoUrl: "https://www.douyin.com/video/7572408421169761578",
    performanceLevel: "high",
    originalCategory: "A类高表现",
    content: COMMON_FEATURES.high,
  },
  {
    title: "成品家具好还是定制好？别纠结，看完你就懂了！ #装修设计 #全屋定制 #软装搭配 #…",
    publishedAt: "2025-06-13",
    likes: 8976,
    comments: 659,
    collects: 7942,
    shares: 7602,
    interactionScore: 52955,
    videoUrl: "https://www.douyin.com/video/7515326675727453450",
    performanceLevel: "high",
    originalCategory: "A类高表现",
    content: COMMON_FEATURES.high,
  },
  {
    title: "设计师私藏避坑清单：9 个网红装修设计，钱没少花还越住越糟 #装修设计 #装修干货 …",
    publishedAt: "2026-01-13",
    likes: 369,
    comments: 19,
    collects: 235,
    shares: 93,
    interactionScore: 1273,
    videoUrl: "https://www.douyin.com/video/7594739311510064424",
    performanceLevel: "medium",
    originalCategory: "B类中等表现",
    content: COMMON_FEATURES.medium,
  },
  {
    title: "花了几百万装的豪宅，为什么5年就住腻了？ 做了这么多年别墅设计，我发现一个扎心的规律…",
    publishedAt: "2026-04-26",
    likes: 491,
    comments: 45,
    collects: 205,
    shares: 62,
    interactionScore: 1279,
    videoUrl: "https://www.douyin.com/video/7631923306869919014",
    performanceLevel: "medium",
    originalCategory: "B类中等表现",
    content: COMMON_FEATURES.medium,
  },
  {
    title: "侘寂、原木风看腻了？这个风格让你家“静”下来！ 被侘寂、北欧风那种安静感吸引？那你一…",
    publishedAt: "2026-02-17",
    likes: 350,
    comments: 20,
    collects: 251,
    shares: 79,
    interactionScore: 1254,
    videoUrl: "https://www.douyin.com/video/7605108178874895616",
    performanceLevel: "medium",
    originalCategory: "B类中等表现",
    content: COMMON_FEATURES.medium,
  },
  {
    title: "【对话】如何避免装修增项？我们一次说清！ #装修设计 #装修避坑 #成都装修 #装修…",
    publishedAt: "2024-08-14",
    likes: 491,
    comments: 34,
    collects: 153,
    shares: 72,
    interactionScore: 1157,
    videoUrl: "https://www.douyin.com/video/7402930529894485299",
    performanceLevel: "medium",
    originalCategory: "B类中等表现",
    content: COMMON_FEATURES.medium,
  },
  {
    title: "西藏Vlog2  见过了高原深处的雪，出发前往冈仁波齐 #西藏旅游 #设计师日常 #…",
    publishedAt: "2025-05-14",
    likes: 14,
    comments: 3,
    collects: 0,
    shares: 1,
    interactionScore: 23,
    videoUrl: "https://www.douyin.com/video/7504189724572093706",
    performanceLevel: "low",
    originalCategory: "C类低表现",
    content: COMMON_FEATURES.low,
  },
  {
    title: "西藏Vlog4  穿越阿里无人区，被一所幼儿园治愈了 #西藏旅游  #设计师日常  …",
    publishedAt: "2025-05-19",
    likes: 14,
    comments: 2,
    collects: 2,
    shares: 1,
    interactionScore: 26,
    videoUrl: "https://www.douyin.com/video/7506032359557451019",
    performanceLevel: "low",
    originalCategory: "C类低表现",
    content: COMMON_FEATURES.low,
  },
  {
    title: "二刷阿里环线，这次的目标是：珠峰和冈仁波齐 #旅行vlog #阿里环线 #设计师日常…",
    publishedAt: "2025-05-10",
    likes: 16,
    comments: 5,
    collects: 3,
    shares: 2,
    interactionScore: 39,
    videoUrl: "https://www.douyin.com/video/7502386613381500186",
    performanceLevel: "low",
    originalCategory: "C类低表现",
    content: COMMON_FEATURES.low,
  },
  {
    title: "设计师放假5天，不去画图去干嘛？看完我悟了！✨ 做设计的人，平时总在替别人想生活。这…",
    publishedAt: "2026-05-07",
    likes: 27,
    comments: 0,
    collects: 2,
    shares: 4,
    interactionScore: 44,
    videoUrl: "https://www.douyin.com/video/7637086627726232841",
    performanceLevel: "low",
    originalCategory: "C类低表现",
    content: COMMON_FEATURES.low,
  },
  {
    title: "量房选材交底——3天跑3地，我们异地项目是怎么落地的？ #设计师日常 #装修设计 #…",
    publishedAt: "2025-06-02",
    likes: 16,
    comments: 4,
    collects: 5,
    shares: 3,
    interactionScore: 45,
    videoUrl: "https://www.douyin.com/video/7510174080289492224",
    performanceLevel: "low",
    originalCategory: "C类低表现",
    content: COMMON_FEATURES.low,
  },
];

function summarizeCalibrationSamples(
  samples: readonly { performanceLevel: TopicCalibrationPerformance }[],
): TopicCalibrationImportStatus {
  return {
    total: samples.length,
    high: samples.filter(sample => sample.performanceLevel === "high").length,
    medium: samples.filter(sample => sample.performanceLevel === "medium").length,
    low: samples.filter(sample => sample.performanceLevel === "low").length,
  };
}

export function getExpectedTopicCalibrationImportStatus(): TopicCalibrationImportStatus {
  return summarizeCalibrationSamples(RAW_SAMPLES);
}

function readSamples(): TopicCalibrationSample[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY_TOPIC_CALIBRATION_SAMPLES) || "[]");
  } catch {
    return [];
  }
}

function writeSamples(samples: TopicCalibrationSample[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_TOPIC_CALIBRATION_SAMPLES, JSON.stringify(samples));
}

function extractTags(title: string, level: TopicCalibrationPerformance) {
  const hashTags = Array.from(title.matchAll(/#([^#\s，。！!]+)/g)).map(m => m[1]).filter(Boolean);
  const levelTag = level === "high" ? "高表现" : level === "medium" ? "中等表现" : "低表现";
  return Array.from(new Set([...hashTags, "石空", "选题校准", levelTag]));
}

function buildOriginalBlock(sample: RawSample) {
  return `| ${sample.title} | ${sample.publishedAt} | ${sample.likes} | ${sample.comments} | ${sample.collects} | ${sample.shares} | ${sample.interactionScore} | ${sample.videoUrl} |`;
}

function toSample(raw: RawSample, ipId: string | null, index: number): TopicCalibrationSample {
  const id = `shikong-calibration-${String(index + 1).padStart(2, "0")}-${raw.performanceLevel}-${raw.videoUrl.split("/").pop()}`;
  const createdAt = new Date().toISOString();
  return {
    id,
    title: raw.title,
    content: raw.content,
    performanceLevel: raw.performanceLevel,
    originalCategory: raw.originalCategory,
    likes: raw.likes,
    comments: raw.comments,
    collects: raw.collects,
    shares: raw.shares,
    interactionScore: raw.interactionScore,
    videoUrl: raw.videoUrl,
    publishedAt: raw.publishedAt,
    tags: extractTags(raw.title, raw.performanceLevel),
    ipName: "石空",
    ipId,
    source: SOURCE_NAME,
    sourceFile: SOURCE_FILE,
    createdAt,
    metadata: {
      sourceType: "topic_calibration_sample",
      ipName: "石空",
      samplePurpose: "topic_board_calibration",
      performanceLevel: raw.performanceLevel,
      originalCategory: raw.originalCategory,
      metrics: {
        likes: raw.likes,
        comments: raw.comments,
        collects: raw.collects,
        shares: raw.shares,
        interactionScore: raw.interactionScore,
      },
      calibrationUsage: "用于校准选题董事会判断，不是普通方法论",
      originalBlock: buildOriginalBlock(raw),
    },
  };
}

function getUniqueShikongIP() {
  const matches = getAllIPs().filter(ip => ip.name.includes("石空"));
  return matches.length === 1 ? matches[0] : null;
}

export function upsertShikongTopicCalibrationSamples() {
  const shikong = getUniqueShikongIP();
  if (!shikong) {
    return {
      ...summarizeCalibrationSamples([]),
      ipMatched: false,
      ipId: null,
    };
  }
  const existing = readSamples();
  const keep = existing.filter(sample => sample.sourceFile !== SOURCE_FILE || sample.ipName !== "石空");
  const nextSamples = RAW_SAMPLES.map((sample, index) => toSample(sample, shikong.id, index));
  writeSamples([...keep, ...nextSamples]);

  return {
    ...summarizeCalibrationSamples(nextSamples),
    ipMatched: true,
    ipId: shikong.id,
  };
}

export function getTopicCalibrationSamples(ip?: { id?: string | null; name?: string | null } | null) {
  const samples = readSamples();
  if (!ip?.id?.trim()) return [];
  return samples.filter(sample => sample.ipId === ip.id);
}

export function getTopicCalibrationImportStatus() {
  const samples = readSamples().filter(sample => sample.sourceFile === SOURCE_FILE && sample.ipName === "石空");
  return summarizeCalibrationSamples(samples);
}

export function hasExpectedShikongTopicCalibrationSamples() {
  const shikong = getUniqueShikongIP();
  if (!shikong) return false;
  const actual = summarizeCalibrationSamples(readSamples().filter(sample => (
    sample.sourceFile === SOURCE_FILE
    && sample.ipName === "石空"
    && sample.ipId === shikong.id
  )));
  const expected = getExpectedTopicCalibrationImportStatus();
  return actual.total === expected.total
    && actual.high === expected.high
    && actual.medium === expected.medium
    && actual.low === expected.low;
}
