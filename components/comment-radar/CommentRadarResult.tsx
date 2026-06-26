"use client";

import type { CommentRadarResult } from "./types";

const EMOTION_COLORS: Record<string, string> = {
  焦虑: "#E05C3A", 迷茫: "#C99A1E", 好奇: "#4A8FD6",
  认可: "#3DA876", 怀疑: "#9B7ED9", 兴奋: "#E07A3A",
  反对: "#E0608E", 吐槽: "#888",
};

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  S: { bg: "#1E3A0F", text: "#7EC843" },
  A: { bg: "#1A2E4A", text: "#6FA8E0" },
  B: { bg: "#2E2410", text: "#C99A1E" },
  C: { bg: "#2A1A1A", text: "#E0608E" },
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-[17px] font-semibold text-[#1C1C1B]">{title}</h2>
        {sub && <span className="text-[12.5px] text-[#8A8A86]">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-[#E5E4DE] bg-white p-5 ${className}`}>
      {children}
    </div>
  );
}

function ScoreRing({ score, size = 88, color = "#639922" }: { score: number; size?: number; color?: string }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F0EFE9" strokeWidth="6" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize="18" fontWeight="600" fill="#1C1C1B">{score}</text>
    </svg>
  );
}

function RadarChart({ data }: { data: { name: string; value: number }[] }) {
  const cx = 160; const cy = 150; const r = 110;
  const n = data.length;
  const pts = data.map((_, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const valuePts = data.map((d, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const rv = (d.value / 100) * r;
    return { x: cx + rv * Math.cos(angle), y: cy + rv * Math.sin(angle) };
  });

  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <svg width="320" height="300" viewBox="0 0 320 300">
      {gridLevels.map((level) => {
        const gpts = pts.map(p => ({ x: cx + (p.x - cx) * level, y: cy + (p.y - cy) * level }));
        return (
          <polygon key={level}
            points={gpts.map(p => `${p.x},${p.y}`).join(" ")}
            fill="none" stroke="#E5E4DE" strokeWidth="0.5"
          />
        );
      })}
      {pts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#E5E4DE" strokeWidth="0.5" />
      ))}
      <polygon
        points={valuePts.map(p => `${p.x},${p.y}`).join(" ")}
        fill="rgba(99,153,34,0.15)" stroke="#639922" strokeWidth="1.5"
      />
      {valuePts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#639922" />
      ))}
      {data.map((d, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const lr = r + 28;
        const lx = cx + lr * Math.cos(angle);
        const ly = cy + lr * Math.sin(angle);
        return (
          <g key={i}>
            <text x={lx} y={ly - 4} textAnchor="middle" fontSize="11" fill="#8A8A86">{d.name}</text>
            <text x={lx} y={ly + 10} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1C1C1B">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function CommentRadarResult({ result }: { result: CommentRadarResult }) {
  return (
    <div className="flex flex-col gap-6">

      {/* ── 商业价值总分 ── */}
      <div className="grid grid-cols-1 gap-4 rounded-[16px] bg-[#1C1C1B] p-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center gap-1">
          <ScoreRing score={result.commercialScore} size={96} color="#7EC843" />
          <span className="text-[12px] text-[#8A8A86]">商业价值评分</span>
        </div>
        <div className="flex flex-col justify-center gap-3">
          <h2 className="text-[18px] font-semibold text-white">评论区商业价值分析</h2>
          <div className="grid grid-cols-5 gap-2">
            {result.radar.map(r => (
              <div key={r.name} className="rounded-[10px] bg-[#2A2A28] p-3 text-center">
                <div className="text-[18px] font-bold text-[#7EC843]">{r.value}</div>
                <div className="text-[10px] text-[#6B6B68]">{r.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── M1 评论概览 ── */}
      <Section title="模块 01 · 评论数据概览">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "总评论数", value: result.overview.total },
            { label: "有效评论", value: result.overview.valid },
            { label: "无效评论", value: result.overview.invalid },
            { label: "情绪评论", value: result.overview.emotional },
            { label: "问题评论", value: result.overview.questions },
            { label: "购买咨询", value: result.overview.buyInquiry },
          ].map(item => (
            <Card key={item.label} className="text-center">
              <div className="text-[22px] font-bold text-[#1C1C1B]">{item.value}</div>
              <div className="mt-1 text-[12px] text-[#8A8A86]">{item.label}</div>
            </Card>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-[12px] bg-[#EAF3DE] px-4 py-3">
          <ScoreRing score={result.overview.healthScore} size={52} color="#639922" />
          <div>
            <div className="text-[14px] font-semibold text-[#1C1C1B]">评论健康度 {result.overview.healthScore}/100</div>
            <div className="text-[12.5px] text-[#5F7A3A]">评论区互动质量较高，问题型评论占比大，说明受众参与度强</div>
          </div>
        </div>
      </Section>

      {/* ── M2 高频问题 ── */}
      <Section title="模块 02 · 高频问题 TOP 10" sub="自动聚类相似问题">
        <Card>
          <div className="flex flex-col gap-2.5">
            {result.freqQuestions.map((q, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#F1EFE8] text-[11px] font-bold text-[#8A8A86]">{i + 1}</span>
                <span className="flex-1 text-[14px] text-[#1C1C1B]">{q.question}</span>
                <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-[#F1EFE8]">
                  <div className="h-full rounded-full bg-[#639922]" style={{ width: `${q.percent * 2.5}%` }} />
                </div>
                <span className="w-[40px] text-right text-[12px] font-semibold text-[#639922]">{q.percent}%</span>
                <span className="text-[12px] text-[#8A8A86]">{q.count}次</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ── M3 真实需求 ── */}
      <Section title="模块 03 · 真实需求挖掘" sub="表层问题背后的深层动机">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {result.realNeeds.map((n, i) => (
            <Card key={i}>
              <div className="mb-2 text-[12px] font-semibold text-[#8A8A86]">表层问题</div>
              <div className="mb-3 text-[14px] font-semibold text-[#1C1C1B]">「{n.surface}」</div>
              <div className="text-[12px] font-semibold text-[#639922]">真实需求</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {n.real.map((r, j) => (
                  <span key={j} className="rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[12px] text-[#3B6D11]">{r}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── M4 情绪分析 ── */}
      <Section title="模块 04 · 用户情绪分析">
        <Card>
          <div className="flex flex-col gap-2.5">
            {result.emotions.map((e, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-[36px] text-[13px] font-semibold text-[#1C1C1B]">{e.emotion}</span>
                <div className="h-7 flex-1 overflow-hidden rounded-[6px] bg-[#F1EFE8]">
                  <div
                    className="flex h-full items-center px-2.5 text-[12px] font-semibold text-white"
                    style={{ width: `${Math.max(e.percent, 6)}%`, background: EMOTION_COLORS[e.emotion] ?? "#888" }}
                  >
                    {e.percent}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* ── M5 用户画像 ── */}
      <Section title="模块 05 · 用户画像分析">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[#8A8A86]">学习阶段分布</div>
            <div className="flex flex-col gap-2">
              {result.userProfile.stages.map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-[28px] text-[13px] text-[#1C1C1B]">{s.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-[4px] bg-[#F1EFE8]">
                    <div className="h-full bg-[#4A8FD6]" style={{ width: `${s.percent}%` }} />
                  </div>
                  <span className="w-[32px] text-right text-[12px] font-semibold text-[#4A8FD6]">{s.percent}%</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[#8A8A86]">用户目标分布</div>
            <div className="flex flex-col gap-2">
              {result.userProfile.goals.map(g => (
                <div key={g.label} className="flex items-center gap-2">
                  <span className="w-[52px] text-[13px] text-[#1C1C1B]">{g.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-[4px] bg-[#F1EFE8]">
                    <div className="h-full bg-[#C99A1E]" style={{ width: `${g.percent}%` }} />
                  </div>
                  <span className="w-[32px] text-right text-[12px] font-semibold text-[#C99A1E]">{g.percent}%</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[#8A8A86]">综合画像总结</div>
            <p className="text-[13px] leading-6 text-[#1C1C1B]">{result.userProfile.summary}</p>
          </Card>
        </div>
      </Section>

      {/* ── M6 购买意向 ── */}
      <Section title="模块 06 · 购买意向识别">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
          <Card className="flex flex-col items-center justify-center gap-1 min-w-[140px]">
            <ScoreRing score={result.buyIntent.score} size={80} color="#E07A3A" />
            <div className="text-[12px] text-[#8A8A86]">购买意向指数</div>
          </Card>
          <Card>
            <div className="mb-3 text-[13px] font-semibold text-[#8A8A86]">高意向评论</div>
            <div className="flex flex-col gap-2">
              {result.buyIntent.comments.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.intent === "high" ? "bg-[#FDEEF3] text-[#E0608E]" : "bg-[#FBF3D6] text-[#C99A1E]"}`}>
                    {c.intent === "high" ? "高意向" : "中意向"}
                  </span>
                  <span className="text-[13.5px] text-[#1C1C1B]">{c.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      {/* ── M7 产品机会 ── */}
      <Section title="模块 07 · 产品机会分析">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.opportunities.map((o, i) => {
            const gc = GRADE_COLORS[o.grade];
            return (
              <Card key={i}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[#1C1C1B]">{o.name}</span>
                  <span className="rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: gc.bg, color: gc.text }}>
                    {o.grade} 级
                  </span>
                </div>
                <p className="text-[12.5px] leading-5 text-[#8A8A86]">{o.reason}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ── M8 反对意见 ── */}
      <Section title="模块 08 · 反对意见 + 回应策略">
        <div className="flex flex-col gap-3">
          {result.objections.map((o, i) => (
            <Card key={i}>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-[#FCEBEB] px-2.5 py-1 text-[12px] font-semibold text-[#A32D2D]">反对</span>
                <span className="text-[14px] font-semibold text-[#1C1C1B]">「{o.text}」</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-[#EAF3DE] px-2.5 py-1 text-[12px] font-semibold text-[#3B6D11]">回应</span>
                <p className="text-[13.5px] leading-6 text-[#8A8A86]">{o.response}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── M9+10 爆款选题 + 脚本 ── */}
      <Section title="模块 09+10 · 爆款选题 + 脚本方向">
        <div className="flex flex-col gap-3">
          {result.topics.map((t, i) => (
            <Card key={i}>
              <div className="mb-3 flex flex-wrap items-start gap-2">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EAF3DE] text-[11px] font-bold text-[#3B6D11]">{i + 1}</span>
                <span className="flex-1 text-[15px] font-semibold text-[#1C1C1B]">{t.title}</span>
                <div className="flex gap-2">
                  <span className="rounded-full bg-[#1E3A0F] px-2.5 py-1 text-[11px] font-bold text-[#7EC843]">爆款 {t.viralScore}</span>
                  <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11px] text-[#8A8A86]">难度 {t.difficulty}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-[10px] bg-[#F7F6F2] p-3 text-[12.5px] md:grid-cols-3">
                <div><span className="font-semibold text-[#E07A3A]">开头钩子 </span><span className="text-[#1C1C1B]">{t.hook}</span></div>
                <div><span className="font-semibold text-[#4A8FD6]">核心内容 </span><span className="text-[#1C1C1B]">{t.body}</span></div>
                <div><span className="font-semibold text-[#639922]">结尾转化 </span><span className="text-[#1C1C1B]">{t.cta}</span></div>
              </div>
              <div className="mt-2 text-[12px] text-[#8A8A86]">需求来源：{t.source}</div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── M11 评论回复 ── */}
      <Section title="模块 11 · 评论区回复助手">
        <div className="flex flex-col gap-3">
          {result.replies.map((r, i) => (
            <Card key={i}>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[12px] text-[#8A8A86]">用户评论</span>
                <span className="text-[14px] font-semibold text-[#1C1C1B]">{r.comment}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {[
                  { label: "专业版", color: "#4A8FD6", bg: "#DCEBFB", text: r.pro },
                  { label: "亲和版", color: "#3DA876", bg: "#DBF1E6", text: r.warm },
                  { label: "成交版", color: "#E0608E", bg: "#FBE2EC", text: r.sell },
                ].map(v => (
                  <div key={v.label} className="rounded-[10px] p-3" style={{ background: v.bg }}>
                    <div className="mb-1.5 text-[11px] font-bold" style={{ color: v.color }}>{v.label}</div>
                    <p className="text-[12.5px] leading-5 text-[#1C1C1B]">{v.text}</p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── M12 内容机会雷达 ── */}
      <Section title="模块 12 · 内容机会雷达">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
          <Card className="flex items-center justify-center">
            <RadarChart data={result.radar} />
          </Card>
          <div className="flex flex-col gap-3">
            {[
              { label: "最值得拍的 3 个视频", color: "#639922", bg: "#EAF3DE", items: result.opportunities_summary.bestVideos },
              { label: "最值得卖的产品", color: "#4A8FD6", bg: "#DCEBFB", items: [result.opportunities_summary.bestProduct] },
              { label: "最值得开的直播", color: "#E07A3A", bg: "#FBE5D6", items: [result.opportunities_summary.bestLive] },
              { label: "最值得做的资料包", color: "#C99A1E", bg: "#FBF3D6", items: [result.opportunities_summary.bestMaterial] },
            ].map(item => (
              <div key={item.label} className="rounded-[12px] p-4" style={{ background: item.bg }}>
                <div className="mb-2 text-[12px] font-bold" style={{ color: item.color }}>{item.label}</div>
                {item.items.map((t, i) => (
                  <div key={i} className="text-[13.5px] font-semibold text-[#1C1C1B]">
                    {item.items.length > 1 ? `${i + 1}. ` : ""}{t}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Section>

    </div>
  );
}
