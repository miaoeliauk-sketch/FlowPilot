"use client";

import { useEffect, useState } from "react";

const ACKNOWLEDGEMENT = "我已逐字核对并确认启用";

interface Proposal {
  proposalId: string;
  ruleId: string;
  title: string;
  canonicalText: string;
  prohibitedIntent: string;
  allowedBoundaries: string[];
}

interface StatusResponse {
  proposal: Proposal;
  active: boolean;
  rule: { ruleId: string; status: string; canonicalText: string } | null;
  sourceFacts: {
    sourceType: "user_confirmed";
    confirmedBy: string;
    intakeChannel: "manual_confirmation_ui";
    sourceYear: number;
    sourceDate: null;
    dateStatus: "pending_exact_date";
  } | null;
}

export function GlobalConstraintConfirmationPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readStatus(): Promise<StatusResponse> {
    const response = await fetch("/api/global-content-constraint");
    const body = await response.json() as StatusResponse & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "服务端规则状态读取失败");
    return body;
  }

  useEffect(() => {
    let cancelled = false;
    void readStatus()
      .then(body => { if (!cancelled) setStatus(body); })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "服务端规则状态读取失败");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="通用禁用规则人工确认"
        className="h-full w-full max-w-[680px] overflow-y-auto bg-[#FAFAF7] p-5 shadow-2xl md:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] text-[#8A8A86]">独立治理记录 · 不改写旧方法卡</p>
            <h2 className="mt-1 text-[21px] font-semibold text-[#1C1C1B]">待确认V2强制底线</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E4DE] bg-white px-3 py-1.5 text-[12px] text-[#555]">关闭</button>
        </div>

        {loading ? (
          <p className="mt-5 text-[12px] text-[#866A36]">正在读取服务端待确认规则…</p>
        ) : error || !status ? (
          <p role="alert" className="mt-5 rounded-[12px] border border-[#F2B8B5] bg-[#FCEBEB] px-4 py-3 text-[12px] text-[#A32D2D]">
            无法读取服务端待确认规则，当前不能启用。{error ? ` ${error}` : ""}
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <section className="rounded-[14px] border border-[#E8D7B7] bg-[#FFF9ED] p-4">
              <h3 className="text-[16px] font-semibold text-[#6B5122]">{status.proposal.title}</h3>
              <p className="mt-2 text-[12px] leading-5 text-[#866A36]">
                规则全文由服务端固定，浏览器不能修改。确认后作用于所有IP的脚本生成。
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#866A36]">
                当前方案可防误操作、重复请求和本地伪造，但不能证明点击者一定是彭彭本人。
              </p>
            </section>

            <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
              <h3 className="text-[14px] font-semibold text-[#1C1C1B]">用户确认原文</h3>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-6 text-[#333]">{status.proposal.canonicalText}</pre>
              <div className="mt-3 border-t border-[#F0EFE9] pt-3 text-[12px] leading-5 text-[#666]">
                <p>禁止的表达动机：{status.proposal.prohibitedIntent}</p>
                <p>允许边界：{status.proposal.allowedBoundaries.join("、")}</p>
                <p>作用范围：所有IP的脚本生成</p>
              </div>
            </section>

            {status.active ? (
              <section className="rounded-[14px] border border-[#C8DDB3] bg-[#EAF3DE] p-4 text-[12px] leading-5 text-[#3B6D11]">
                <p className="font-semibold">服务端已严格回读：这条规则现已对所有IP生效</p>
                <p className="mt-1">来源类型：用户亲自确认</p>
                <p>确认人：{status.sourceFacts?.confirmedBy ?? "未记录"}</p>
                <p>来源时间：{status.sourceFacts?.sourceYear ?? "未记录"}年（具体日期待补）</p>
                <p>录入渠道：人工确认入口</p>
              </section>
            ) : (
              <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
                <label className="flex items-start gap-2 text-[12px] leading-5 text-[#555]">
                  <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} className="mt-1" />
                  我已逐字核对服务端固定的规则全文，并确认启用为所有IP共同遵守的强制底线
                </label>
                {error && <p role="alert" className="mt-2 text-[12px] text-[#A32D2D]">{error}</p>}
                <button
                  type="button"
                  disabled={confirming || !checked}
                  onClick={async () => {
                    setConfirming(true);
                    setError(null);
                    try {
                      const challengeResponse = await fetch("/api/global-content-constraint/challenge", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ proposalId: status.proposal.proposalId }),
                      });
                      const challenge = await challengeResponse.json() as { challengeId?: string; challenge?: string; error?: string };
                      if (!challengeResponse.ok || !challenge.challengeId || !challenge.challenge) {
                        throw new Error(challenge.error ?? "一次性确认凭证申请失败");
                      }
                      const confirmResponse = await fetch("/api/global-content-constraint/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          proposalId: status.proposal.proposalId,
                          challengeId: challenge.challengeId,
                          challenge: challenge.challenge,
                          idempotencyKey: crypto.randomUUID(),
                          confirmedBy: "彭彭",
                          acknowledgement: ACKNOWLEDGEMENT,
                        }),
                      });
                      const confirmed = await confirmResponse.json() as { error?: string };
                      if (!confirmResponse.ok) throw new Error(confirmed.error ?? "人工确认失败");
                      const readback = await readStatus();
                      if (!readback.active
                        || readback.rule?.ruleId !== status.proposal.ruleId
                        || readback.rule.canonicalText !== status.proposal.canonicalText) {
                        throw new Error("服务端确认后严格回读失败，页面未宣告启用");
                      }
                      setStatus(readback);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "人工确认失败，请稍后重试");
                    } finally {
                      setConfirming(false);
                    }
                  }}
                  className="mt-3 rounded-[9px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {confirming ? "正在服务端确认并回读…" : "确认并启用为所有IP强制底线"}
                </button>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
