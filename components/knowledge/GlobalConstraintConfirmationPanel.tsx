"use client";

import { useEffect, useMemo, useState } from "react";

interface Proposal {
  proposalId: string;
  ruleId: string;
  title: string;
  canonicalText: string;
  prohibitedIntent: string;
  traceabilityStandards: string[];
  applicableScopes: string[];
  priorityRedlines: string[];
  prohibitedScenarios: string[];
  allowedBoundaries: string[];
  runtimePositioning: string;
  detectionTerms: string[] | null;
  activationMode: "active_on_confirmation" | "confirmed_pending_detection";
  confirmationAcknowledgement: string;
}

type ConfirmationStatus = "pending_confirmation" | "confirmed_pending_detection" | "active";

interface ProposalStatus {
  proposal: Proposal;
  confirmationStatus: ConfirmationStatus;
  runtimeStatus: "detection_pending" | "active";
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

interface ProposalsResponse {
  proposals: ProposalStatus[];
}

const STATUS_LABELS: Record<ConfirmationStatus, string> = {
  pending_confirmation: "待确认",
  confirmed_pending_detection: "内容已确认，待配置检测范围",
  active: "已启用",
};

export function GlobalConstraintConfirmationPanel({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<ProposalStatus[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function readStatuses(): Promise<ProposalStatus[]> {
    const response = await fetch("/api/global-content-constraint/proposals");
    const body = await response.json() as ProposalsResponse & { error?: string };
    if (!response.ok || !Array.isArray(body.proposals)) {
      throw new Error(body.error ?? "服务端规则提案读取失败");
    }
    return body.proposals;
  }

  function applyStatuses(next: ProposalStatus[]) {
    setStatuses(next);
    setSelectedProposalId(current => {
      if (current && next.some(item => item.proposal.proposalId === current)) return current;
      return next.find(item => item.confirmationStatus === "pending_confirmation")?.proposal.proposalId
        ?? next[0]?.proposal.proposalId
        ?? null;
    });
  }

  useEffect(() => {
    let cancelled = false;
    void readStatuses()
      .then(body => { if (!cancelled) applyStatuses(body); })
      .catch(cause => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "服务端规则提案读取失败");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(
    () => statuses.find(item => item.proposal.proposalId === selectedProposalId) ?? null,
    [selectedProposalId, statuses],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="通用禁用规则人工确认"
        className="h-full w-full max-w-[760px] overflow-y-auto bg-[#FAFAF7] p-5 shadow-2xl md:p-7"
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
        ) : loadError || !selected ? (
          <p role="alert" className="mt-5 rounded-[12px] border border-[#F2B8B5] bg-[#FCEBEB] px-4 py-3 text-[12px] text-[#A32D2D]">
            无法读取服务端待确认规则，当前不能启用。{loadError ? ` ${loadError}` : ""}
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <section aria-label="通用底线规则列表" className="grid gap-2 sm:grid-cols-2">
              {statuses.map(item => {
                const isSelected = item.proposal.proposalId === selected.proposal.proposalId;
                return (
                  <button
                    key={item.proposal.proposalId}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${item.proposal.title} ${STATUS_LABELS[item.confirmationStatus]}`}
                    onClick={() => {
                      setSelectedProposalId(item.proposal.proposalId);
                      setChecked(false);
                      setActionError(null);
                    }}
                    className={`rounded-[12px] border px-3 py-3 text-left ${isSelected ? "border-[#8A6A32] bg-[#FFF9ED]" : "border-[#E5E4DE] bg-white"}`}
                  >
                    <span className="block text-[13px] font-semibold text-[#1C1C1B]">{item.proposal.title}</span>
                    <span className="mt-1 block text-[11px] text-[#777]">{STATUS_LABELS[item.confirmationStatus]}</span>
                  </button>
                );
              })}
            </section>

            <section className="rounded-[14px] border border-[#E8D7B7] bg-[#FFF9ED] p-4">
              <h3 className="text-[16px] font-semibold text-[#6B5122]">{selected.proposal.title}</h3>
              <p className="mt-2 text-[12px] leading-5 text-[#866A36]">
                规则全文由服务端固定，浏览器不能修改。每条规则必须独立核对和确认。
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#866A36]">
                当前方案可防误操作、重复请求和本地伪造，但不能证明点击者一定是彭彭本人。
              </p>
            </section>

            <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
              <h3 className="text-[14px] font-semibold text-[#1C1C1B]">服务端固定规则全文</h3>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-6 text-[#333]">{selected.proposal.canonicalText}</pre>
              <div className="mt-3 border-t border-[#F0EFE9] pt-3 text-[12px] leading-5 text-[#666]">
                <p>规则定位：{selected.proposal.runtimePositioning}</p>
                <p>禁止的行为：{selected.proposal.prohibitedIntent}</p>
                <p>作用范围：{selected.proposal.applicableScopes.join("、")}</p>
              </div>
            </section>

            {selected.proposal.detectionTerms === null && (
              <section className="rounded-[14px] border border-[#E8D7B7] bg-[#FFF9ED] p-4 text-[12px] leading-5 text-[#6B5122]">
                <p className="font-semibold">检测词和召回范围尚未配置</p>
                <p className="mt-1">本次只确认规则内容。系统不会宣称已经具备该规则的自动检测能力，也不会在检测范围确定前将它作为运行时拦截规则。</p>
              </section>
            )}

            {selected.confirmationStatus === "active" ? (
              <section className="rounded-[14px] border border-[#C8DDB3] bg-[#EAF3DE] p-4 text-[12px] leading-5 text-[#3B6D11]">
                <p className="font-semibold">服务端已严格回读：这条规则现已对所有IP生效</p>
                <p className="mt-1">来源类型：用户亲自确认</p>
                <p>确认人：{selected.sourceFacts?.confirmedBy ?? "未记录"}</p>
                <p>来源时间：{selected.sourceFacts?.sourceYear ?? "未记录"}年（具体日期待补）</p>
                <p>录入渠道：人工确认入口</p>
              </section>
            ) : selected.confirmationStatus === "confirmed_pending_detection" ? (
              <section className="rounded-[14px] border border-[#C8DDB3] bg-[#EAF3DE] p-4 text-[12px] leading-5 text-[#3B6D11]">
                <p className="font-semibold">规则内容已确认，检测范围待配置</p>
                <p className="mt-1">服务端已保存独立确认记录，但当前尚未进入运行时拦截。</p>
              </section>
            ) : (
              <section className="rounded-[14px] border border-[#E5E4DE] bg-white p-4">
                <label className="flex items-start gap-2 text-[12px] leading-5 text-[#555]">
                  <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} className="mt-1" />
                  我已逐字核对服务端固定的规则全文，并确认按页面说明登记这条所有IP共同遵守的底线
                </label>
                {actionError && <p role="alert" className="mt-2 text-[12px] text-[#A32D2D]">{actionError}</p>}
                <button
                  type="button"
                  disabled={confirming || !checked}
                  onClick={async () => {
                    setConfirming(true);
                    setActionError(null);
                    try {
                      const challengeResponse = await fetch("/api/global-content-constraint/challenge", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ proposalId: selected.proposal.proposalId }),
                      });
                      const challenge = await challengeResponse.json() as { challengeId?: string; challenge?: string; error?: string };
                      if (!challengeResponse.ok || !challenge.challengeId || !challenge.challenge) {
                        throw new Error(challenge.error ?? "一次性确认凭证申请失败");
                      }
                      const confirmResponse = await fetch("/api/global-content-constraint/confirm", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          proposalId: selected.proposal.proposalId,
                          challengeId: challenge.challengeId,
                          challenge: challenge.challenge,
                          idempotencyKey: crypto.randomUUID(),
                          confirmedBy: "彭彭",
                          acknowledgement: selected.proposal.confirmationAcknowledgement,
                        }),
                      });
                      const confirmed = await confirmResponse.json() as { error?: string };
                      if (!confirmResponse.ok) throw new Error(confirmed.error ?? "人工确认失败");
                      const readback = await readStatuses();
                      const verified = readback.find(item => item.proposal.proposalId === selected.proposal.proposalId);
                      const isVerified = selected.proposal.activationMode === "active_on_confirmation"
                        ? verified?.confirmationStatus === "active"
                          && verified.rule?.ruleId === selected.proposal.ruleId
                          && verified.rule.canonicalText === selected.proposal.canonicalText
                        : verified?.confirmationStatus === "confirmed_pending_detection"
                          && verified.runtimeStatus === "detection_pending"
                          && verified.rule === null;
                      if (!isVerified) throw new Error("服务端确认后严格回读失败，页面未宣告确认完成");
                      applyStatuses(readback);
                      setChecked(false);
                    } catch (cause) {
                      setActionError(cause instanceof Error ? cause.message : "人工确认失败，请稍后重试");
                    } finally {
                      setConfirming(false);
                    }
                  }}
                  className="mt-3 rounded-[9px] bg-[#1C1C1B] px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {confirming
                    ? "正在服务端确认并回读…"
                    : selected.proposal.activationMode === "active_on_confirmation"
                      ? "确认并启用为所有IP强制底线"
                      : "确认规则内容并登记"}
                </button>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
