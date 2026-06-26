"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ── 状态机定义 ──
const TASK_STATES = ["未开始", "准备中", "拍摄中", "待补拍", "待剪辑", "待发布", "已完成", "已超时"] as const;
type TaskState = typeof TASK_STATES[number];

// 推荐的"下一步"状态（用于高亮显示，仅作为引导，不限制实际可选范围）
const RECOMMENDED_NEXT: Record<TaskState, TaskState[]> = {
  "未开始":  ["准备中"],
  "准备中":  ["拍摄中", "未开始"],
  "拍摄中":  ["待补拍", "待剪辑", "已完成"],
  "待补拍":  ["拍摄中", "待剪辑"],
  "待剪辑":  ["待发布", "已完成"],
  "待发布":  ["已完成"],
  "已完成":  ["待发布", "待剪辑"],
  "已超时":  ["待发布", "待剪辑", "已完成"],
};

const STATE_STYLE: Record<TaskState, { bg: string; text: string; border: string }> = {
  "未开始":  { bg: "#F0EFE9", text: "#888",    border: "#EAEAE6" },
  "准备中":  { bg: "#FBF3D6", text: "#7A5C00", border: "#C99A1E" },
  "拍摄中":  { bg: "#E4F9C0", text: "#2A5A0A", border: "#C8F04A" },
  "待补拍":  { bg: "#FBE5D6", text: "#7A3A00", border: "#E07A3A" },
  "待剪辑":  { bg: "#DCEBFB", text: "#0A3A6A", border: "#4A8FD6" },
  "待发布":  { bg: "#E8D8FB", text: "#4A0A7A", border: "#9B7ED9" },
  "已完成":  { bg: "#E4F9C0", text: "#2A5A0A", border: "#3DA876" },
  "已超时":  { bg: "#FCEBEB", text: "#7A0A0A", border: "#A32D2D" },
};

type Priority = "S" | "A" | "B" | "C";
type RiskLevel = "高" | "中" | "低" | "无";

interface VideoTask {
  id: string;
  title: string;
  priority: Priority;
  publishTime: string;
  duration: number;
  shootAt?: number; // 精确拍摄时间戳（毫秒），用于测试任务等需要秒级精度的场景
  state: TaskState;
  previousState: TaskState | null; // 用于撤销上一步
  stateHistory: { state: TaskState; time: string; note?: string }[];
  content: Record<string, boolean>;
  equipment: Record<string, boolean>;
  notes: string;
}

interface Reminder {
  id: string;
  title: string;
  message: string;
  type: "warning" | "info" | "danger" | "success";
  time: string;
  read: boolean;
  handled: boolean; // 是否已处理（用户点击了弹窗按钮）
  taskId?: string;
  riskLevel?: RiskLevel;
}

// 一次性弹窗提醒（需要用户交互的，比如"拍摄时间已到"）
interface PopupReminder {
  id: string;
  title: string;
  message: string;
  taskId: string;
  taskTitle: string;
}

interface TimelineNode {
  time: string;
  label: string;
  type: string;
  taskId?: string;
  reminder?: string;
  fired: boolean;
}

const CONTENT_ITEMS = ["选题", "脚本", "标题", "封面文案", "案例素材", "数据截图", "补拍素材"];
const EQUIPMENT_ITEMS = ["麦克风", "灯光", "提词器", "手机", "支架", "充电器", "备用电池"];

const PRIORITY_STYLE: Record<Priority, { bg: string; text: string }> = {
  S: { bg: "#1A2A0A", text: "#C8F04A" },
  A: { bg: "#0A1A2E", text: "#6FA8E0" },
  B: { bg: "#2E2410", text: "#C99A1E" },
  C: { bg: "#2A1A1A", text: "#E0608E" },
};

// ── 时间工具 ──
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function addMins(t: string, m: number) {
  const [h, min] = t.split(":").map(Number);
  const total = h * 60 + min + m;
  return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
function diffMins(t1: string, t2: string) {
  const [h1,m1]=t1.split(":").map(Number), [h2,m2]=t2.split(":").map(Number);
  return (h2*60+m2)-(h1*60+m1);
}
function toMins(t: string) { const [h,m]=t.split(":").map(Number); return h*60+m; }

// 把 HH:MM 转成今天对应的时间戳（毫秒）；若已过今天该时刻很久（>12小时），则视为明天
function hhmmToTimestamp(hhmm: string, baseTime = new Date()): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(baseTime);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

// ── 声音提醒：持久化 AudioContext + 解锁机制 ──
let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!sharedAudioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      sharedAudioCtx = new Ctor();
    }
    return sharedAudioCtx;
  } catch { return null; }
}

// 用户点击时调用：解锁音频上下文 + 播放一次测试音，返回是否成功
async function unlockAndTestAudio(): Promise<boolean> {
  const ctx = getAudioCtx();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    playTone(ctx, 659, 0.18, 0.25);
    return ctx.state === "running";
  } catch { return false; }
}

function playTone(ctx: AudioContext, freq: number, duration: number, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(); osc.stop(ctx.currentTime + duration);
}

function playBeep(type: "warning"|"danger"|"success") {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running") return; // 未解锁时静默失败，不抛错
  if (type === "danger") {
    playTone(ctx, 440, 0.5, 0.3);
    setTimeout(() => { if (ctx.state === "running") playTone(ctx, 330, 0.5, 0.3); }, 280);
    setTimeout(() => { if (ctx.state === "running") playTone(ctx, 440, 0.5, 0.3); }, 560);
  } else if (type === "warning") {
    playTone(ctx, 523, 0.35, 0.28);
  } else {
    playTone(ctx, 659, 0.3, 0.25);
  }
}

// ── 浏览器通知 ──
async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function sendBrowserNotification(title: string, body: string) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

