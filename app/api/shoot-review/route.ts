import { NextRequest, NextResponse } from "next/server";
import { ShootRoomInput, ShootRoomResult, VideoTask, Readiness } from "@/components/shoot-room/types";

function readinessScore(status: Readiness) {
  if (status === "done") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

function durationToMinutes(duration: string) {
  const n = parseInt(duration, 10) || 30;
  return n; // 这里duration是秒数，时间预估时再换算
}

const TOTAL_TIME_BUDGET: Record<ShootRoomInput["availableTime"], number> = {
  "2h": 120,
  "4h": 240,
  full: 480,
};

export async function POST(req: NextRequest) {
  let body: ShootRoomInput;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法的 JSON" }, { status: 400 });
  }

  if (!body.videos || body.videos.length === 0) {
    return NextResponse.json({ error: "请至少添加一个视频任务" }, { status: 400 });
  }

  const invalidVideo = body.videos.find((v) => !v.name.trim());
  if (invalidVideo) {
    return NextResponse.json({ error: "每个视频任务都需要填写名称" }, { status: 400 });
  }

  const result = buildResult(body);
  return NextResponse.json(result);
}

function buildResult(input: ShootRoomInput): ShootRoomResult {
  const { videos } = input;

  // 1. 完成度评分
  const contentScores = videos.map((v) => {
    const items = [
      readinessScore(v.scriptStatus),
      v.titleReady ? 1 : 0,
      v.coverCopyReady ? 1 : 0,
      v.caseReady ? 1 : 0,
      v.dataReady ? 1 : 0,
      v.screenshotReady ? 1 : 0,
    ];
    return items.reduce((a, b) => a + b, 0) / items.length;
  });
  const contentAvg = contentScores.reduce((a, b) => a + b, 0) / contentScores.length;

  const sceneCount = new Set(videos.flatMap((v) => v.scenes)).size;
  const sceneScore = videos.every((v) => v.scenes.length > 0)
    ? Math.max(0.5, 1 - (sceneCount - 1) * 0.1)
    : 0.4;

  const equipmentItems = [input.props, input.outfit, input.mic, input.lighting, input.teleprompter];
  const equipmentScore = equipmentItems.filter(Boolean).length / equipmentItems.length;

  const materialScore =
    input.reshootNeeds.length === 0
      ? 0.6
      : Math.max(0.4, 1 - input.reshootNeeds.length * 0.08);

  const dimensions = [
    { label: "内容准备", score: Math.round(contentAvg * 100) },
    { label: "场景准备", score: Math.round(sceneScore * 100) },
    { label: "设备准备", score: Math.round(equipmentScore * 100) },
    { label: "素材准备", score: Math.round(materialScore * 100) },
  ];

  const total = Math.round(
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
  );

  // 2. 风险扫描
  const risks: ShootRoomResult["risks"] = [];

  videos.forEach((v) => {
    if (v.scriptStatus === "todo") {
      risks.push({ level: "高", text: `「${v.name || "未命名视频"}」脚本尚未完成` });
    } else if (v.scriptStatus === "partial") {
      risks.push({ level: "中", text: `「${v.name || "未命名视频"}」脚本仅部分完成` });
    }
    if (!v.caseReady) {
      risks.push({ level: "中", text: `「${v.name || "未命名视频"}」缺少真实案例` });
    }
    if (!v.screenshotReady && v.caseReady) {
      risks.push({ level: "中", text: `「${v.name || "未命名视频"}」缺少配套截图素材` });
    }
    if (v.scenes.length === 0) {
      risks.push({ level: "高", text: `「${v.name || "未命名视频"}」尚未选择拍摄场景` });
    }
  });

  if (!input.teleprompter) {
    risks.push({ level: "中", text: "未准备提词器，可能影响口播流畅度" });
  }
  if (!input.lighting) {
    risks.push({ level: "中", text: "未准备灯光，画面质感可能受影响" });
  }
  if (!input.mic) {
    risks.push({ level: "高", text: "未准备麦克风，收音质量风险较高" });
  }
  if (input.reshootNeeds.length > 0 && !input.hasPhotographer && input.soloShoot) {
    risks.push({ level: "低", text: "单人拍摄 + 多项补拍素材，建议预留更多缓冲时间" });
  }

  if (risks.length === 0) {
    risks.push({ level: "低", text: "目前没有发现明显风险，准备情况良好" });
  }

  // 3. 拍摄顺序优化：按场景分组，减少换场，优先级高的视频在场景内靠前
  const sceneGroups = new Map<string, VideoTask[]>();
  videos.forEach((v) => {
    const key = v.scenes[0] || "未指定场景";
    if (!sceneGroups.has(key)) sceneGroups.set(key, []);
    sceneGroups.get(key)!.push(v);
  });

  const priorityRank: Record<string, number> = { S: 0, A: 1, B: 2 };
  const shootOrder: ShootRoomResult["shootOrder"] = [];
  let step = 1;
  sceneGroups.forEach((group, scene) => {
    group
      .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
      .forEach((v) => {
        shootOrder.push({
          step: step++,
          title: `${scene}场景 · ${v.name || "未命名视频"}`,
        });
      });
  });

  if (input.reshootNeeds.length > 0) {
    shootOrder.push({ step: step++, title: `补拍镜头（${input.reshootNeeds.join("、")}）` });
  }

  // 4. 时间预估
  const scriptTime = videos.reduce((sum, v) => {
    if (v.scriptStatus === "done") return sum;
    if (v.scriptStatus === "partial") return sum + 10;
    return sum + 20;
  }, 0);

  const shootingTime = videos.reduce((sum, v) => {
    const base = durationToMinutes(v.duration);
    // 每个视频实际拍摄时间约为成片时长的 15-25 倍（含NG重拍）
    const multiplier = input.soloShoot ? 25 : 15;
    return sum + Math.ceil((base * multiplier) / 60) * 5;
  }, 0);

  const reshootTime = input.reshootNeeds.length * 10 + (input.reshootNeeds.length > 0 ? 10 : 0);

  const totalTime = scriptTime + shootingTime + reshootTime;
  const budget = TOTAL_TIME_BUDGET[input.availableTime];

  // 5. AI 遗漏提醒
  const reminders: string[] = [];
  videos.forEach((v) => {
    if (v.scriptStatus !== "todo" && !v.coverCopyReady) {
      reminders.push(`「${v.name || "未命名视频"}」已准备口播稿，但没有准备封面文案，建议提前补充`);
    }
    if (v.caseReady && !v.screenshotReady) {
      reminders.push(`「${v.name || "未命名视频"}」已准备案例，但没有准备截图素材，建议提前补充`);
    }
    if (v.titleReady && v.scriptStatus === "todo") {
      reminders.push(`「${v.name || "未命名视频"}」已确定标题，但脚本尚未开始，建议优先推进`);
    }
  });
  if (totalTime > budget) {
    reminders.push(
      `预估总耗时 ${Math.floor(totalTime / 60)}小时${totalTime % 60}分钟，超出今日可用时间，建议精简任务或调整优先级`
    );
  }
  if (reminders.length === 0) {
    reminders.push("目前各项准备较为齐全，按计划推进即可");
  }

  // 6. 今日执行计划
  const schedule: ShootRoomResult["schedule"] = [];
  let cursor = 9 * 60; // 09:00 起，单位：分钟
  function fmt(min: number) {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  schedule.push({ time: `${fmt(cursor)}-${fmt(cursor + 20)}`, task: "检查设备与场景" });
  cursor += 20;

  if (scriptTime > 0) {
    schedule.push({ time: `${fmt(cursor)}-${fmt(cursor + scriptTime)}`, task: "确认未完成脚本" });
    cursor += scriptTime;
  }

  videos.forEach((v) => {
    const base = durationToMinutes(v.duration);
    const multiplier = input.soloShoot ? 25 : 15;
    const minutes = Math.ceil((base * multiplier) / 60) * 5;
    schedule.push({ time: `${fmt(cursor)}-${fmt(cursor + minutes)}`, task: `拍摄「${v.name || "未命名视频"}」` });
    cursor += minutes;
  });

  if (input.reshootNeeds.length > 0) {
    schedule.push({ time: `${fmt(cursor)}-${fmt(cursor + reshootTime)}`, task: `补拍素材（${input.reshootNeeds.join("、")}）` });
    cursor += reshootTime;
  }

  schedule.push({ time: `${fmt(cursor)}-${fmt(cursor + 20)}`, task: "素材整理与备份" });
  cursor += 20;

  // 7. 爆款风险评估
  const viralAssessment: ShootRoomResult["viralAssessment"] = videos.map((v) => {
    let potential = 3;
    let risk = "选题较为常见，需要差异化角度";
    let suggestion = "增加真实案例或数据支撑";

    if (v.priority === "S") potential += 1;
    if (v.caseReady && v.dataReady) potential += 1;
    if (!v.caseReady && !v.dataReady) potential -= 1;

    potential = Math.max(1, Math.min(5, potential));

    if (v.category === "故事" || v.category === "案例") {
      risk = "情绪共鸣型内容，注意避免过度煽情";
      suggestion = "用真实细节增强可信度";
    } else if (v.category === "直播切片") {
      risk = "内容可能缺乏完整上下文";
      suggestion = "开头补充背景说明，降低理解门槛";
    } else if (v.category === "产品营销") {
      risk = "广告感过重，容易被划走";
      suggestion = "前3秒先抛出痛点，再引出产品";
    } else if (v.category === "干货") {
      risk = "同质化内容较多，竞争激烈";
      suggestion = "增加独家案例或数据，强化差异化";
    }

    return {
      videoName: v.name || "未命名视频",
      potential,
      risk,
      suggestion,
    };
  });

  // 8. 一键生成拍摄清单
  const checklist: string[] = ["手机充电", "备用电池"];
  if (input.mic) checklist.push("麦克风");
  if (input.lighting) checklist.push("灯光");
  if (input.teleprompter) checklist.push("提词器");
  if (input.props) checklist.push("道具");
  if (input.outfit) checklist.push("服装");
  checklist.push("水杯");

  videos.forEach((v) => {
    if (v.scriptStatus !== "todo") checklist.push(`「${v.name || "未命名视频"}」脚本`);
    if (v.caseReady) checklist.push(`「${v.name || "未命名视频"}」数据案例`);
    if (v.screenshotReady) checklist.push(`「${v.name || "未命名视频"}」截图素材`);
    if (v.coverCopyReady) checklist.push(`「${v.name || "未命名视频"}」封面标题`);
  });

  return {
    completion: { total, dimensions },
    risks,
    shootOrder,
    shootOrderReason: "按场景分组排列，减少来回换场",
    timeEstimate: {
      script: scriptTime,
      shooting: shootingTime,
      reshoot: reshootTime,
      total: totalTime,
    },
    reminders,
    schedule,
    viralAssessment,
    checklist,
  };
}
