"use client";

import { ShootRoomResult } from "./types";

function ListGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] bg-[#F4F4F2] p-2">
      <h3 className="px-3 pb-2 pt-1.5 text-[13px] font-semibold uppercase tracking-wide text-[#8A8A86]">
        {icon} {title}
      </h3>
      <div className="overflow-hidden rounded-[16px] bg-white">{children}</div>
    </div>
  );
}

function Row({
  children,
  isLast,
}: {
  children: React.ReactNode;
  isLast: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 ${
        !isLast ? "border-b border-[#E5E4DE]" : ""
      }`}
    >
      {children}
    </div>
  );
}

const RISK_COLORS: Record<string, { bg: string; text: string }> = {
  高: { bg: "#FDEEF3", text: "#E0608E" },
  中: { bg: "#FBF3D6", text: "#C99A1E" },
  低: { bg: "#DBF1E6", text: "#3DA876" },
};

function scoreRing(score: number) {
  // 0-100 -> 0-360deg
  const deg = (score / 100) * 360;
  return `conic-gradient(#639922 ${deg}deg, #EAF3DE ${deg}deg)`;
}

export default function ShootResultPanel({ result }: { result: ShootRoomResult }) {
  return (
    <div className="flex flex-col gap-7">
      {/* 1. 完成度评分 */}
      <div className="grid grid-cols-1 gap-5 rounded-[24px] bg-[#EAF3DE] p-6 md:grid-cols-[200px_1fr] md:p-7">
        <div className="flex flex-col items-center justify-center gap-2 rounded-[20px] bg-white px-5 py-6">
          <div
            className="flex h-[120px] w-[120px] items-center justify-center rounded-full"
            style={{ background: scoreRing(result.completion.total) }}
          >
            <div className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-white">
              <span className="text-[32px] font-bold text-[#1C1C1B]">
                {result.completion.total}
              </span>
            </div>
          </div>
          <div className="text-[13px] font-semibold text-[#8A8A86]">综合完成度</div>
        </div>
        <div className="flex flex-col justify-center">
          <h2 className="mb-3 text-[19px] font-bold tracking-tight">拍摄完成度评分</h2>
          <div className="grid grid-cols-2 gap-3">
            {result.completion.dimensions.map((d) => (
              <div key={d.label} className="rounded-[14px] bg-white px-4 py-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[#1C1C1B]">{d.label}</span>
                  <span className="text-[13px] font-bold text-[#639922]">{d.score}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-[#639922]"
                    style={{ width: `${d.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. 风险扫描 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">风险扫描</h2>
          <span className="text-[13px] text-[#8A8A86]">{result.risks.length} 项待处理</span>
        </div>
        <ListGroup title="风险提示" icon="⚠️">
          {result.risks.map((r, i) => {
            const color = RISK_COLORS[r.level];
            return (
              <Row key={r.text} isLast={i === result.risks.length - 1}>
                <span
                  className="flex h-7 min-w-[40px] items-center justify-center rounded-full px-2 text-[11px] font-bold"
                  style={{ background: color.bg, color: color.text }}
                >
                  {r.level}风险
                </span>
                <span className="text-[14px] leading-6 text-[#1C1C1B]">{r.text}</span>
              </Row>
            );
          })}
        </ListGroup>
      </div>

      {/* 3. 拍摄顺序优化 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">拍摄顺序优化</h2>
          <span className="text-[13px] text-[#8A8A86]">{result.shootOrderReason}</span>
        </div>
        <ListGroup title="建议拍摄顺序" icon="🎬">
          {result.shootOrder.map((s, i) => (
            <Row key={s.step} isLast={i === result.shootOrder.length - 1}>
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EAF3DE] text-[11px] font-bold text-[#639922]">
                {s.step}
              </span>
              <span className="text-[14px] leading-6 text-[#1C1C1B]">{s.title}</span>
            </Row>
          ))}
        </ListGroup>
      </div>

      {/* 4. 时间预估 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">时间预估</h2>
          <span className="text-[13px] text-[#8A8A86]">总耗时约 {Math.floor(result.timeEstimate.total / 60)} 小时 {result.timeEstimate.total % 60} 分钟</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] bg-[#FBE5D6] p-4">
            <div className="text-[12.5px] font-semibold text-[#D9824A]">脚本确认</div>
            <div className="mt-1 text-[24px] font-bold text-[#1C1C1B]">{result.timeEstimate.script} 分钟</div>
          </div>
          <div className="rounded-[18px] bg-[#DCEBFB] p-4">
            <div className="text-[12.5px] font-semibold text-[#4A8FD6]">正式拍摄</div>
            <div className="mt-1 text-[24px] font-bold text-[#1C1C1B]">{result.timeEstimate.shooting} 分钟</div>
          </div>
          <div className="rounded-[18px] bg-[#DBF1E6] p-4">
            <div className="text-[12.5px] font-semibold text-[#3DA876]">补拍</div>
            <div className="mt-1 text-[24px] font-bold text-[#1C1C1B]">{result.timeEstimate.reshoot} 分钟</div>
          </div>
        </div>
      </div>

      {/* 5. AI遗漏提醒 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">AI 遗漏提醒</h2>
          <span className="text-[13px] text-[#8A8A86]">{result.reminders.length} 条建议</span>
        </div>
        <ListGroup title="遗漏提醒" icon="🔔">
          {result.reminders.map((r, i) => (
            <Row key={r} isLast={i === result.reminders.length - 1}>
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#FBF3D6] text-[12px] font-bold text-[#C99A1E]">
                !
              </span>
              <span className="text-[14px] leading-6 text-[#1C1C1B]">{r}</span>
            </Row>
          ))}
        </ListGroup>
      </div>

      {/* 6. 今日执行计划 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">今日执行计划</h2>
          <span className="text-[13px] text-[#8A8A86]">共 {result.schedule.length} 个时段</span>
        </div>
        <ListGroup title="时间安排" icon="🗓️">
          {result.schedule.map((s, i) => (
            <Row key={s.time} isLast={i === result.schedule.length - 1}>
              <span className="min-w-[100px] flex-shrink-0 rounded-full bg-[#EAF3DE] px-2.5 py-1 text-center text-[12px] font-bold text-[#639922]">
                {s.time}
              </span>
              <span className="text-[14px] leading-6 text-[#1C1C1B]">{s.task}</span>
            </Row>
          ))}
        </ListGroup>
      </div>

      {/* 7. 爆款风险评估 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">爆款风险评估</h2>
          <span className="text-[13px] text-[#8A8A86]">按视频逐一评估</span>
        </div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {result.viralAssessment.map((v) => (
            <div key={v.videoName} className="rounded-[18px] bg-[#F4F4F2] p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[14px] font-bold text-[#1C1C1B]">{v.videoName}</span>
                <span className="text-[14px] tracking-widest text-[#E0B84A]">
                  {"★".repeat(v.potential)}
                  {"☆".repeat(5 - v.potential)}
                </span>
              </div>
              <div className="text-[12.5px] leading-6 text-[#1C1C1B]/70">
                <span className="font-semibold text-[#E0608E]">风险：</span>
                {v.risk}
              </div>
              <div className="text-[12.5px] leading-6 text-[#1C1C1B]/70">
                <span className="font-semibold text-[#3DA876]">建议：</span>
                {v.suggestion}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 8. 一键生成拍摄清单 */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="text-[19px] font-bold tracking-tight">拍摄清单</h2>
          <span className="text-[13px] text-[#8A8A86]">共 {result.checklist.length} 项</span>
        </div>
        <div className="rounded-[20px] bg-[#F4F4F2] p-2">
          <div className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2">
            {result.checklist.map((item) => (
              <label
                key={item}
                className="flex items-center gap-3 rounded-[14px] bg-white px-4 py-3 text-[14px] text-[#1C1C1B]"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded-md border-2 border-[#E5E1F2] text-[#639922] accent-[#639922]"
                />
                {item}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