// ── 风险计算 ──
function calcRisk(task: VideoTask, nowMins: number): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  const publishMins = toMins(task.publishTime);
  const remaining = publishMins - nowMins;

  if (task.state === "已超时") return { level: "高", reasons: ["任务已超时"] };
  if (remaining < 0 && task.state !== "已完成") return { level: "高", reasons: ["已过发布时间"] };
  if (remaining < 60 && task.state !== "已完成" && task.state !== "待发布") reasons.push(`距发布仅剩 ${remaining} 分钟`);
  if (remaining < 120 && task.state === "未开始") reasons.push("距发布不足2小时但未开始");
  if (!task.content["脚本"] && task.state !== "已完成") reasons.push("脚本未完成");
  if (!task.content["案例素材"] && task.state !== "已完成") reasons.push("缺少案例素材");
  if (!task.content["封面文案"] && task.state !== "已完成") reasons.push("封面文案未准备");
  if (!task.equipment["麦克风"]) reasons.push("麦克风未确认");

  if (reasons.length >= 3 || (remaining < 60 && reasons.length > 0)) return { level: "高", reasons };
  if (reasons.length >= 1) return { level: "中", reasons };
  if (remaining < 180 && task.state !== "已完成") return { level: "低", reasons: ["请注意时间安排"] };
  return { level: "无", reasons: [] };
}

// ── Toast组件 ──
function Toast({ reminders, onClose }: { reminders: Reminder[]; onClose: (id: string) => void }) {
  const unread = reminders.filter(r => !r.read).slice(-3);
  if (unread.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {unread.map(r => (
        <div key={r.id} className={`rounded-[14px] p-4 shadow-lg flex items-start gap-3 ${
          r.type==="danger"?"bg-[#A32D2D] text-white":
          r.type==="warning"?"bg-[#1A1A1A] text-white":
          r.type==="success"?"bg-[#2A5A0A] text-white":
          "bg-white border border-[#EAEAE6] text-[#1A1A1A]"
        }`}>
          <span className="text-[18px] flex-shrink-0">
            {r.type==="danger"?"🚨":r.type==="warning"?"⚠️":r.type==="success"?"✅":"💡"}
          </span>
          <div className="flex-1">
            <div className="text-[13px] font-black">{r.title}</div>
            <div className="text-[11px] mt-0.5 opacity-80">{r.message}</div>
          </div>
          <button onClick={() => onClose(r.id)} className="opacity-60 hover:opacity-100 text-[16px]">×</button>
        </div>
      ))}
    </div>
  );
}

// ── 真正的弹窗提醒（需要用户交互） ──
function ReminderPopup({ popup, onAction }: { popup: PopupReminder; onAction: (action: "shoot"|"snooze"|"done") => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-[400px] rounded-[18px] bg-white p-6 shadow-2xl animate-[popIn_0.2s_ease-out]">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[24px]">⏰</span>
          <h3 className="text-[17px] font-black text-[#1A1A1A]">{popup.title}</h3>
        </div>
        <p className="mb-5 text-[13.5px] leading-6 text-[#555]">{popup.message}</p>
        <div className="flex flex-col gap-2">
          <button onClick={() => onAction("shoot")}
            className="w-full rounded-[12px] bg-[#1A1A1A] py-2.5 text-[13.5px] font-bold text-white">
            开始拍摄
          </button>
          <div className="flex gap-2">
            <button onClick={() => onAction("snooze")}
              className="flex-1 rounded-[12px] border border-[#EAEAE6] py-2.5 text-[13px] font-semibold text-[#555]">
              稍后提醒5分钟
            </button>
            <button onClick={() => onAction("done")}
              className="flex-1 rounded-[12px] border border-[#EAEAE6] py-2.5 text-[13px] font-semibold text-[#555]">
              标记已完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function Countdown({ target, color }: { target: string; color: string }) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(p => p+1), 1000); return () => clearInterval(t); }, []);
  const targetTs = hhmmToTimestamp(target);
  const nowTs = Date.now();
  const diffMs = targetTs - nowTs;
  const over = diffMs < 0;

  if (over) {
    return (
      <div className="flex flex-col items-center">
        <span className="font-black tabular-nums text-[20px]" style={{ color: "#A32D2D" }}>
          已超时 {formatDuration(diffMs)}
        </span>
      </div>
    );
  }
  return (
    <span className="font-black tabular-nums text-[22px]" style={{ color }}>
      {formatDuration(diffMs)}
    </span>
  );
}

// ── Main ──
export default function ShootRoomPage() {
  const [startTime, setStartTime] = useState("09:00");
  const [soundEnabled, setSoundEnabled] = useState(false); // 默认关闭，需用户主动点击解锁
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [notifGranted, setNotifGranted] = useState(false);
  const [activeTab, setActiveTab] = useState<"setup"|"command">("setup");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showReminderCenter, setShowReminderCenter] = useState(false);
  const [firedReminders, setFiredReminders] = useState<Set<string>>(new Set());
  const [confirmingTask, setConfirmingTask] = useState<string | null>(null);
  const [pendingState, setPendingState] = useState<TaskState | null>(null);
  const [historyTask, setHistoryTask] = useState<string | null>(null);
  const [popupQueue, setPopupQueue] = useState<PopupReminder[]>([]);
  const [snoozedUntil, setSnoozedUntil] = useState<Record<string, number>>({}); // taskId -> timestamp
  const [testTaskAdded, setTestTaskAdded] = useState(false);
  const [tasks, setTasks] = useState<VideoTask[]>([
    {
      id: "1", title: "AI选题董事会功能演示", priority: "S",
      publishTime: "20:00", duration: 60,
      state: "未开始",
      previousState: null,
      stateHistory: [{ state: "未开始", time: nowHHMM() }],
      content: Object.fromEntries(CONTENT_ITEMS.map(k=>[k,false])),
      equipment: Object.fromEntries(EQUIPMENT_ITEMS.map(k=>[k,false])),
      notes: "",
    }
  ]);

  // 请求通知权限
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifGranted(Notification.permission === "granted");
    }
  }, []);

  // ── 提醒触发器：写入提醒中心记录 + 播放声音 + 浏览器通知 ──
  const addReminder = useCallback((r: Omit<Reminder,"id"|"time"|"read"|"handled">) => {
    const id = `${Date.now()}-${Math.random()}`;
    const reminder: Reminder = { ...r, id, time: new Date().toLocaleTimeString("zh-CN",{hour12:false}), read: false, handled: false };
    setReminders(prev => [...prev, reminder]);
    if (soundEnabled) playBeep(r.type === "danger" ? "danger" : r.type === "warning" ? "warning" : "success");
    sendBrowserNotification(r.title, r.message);
    return id;
  }, [soundEnabled]);

  // 弹出真正的Modal弹窗（拍摄时间到、超时等关键节点）
  const showPopup = useCallback((title: string, message: string, taskId: string, taskTitle: string) => {
    setPopupQueue(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, title, message, taskId, taskTitle }]);
  }, []);

  // ── 核心触发引擎：每1秒检查一次，基于精确时间戳，每个提醒只触发一次 ──
  useEffect(() => {
    const interval = setInterval(() => {
      const nowTs = Date.now();
      const nowM = toMins(nowHHMM());

      tasks.forEach(task => {
        const publishTs = hhmmToTimestamp(task.publishTime);
        const snoozeUntil = snoozedUntil[task.id];
        const isSnoozed = !!(snoozeUntil && snoozeUntil > nowTs);

        // 稍后提醒到期：清除已触发标记，允许重新弹出
        if (snoozeUntil && snoozeUntil <= nowTs) {
          const keysToReset = [`shoot-due-${task.id}`, `timeout-${task.id}`];
          setFiredReminders(prev => { const next = new Set(prev); keysToReset.forEach(k => next.delete(k)); return next; });
          setSnoozedUntil(prev => { const next = { ...prev }; delete next[task.id]; return next; });
          return; // 本轮跳过，下一轮tick会重新检测并触发
        }

        // ① 超时检测：到达发布时间且未完成 → 状态切到"已超时" + 弹窗 + Toast + 声音 + 通知
        if (nowTs >= publishTs && task.state !== "已完成" && task.state !== "已超时") {
          const key = `timeout-${task.id}`;
          if (!firedReminders.has(key)) {
            setFiredReminders(prev => new Set([...prev, key]));
            setTasks(prev => prev.map(t => t.id === task.id ? {
              ...t, state: "已超时", previousState: t.state,
              stateHistory: [...t.stateHistory, { state: "已超时", time: nowHHMM() }]
            } : t));
            const overMin = Math.floor((nowTs - publishTs) / 60000);
            addReminder({ title: "任务已超时", message: `「${task.title}」距离发布时间已经超时 ${overMin} 分钟，请立即处理。`, type: "danger", taskId: task.id, riskLevel: "高" });
            if (!isSnoozed) showPopup("任务已超时", `距离发布时间已经超时，请立即处理「${task.title}」。`, task.id, task.title);
          }
          return;
        }

        // ② 拍摄时间到（按 shootAt 触发）：弹出真正的Modal
        if (task.shootAt && nowTs >= task.shootAt && task.state === "未开始") {
          const key = `shoot-due-${task.id}`;
          if (!firedReminders.has(key) && !isSnoozed) {
            setFiredReminders(prev => new Set([...prev, key]));
            addReminder({ title: "拍摄时间已到", message: `现在应该开始拍摄「${task.title}」`, type: "warning", taskId: task.id });
            showPopup("拍摄时间已到", `现在应该开始拍摄「${task.title}」`, task.id, task.title);
          }
        }

        // ③ 临近发布提醒（按真实剩余分钟数）
        const remainMin = Math.floor((publishTs - nowTs) / 60000);
        const warns = [
          { mins: 60, key: `warn60-${task.id}`, msg: "距发布仅剩1小时" },
          { mins: 30, key: `warn30-${task.id}`, msg: "距发布仅剩30分钟！" },
          { mins: 10, key: `warn10-${task.id}`, msg: "距发布仅剩10分钟！立即上传！" },
        ];
        warns.forEach(w => {
          if (remainMin <= w.mins && remainMin >= 0 && !firedReminders.has(w.key) && task.state !== "已完成") {
            setFiredReminders(prev => new Set([...prev, w.key]));
            addReminder({ title: `⚡ ${task.title}`, message: w.msg, type: remainMin <= 10 ? "danger" : "warning", taskId: task.id });
          }
        });

        // ④ 时间轴节点提醒（按分钟匹配，10秒容差内触发一次）
        const prepTime = addMins(startTime, 20);
        const shootTime = addMins(startTime, 40);
        const nodeChecks = [
          { key:`start-${task.id}`, time: startTime, msg:"确认脚本，准备开始今天的拍摄" },
          { key:`prep-${task.id}`, time: prepTime, msg:"设备准备，检查麦克风和灯光" },
          { key:`shoot-${task.id}`, time: shootTime, msg:`开始拍摄「${task.title}」` },
        ];
        nodeChecks.forEach(n => {
          const nodeM = toMins(n.time);
          if (nowM === nodeM && !firedReminders.has(n.key)) {
            setFiredReminders(prev => new Set([...prev, n.key]));
            addReminder({ title: "📍 时间节点", message: n.msg, type: "info", taskId: task.id });
          }
        });
      });
    }, 1000); // 每1秒检查一次，确保10秒级测试任务能被精确捕获

    return () => clearInterval(interval);
  }, [tasks, startTime, firedReminders, addReminder, showPopup, snoozedUntil]);

  // ── 弹窗按钮操作 ──
  function handlePopupAction(popup: PopupReminder, action: "shoot"|"snooze"|"done") {
    setPopupQueue(prev => prev.filter(p => p.id !== popup.id));
    setReminders(prev => prev.map(r => r.taskId === popup.taskId && !r.handled ? { ...r, handled: true } : r));
    if (action === "shoot") {
      transitionState(popup.taskId, "拍摄中");
    } else if (action === "snooze") {
      setSnoozedUntil(prev => ({ ...prev, [popup.taskId]: Date.now() + 5 * 60 * 1000 }));
      addReminder({ title: "已稍后提醒", message: `「${popup.taskTitle}」将在5分钟后再次提醒`, type: "info", taskId: popup.taskId });
    } else if (action === "done") {
      requestTransition(popup.taskId, "已完成");
    }
  }

  // ── 声音解锁：用户点击时调用 ──
  async function handleEnableSound() {
    setSoundError(null);
    const ok = await unlockAndTestAudio();
    if (ok) {
      setSoundEnabled(true);
      setSoundUnlocked(true);
    } else {
      setSoundEnabled(false);
      setSoundError("浏览器阻止了声音播放，请检查浏览器的网站声音权限设置");
    }
  }

  // ── 添加测试任务：10秒后到期，用于验证提醒链路 ──
  function addTestTask() {
    const id = `test-${Date.now()}`;
    const shootAt = Date.now() + 10000; // 10秒后
    const publishAt = new Date(Date.now() + 10000);
    const publishTime = `${String(publishAt.getHours()).padStart(2,"0")}:${String(publishAt.getMinutes()).padStart(2,"0")}`;
    setTasks(prev => [...prev, {
      id, title: "🧪 测试任务（10秒后到期）", priority: "S",
      publishTime, duration: 30, shootAt,
      state: "未开始", previousState: null,
      stateHistory: [{ state: "未开始", time: nowHHMM() }],
      content: Object.fromEntries(CONTENT_ITEMS.map(k=>[k,false])),
      equipment: Object.fromEntries(EQUIPMENT_ITEMS.map(k=>[k,false])),
      notes: "用于验证：10秒后应弹窗+Toast+声音+提醒中心记录+倒计时变已超时",
    }]);
    setTestTaskAdded(true);
    addReminder({ title: "🧪 测试任务已创建", message: "10秒后将自动触发拍摄提醒，请观察弹窗、Toast、声音和提醒中心", type: "info", taskId: id });
  }

  // ── 状态转换（支持自由切换 + 撤销） ──
  function transitionState(taskId: string, newState: TaskState, isUndo = false) {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const note = isUndo ? `撤销：${t.state} → ${newState}` : undefined;
      const history = [...t.stateHistory, { state: newState, time: nowHHMM(), note }];
      return { ...t, state: newState, previousState: isUndo ? null : t.state, stateHistory: history };
    }));
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!isUndo) {
      if (newState === "拍摄中") addReminder({ title: "🎬 开始拍摄", message: `「${task.title}」进入拍摄状态`, type: "info", taskId });
      if (newState === "已完成") addReminder({ title: "✅ 任务完成", message: `「${task.title}」已完成！`, type: "success", taskId });
      if (newState === "待补拍") addReminder({ title: "📹 补拍提醒", message: `「${task.title}」需要补拍素材`, type: "warning", taskId });
    } else {
      addReminder({ title: "↩️ 已撤销", message: `「${task.title}」恢复为「${newState}」`, type: "info", taskId });
    }
  }

  // 请求切换状态：已完成需要二次确认，其他状态直接切换
  function requestTransition(taskId: string, newState: TaskState) {
    if (newState === "已完成") {
      setConfirmingTask(taskId);
      setPendingState(newState);
    } else {
      transitionState(taskId, newState);
    }
  }

  // 撤销上一步：恢复到 previousState
  function undoLastTransition(taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.previousState === null) return;
    transitionState(taskId, task.previousState, true);
  }

  function addTask() {
    const id = String(Date.now());
    setTasks(prev => [...prev, {
      id, title: "新视频任务", priority: "A", publishTime: "20:00", duration: 60,
      state: "未开始", previousState: null, stateHistory: [{ state: "未开始", time: nowHHMM() }],
      content: Object.fromEntries(CONTENT_ITEMS.map(k=>[k,false])),
      equipment: Object.fromEntries(EQUIPMENT_ITEMS.map(k=>[k,false])),
      notes: "",
    }]);
  }

  function updateTask(id: string, patch: Partial<VideoTask>) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  function dismissReminder(id: string) {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, read: true } : r));
  }

  const unreadCount = reminders.filter(r => !r.read).length;
  const nowM = toMins(nowHHMM());

  // ── 生成时间轴 ──
  function buildTimeline(): TimelineNode[] {
    const nodes: TimelineNode[] = [];
    let cursor = startTime;
    nodes.push({ time: cursor, label: "开始 · 确认脚本和选题", type: "start", reminder: "检查所有脚本逻辑，标注重点段落", fired: firedReminders.has(`start-${tasks[0]?.id}`) });
    cursor = addMins(cursor, 20);
    nodes.push({ time: cursor, label: "设备检查与准备", type: "prep", reminder: "检查电量、存储、麦克风连接", fired: firedReminders.has(`prep-${tasks[0]?.id}`) });
    cursor = addMins(cursor, 20);
    tasks.forEach((task, i) => {
      const mins = Math.max(20, Math.ceil(task.duration/60)*3+15);
      nodes.push({ time: cursor, label: `拍摄：${task.title}`, type: "shoot", taskId: task.id, reminder: `优先级 ${task.priority} · 预计 ${task.duration}秒`, fired: firedReminders.has(`shoot-${task.id}`) });
      cursor = addMins(cursor, mins);
      if (i < tasks.length-1) { nodes.push({ time: cursor, label: "短暂休息", type: "break", fired: false }); cursor = addMins(cursor, 5); }
    });
    nodes.push({ time: cursor, label: "补拍 B-roll / 录屏 / 案例素材", type: "reshoot", reminder: "检查所有视频的素材缺失项", fired: false });
    cursor = addMins(cursor, 25);
    nodes.push({ time: cursor, label: "整理素材，传输至剪辑设备", type: "organize", fired: false });
    return nodes;
  }

  // 发布倒推
  function buildPublishPlan() {
    const pub = tasks[0]?.publishTime ?? "20:00";
    return [
      { time: pub,              label: "📢 发布上线",    note: "多平台同步" },
      { time: addMins(pub,-30), label: "⬆️ 上传平台",    note: "写好标题封面标签" },
      { time: addMins(pub,-90), label: "✂️ 导出成品",    note: "检查质量和音频" },
      { time: addMins(pub,-180),label: "🎬 剪辑完成",    note: "完成剪辑和调色" },
      { time: addMins(pub,-300),label: "📷 拍摄完成",    note: "完成拍摄和补拍" },
      { time: addMins(pub,-420),label: "📝 脚本锁定",    note: "不再修改脚本" },
    ].sort((a,b) => toMins(a.time)-toMins(b.time));
  }

  const timeline = buildTimeline();
  const publishPlan = buildPublishPlan();

  const NODE_COLORS: Record<string,string> = {
    start:"#C8F04A", prep:"#C99A1E", shoot:"#3DA876",
    reshoot:"#E07A3A", organize:"#9B7ED9", break:"#EAEAE6",
  };

  function Card({ children, className="" }: { children: React.ReactNode; className?: string }) {
    return <div className={`card p-5 ${className}`}>{children}</div>;
  }

  return (
    <div className="max-w-[1100px] pb-20">
      {/* Toast */}
      <Toast reminders={reminders} onClose={dismissReminder}/>

      {/* 真正的弹窗提醒（队列，一次显示一个） */}
      {popupQueue.length > 0 && (
        <ReminderPopup popup={popupQueue[0]} onAction={(action) => handlePopupAction(popupQueue[0], action)} />
      )}

      {/* 完成确认弹窗 */}
      {confirmingTask && pendingState === "已完成" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-[380px] rounded-[18px] bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-[16px] font-black text-[#1A1A1A]">确认完成任务？</h3>
            <p className="mb-5 text-[13px] leading-6 text-[#666]">
              完成后任务会进入已完成状态，你仍然可以手动恢复，但建议确认所有素材、剪辑和发布动作已经完成。
            </p>
            <div className="flex gap-3">
              <button onClick={() => { setConfirmingTask(null); setPendingState(null); }}
                className="flex-1 rounded-[12px] border border-[#EAEAE6] py-2.5 text-[13.5px] font-semibold text-[#555]">
                取消
              </button>
              <button onClick={() => { transitionState(confirmingTask, "已完成"); setConfirmingTask(null); setPendingState(null); }}
                className="flex-1 rounded-[12px] bg-[#1A1A1A] py-2.5 text-[13.5px] font-bold text-white">
                确认完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-[13px] text-[#888]"><a href="/" className="font-semibold text-[#3A7A0A]">工作台</a> / AI 拍摄作战中心</div>
          <h1 className="text-[24px] font-black text-[#1A1A1A]">AI 拍摄作战中心 <span className="text-[14px] font-normal text-[#888]">V2.0</span></h1>
          <p className="mt-1 text-[13px] text-[#777]">状态机 · 提醒中心 · 时间轴 · 发布倒推 · 风险扫描</p>
          {soundError && <p className="mt-1 text-[12px] font-semibold text-[#A32D2D]">⚠ {soundError}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 开始时间 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-[#888]">开始</span>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="rounded-[10px] border border-[#EAEAE6] bg-white px-2.5 py-1.5 text-[13px] font-semibold outline-none focus:border-[#C8F04A]"/>
          </div>
          {/* 声音开关：真正解锁+播放测试音 */}
          <button onClick={() => { if (soundEnabled) { setSoundEnabled(false); } else { handleEnableSound(); } }}
            className="rounded-[10px] border px-3 py-1.5 text-[12px] font-semibold"
            style={{ borderColor: soundUnlocked && soundEnabled ? "#3A7A0A" : "#EAEAE6", color: soundEnabled?"#3A7A0A":"#888", background:"#fff" }}>
            {soundEnabled ? "🔔 声音已启用" : "🔕 点击启用声音"}
          </button>
          {/* 通知权限 */}
          {!notifGranted && (
            <button onClick={async () => { const ok = await requestNotificationPermission(); setNotifGranted(ok); }}
              className="rounded-[10px] bg-[#1A1A1A] px-3 py-1.5 text-[12px] font-semibold text-white">
              开启通知权限
            </button>
          )}
          {/* 测试任务 */}
          {!testTaskAdded && (
            <button onClick={addTestTask}
              className="rounded-[10px] border border-[#C8F04A] bg-[#F0F9D8] px-3 py-1.5 text-[12px] font-bold text-[#3A7A0A]">
              🧪 添加10秒测试任务
            </button>
          )}
          {/* 提醒中心 */}
          <button onClick={() => setShowReminderCenter(p=>!p)}
            className="relative rounded-[10px] border border-[#EAEAE6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1A1A1A]">
            📋 提醒中心
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#A32D2D] text-[9px] font-black text-white">{unreadCount}</span>
            )}
          </button>
          <span className="rounded-full bg-[#E4F9C0] px-3 py-1.5 text-[12px] font-bold text-[#3A7A0A]">03 · 拍摄</span>
        </div>
      </header>

      {/* 提醒中心面板 */}
      {showReminderCenter && (
        <div className="mb-5 card p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#F0EFE9] px-5 py-3">
            <span className="text-[14px] font-black text-[#1A1A1A]">提醒中心 ({reminders.length})</span>
            <div className="flex gap-2">
              <button onClick={() => setReminders(prev => prev.map(r=>({...r,read:true})))}
                className="text-[12px] text-[#3A7A0A] underline">全部已读</button>
              <button onClick={() => setShowReminderCenter(false)} className="text-[#888]">×</button>
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {reminders.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-[#888]">暂无提醒</div>
            ) : [...reminders].reverse().map(r => (
              <div key={r.id} className={`flex items-start gap-3 px-5 py-3 border-b border-[#F8F8F4] ${r.read?"opacity-50":""}`}>
                <span className="text-[16px]">{r.type==="danger"?"🚨":r.type==="warning"?"⚠️":r.type==="success"?"✅":"💡"}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-[#1A1A1A]">{r.title}</span>
                    {r.riskLevel && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.riskLevel==="高"?"bg-[#FCEBEB] text-[#A32D2D]":r.riskLevel==="中"?"bg-[#FBF3D6] text-[#7A5C00]":"bg-[#F0EFE9] text-[#888]"}`}>
                        {r.riskLevel}风险
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.handled?"bg-[#E4F9C0] text-[#3A7A0A]":"bg-[#F0EFE9] text-[#888]"}`}>
                      {r.handled?"已处理":"未处理"}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#888]">{r.message}</div>
                  <div className="text-[10px] text-[#CCC] mt-0.5">{r.time}</div>
                </div>
                {!r.read && <button onClick={() => dismissReminder(r.id)} className="text-[11px] text-[#888] underline">已读</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-2">
        {([["setup","📋 任务创建"],["command","⚡ 指挥中心"]] as const).map(([id,label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-black transition"
            style={activeTab===id?{background:"#1A1A1A",color:"#fff"}:{background:"#F0EFE9",color:"#555"}}>
            {label}
          </button>
        ))}
      </div>

      {/* ══ TAB 1: 任务创建 ══ */}
      {activeTab === "setup" && (
        <div className="flex flex-col gap-4">
          {tasks.map(task => (
            <Card key={task.id} className="overflow-hidden">
              {/* 任务头部 + 状态机 */}
              <div className="mb-4">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: PRIORITY_STYLE[task.priority].bg, color: PRIORITY_STYLE[task.priority].text }}>{task.priority}级</span>
                  <input value={task.title} onChange={e => updateTask(task.id,{title:e.target.value})}
                    className="flex-1 min-w-[160px] text-[15px] font-black text-[#1A1A1A] bg-transparent outline-none border-b border-transparent focus:border-[#C8F04A]"/>
                  <input type="time" value={task.publishTime} onChange={e => updateTask(task.id,{publishTime:e.target.value})}
                    className="rounded-[8px] border border-[#EAEAE6] bg-[#F8F8F4] px-2 py-1 text-[12px] outline-none focus:border-[#C8F04A]"/>
                </div>

                {/* 状态机 */}
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#888]">
                  <span>当前状态</span>
                  {task.previousState && (
                    <button onClick={() => undoLastTransition(task.id)}
                      className="rounded-full bg-[#FBF3D6] px-2.5 py-1 text-[11px] font-bold text-[#7A5C00] hover:bg-[#F5E8B8]">
                      ↩️ 撤销上一步（恢复为「{task.previousState}」）
                    </button>
                  )}
                  <button onClick={() => setHistoryTask(historyTask === task.id ? null : task.id)}
                    className="text-[11px] font-bold text-[#4A8FD6] underline underline-offset-2">
                    状态历史 ({task.stateHistory.length})
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* 当前状态徽章 */}
                  <div className="rounded-full border-2 px-3 py-1.5 text-[12px] font-black" style={{ borderColor: STATE_STYLE[task.state].border, background: STATE_STYLE[task.state].bg, color: STATE_STYLE[task.state].text }}>
                    ● {task.state}
                  </div>

                  {/* 状态下拉选择器：可切换到任意状态 */}
                  <select value={task.state} onChange={e => requestTransition(task.id, e.target.value as TaskState)}
                    className="rounded-full border border-[#EAEAE6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1A1A1A] outline-none focus:border-[#C8F04A]">
                    {TASK_STATES.map(s => <option key={s} value={s}>{s === task.state ? `当前：${s}` : `切换到：${s}`}</option>)}
                  </select>

                  {/* 推荐的下一步（仍提供快捷按钮，但不限制范围） */}
                  {RECOMMENDED_NEXT[task.state].map(next => (
                    <button key={next} onClick={() => requestTransition(task.id, next)}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition hover:opacity-80"
                      style={{ borderColor: STATE_STYLE[next].border, color: STATE_STYLE[next].text, background: STATE_STYLE[next].bg + "88" }}>
                      → {next}
                    </button>
                  ))}
                </div>

                {/* 状态历史面板 */}
                {historyTask === task.id && (
                  <div className="mt-2 rounded-[10px] bg-[#F8F8F4] p-3">
                    <div className="mb-1.5 text-[11px] font-bold text-[#888]">完整状态流转记录</div>
                    <div className="flex flex-col gap-1">
                      {task.stateHistory.map((h,i) => (
                        <div key={i} className="flex items-center gap-2 text-[12px]">
                          <span className="text-[#888] tabular-nums">{h.time}</span>
                          {h.note ? (
                            <span className="text-[#C99A1E] font-semibold">{h.note}</span>
                          ) : (
                            <span className="font-semibold" style={{ color: STATE_STYLE[h.state].text }}>{h.state}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 基础信息 */}
              <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-bold text-[#888] mb-1">优先级</label>
                  <select value={task.priority} onChange={e => updateTask(task.id,{priority:e.target.value as Priority})}
                    className="w-full rounded-[10px] border border-[#EAEAE6] bg-[#F8F8F4] px-3 py-2 text-[13px] outline-none focus:border-[#C8F04A]">
                    {(["S","A","B","C"] as Priority[]).map(p=><option key={p} value={p}>{p}级</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#888] mb-1">预计时长（秒）</label>
                  <input type="number" value={task.duration} onChange={e => updateTask(task.id,{duration:Number(e.target.value)})}
                    className="w-full rounded-[10px] border border-[#EAEAE6] bg-[#F8F8F4] px-3 py-2 text-[13px] outline-none focus:border-[#C8F04A]"/>
                </div>
              </div>

              {/* 内容准备 */}
              <div className="mb-4">
                <div className="mb-2 text-[11px] font-bold text-[#888]">内容准备情况</div>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_ITEMS.map(item => (
                    <button key={item} onClick={() => updateTask(task.id,{content:{...task.content,[item]:!task.content[item]}})}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
                      style={task.content[item]?{background:"#E4F9C0",borderColor:"#C8F04A",color:"#2A5A0A"}:{background:"#F0EFE9",borderColor:"#EAEAE6",color:"#888"}}>
                      {task.content[item]?"✓ ":""}{item}
                    </button>
                  ))}
                </div>
              </div>

              {/* 设备准备 */}
              <div className="mb-4">
                <div className="mb-2 text-[11px] font-bold text-[#888]">设备准备情况</div>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_ITEMS.map(item => (
                    <button key={item} onClick={() => updateTask(task.id,{equipment:{...task.equipment,[item]:!task.equipment[item]}})}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
                      style={task.equipment[item]?{background:"#DCEBFB",borderColor:"#6FA8E0",color:"#0A3A6A"}:{background:"#F0EFE9",borderColor:"#EAEAE6",color:"#888"}}>
                      {task.equipment[item]?"✓ ":""}{item}
                    </button>
                  ))}
                </div>
              </div>

              <textarea value={task.notes} onChange={e => updateTask(task.id,{notes:e.target.value})}
                placeholder="备注：补拍需求、特殊要求…"
                className="w-full resize-none rounded-[10px] border border-[#EAEAE6] bg-[#F8F8F4] px-3 py-2.5 text-[13px] outline-none focus:border-[#C8F04A] min-h-[56px]"/>

              {tasks.length > 1 && (
                <button onClick={() => setTasks(prev=>prev.filter(t=>t.id!==task.id))}
                  className="mt-2 text-[12px] text-[#A32D2D] underline">删除此任务</button>
              )}
            </Card>
          ))}

          <button onClick={addTask} className="flex h-[48px] items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#EAEAE6] text-[13.5px] font-semibold text-[#888] hover:border-[#C8F04A] hover:text-[#3A7A0A] transition">
            + 添加拍摄任务
          </button>
          <button onClick={() => setActiveTab("command")} className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[#1A1A1A] text-[14px] font-black text-white">
            进入指挥中心 →
          </button>
        </div>
      )}

      {/* ══ TAB 2: 指挥中心 ══ */}
      {activeTab === "command" && (
        <div className="flex flex-col gap-6">

          {/* 任务状态总览 */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-[16px] font-black text-[#1A1A1A]">任务状态系统</h2>
              <span className="text-[12px] text-[#888]">点击状态标签直接切换</span>
            </div>
            <div className="flex flex-col gap-3">
              {tasks.map(task => {
                const risk = calcRisk(task, nowM);
                return (
                  <Card key={task.id} className="overflow-hidden">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[14px] font-black text-[#1A1A1A] flex-1">{task.title}</span>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: PRIORITY_STYLE[task.priority].bg, color: PRIORITY_STYLE[task.priority].text }}>{task.priority}级</span>
                      <span className="text-[12px] text-[#888]">{task.publishTime} 发布</span>
                      {/* 风险标签 */}
                      {risk.level !== "无" && (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${risk.level==="高"?"bg-[#FCEBEB] text-[#A32D2D]":risk.level==="中"?"bg-[#FBF3D6] text-[#7A5C00]":"bg-[#DCEBFB] text-[#2D5EA3]"}`}>
                          {risk.level}风险
                        </span>
                      )}
                      {/* 状态机：下拉选择器 + 撤销按钮 */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full border-2 px-2.5 py-1 text-[11px] font-black" style={{ borderColor:STATE_STYLE[task.state].border, background:STATE_STYLE[task.state].bg, color:STATE_STYLE[task.state].text }}>
                          {task.state}
                        </span>
                        <select value={task.state} onChange={e => requestTransition(task.id, e.target.value as TaskState)}
                          className="rounded-full border border-[#EAEAE6] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1A1A1A] outline-none focus:border-[#C8F04A]">
                          {TASK_STATES.map(s => <option key={s} value={s}>{s === task.state ? `当前：${s}` : `切换到：${s}`}</option>)}
                        </select>
                        {task.previousState && (
                          <button onClick={() => undoLastTransition(task.id)}
                            className="rounded-full bg-[#FBF3D6] px-2.5 py-1 text-[11px] font-bold text-[#7A5C00] hover:bg-[#F5E8B8]">
                            ↩️ 撤销
                          </button>
                        )}
                        <button onClick={() => setHistoryTask(historyTask === task.id ? null : task.id)}
                          className="text-[11px] font-bold text-[#4A8FD6] underline underline-offset-2">
                          历史
                        </button>
                      </div>
                    </div>
                    {/* 状态历史面板 */}
                    {historyTask === task.id && (
                      <div className="mt-2 rounded-[10px] bg-[#F8F8F4] p-3">
                        <div className="flex flex-col gap-1">
                          {task.stateHistory.map((h,i) => (
                            <div key={i} className="flex items-center gap-2 text-[12px]">
                              <span className="text-[#888] tabular-nums">{h.time}</span>
                              {h.note ? (
                                <span className="text-[#C99A1E] font-semibold">{h.note}</span>
                              ) : (
                                <span className="font-semibold" style={{ color: STATE_STYLE[h.state].text }}>{h.state}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 风险详情 */}
                    {risk.reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {risk.reasons.map((r,i) => (
                          <span key={i} className="rounded bg-[#FCEBEB] px-2 py-0.5 text-[10px] text-[#A32D2D]">⚠ {r}</span>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>

          {/* 倒计时 */}
          <section>
            <h2 className="mb-4 text-[16px] font-black text-[#1A1A1A]">拍摄倒计时</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {[
                { label: "距离开始拍摄", time: addMins(startTime,40), color:"#C8F04A" },
                { label: "距离发布时间", time: tasks[0]?.publishTime??"20:00", color:"#3DA876" },
                { label: "距离脚本截止", time: addMins(tasks[0]?.publishTime??"20:00",-420), color:"#E07A3A" },
              ].map(c => (
                <Card key={c.label} className="text-center">
                  <div className="text-[12px] text-[#888] mb-2">{c.label}</div>
                  <Countdown target={c.time} color={c.color}/>
                  <div className="text-[11px] text-[#888] mt-1">目标 {c.time}</div>
                </Card>
              ))}
            </div>
          </section>

          {/* 时间轴 */}
          <section>
            <h2 className="mb-4 text-[16px] font-black text-[#1A1A1A]">今日拍摄时间轴</h2>
            <Card>
              <div className="relative pl-6">
                <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-[#EAEAE6]"/>
                {timeline.map((node, i) => {
                  const nodeTime = toMins(node.time);
                  const isPast = nodeTime < nowM;
                  const isCurrent = !isPast && nodeTime <= nowM + 10;
                  return (
                    <div key={i} className="relative mb-4 last:mb-0">
                      <div className={`absolute -left-4 top-1.5 h-3 w-3 rounded-full border-2 border-white transition-all ${isCurrent?"ring-4 ring-opacity-30":""}`}
                        style={{ background: NODE_COLORS[node.type] ?? "#EAEAE6", boxShadow: isCurrent ? `0 0 0 4px ${NODE_COLORS[node.type]}44` : "none" }}/>
                      <div className={`flex items-start gap-3 ${isPast?"opacity-50":""}`}>
                        <div className="w-[90px] flex-shrink-0">
                          <div className={`text-[12px] font-bold ${isCurrent?"text-[#3A7A0A]":"text-[#1A1A1A]"}`}>{node.time}</div>
                        </div>
                        <div className={`flex-1 rounded-[10px] border p-3 ${isCurrent?"border-[#C8F04A] bg-[#F8FFF0]":"border-[#F0EFE9]"}`}>
                          <div className="text-[13px] font-semibold text-[#1A1A1A] mb-0.5">{node.label}</div>
                          {node.reminder && <div className="text-[11px] text-[#888]">💡 {node.reminder}</div>}
                          {node.fired && <div className="text-[10px] text-[#3A7A0A] mt-0.5">✓ 提醒已发送</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* 发布倒推 */}
          <section>
            <h2 className="mb-4 text-[16px] font-black text-[#1A1A1A]">发布倒推计划 <span className="text-[13px] font-normal text-[#888]">目标 {tasks[0]?.publishTime}</span></h2>
            <Card>
              <div className="relative pl-6">
                <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-[#EAEAE6]"/>
                {publishPlan.map((step, i) => {
                  const isPast = toMins(step.time) < nowM;
                  const isLast = i === publishPlan.length-1;
                  return (
                    <div key={i} className={`relative mb-3 last:mb-0 flex items-start gap-3 ${isPast?"opacity-40":""}`}>
                      <div className={`absolute -left-4 top-1.5 h-3 w-3 rounded-full border-2 border-white`}
                        style={{ background: isLast?"#C8F04A":"#1A1A1A" }}/>
                      <div className="w-[55px] flex-shrink-0 text-[13px] font-black" style={{ color:isLast?"#3A7A0A":"#1A1A1A" }}>{step.time}</div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#1A1A1A]">{step.label}</div>
                        <div className="text-[11px] text-[#888]">{step.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* 风险扫描 */}
          <section>
            <h2 className="mb-4 text-[16px] font-black text-[#1A1A1A]">AI 风险扫描</h2>
            <div className="flex flex-col gap-3">
              {tasks.map(task => {
                const risk = calcRisk(task, nowM);
                if (risk.level === "无") return (
                  <div key={task.id} className="rounded-[14px] bg-[#F0F9D8] px-4 py-3 text-[13px] font-semibold text-[#3A7A0A]">
                    ✓ 「{task.title}」未发现明显风险
                  </div>
                );
                return (
                  <div key={task.id} className={`rounded-[14px] border-l-4 p-4 ${risk.level==="高"?"border-[#A32D2D] bg-[#FFF5F5]":risk.level==="中"?"border-[#C99A1E] bg-[#FFFBF0]":"border-[#4A8FD6] bg-[#F0F5FF]"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${risk.level==="高"?"bg-[#A32D2D]":risk.level==="中"?"bg-[#C99A1E]":"bg-[#4A8FD6]"}`}>{risk.level}风险</span>
                      <span className="text-[14px] font-bold text-[#1A1A1A]">「{task.title}」</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {risk.reasons.map((r,i) => (
                        <span key={i} className="rounded-full bg-white px-3 py-1 text-[12px] text-[#1A1A1A] shadow-sm">⚠ {r}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <button onClick={() => setActiveTab("setup")}
            className="flex h-[48px] items-center justify-center gap-2 rounded-[14px] border-2 border-[#EAEAE6] text-[13.5px] font-semibold text-[#555] hover:border-[#1A1A1A] transition">
            ← 返回任务创建
          </button>
        </div>
      )}
    </div>
  );
}
