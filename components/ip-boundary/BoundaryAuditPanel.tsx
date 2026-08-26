import type { BoundaryReport, MissingElement } from "@/lib/ip-boundary-engine";
import {
  decideBoundaryAction,
  type BoundaryEvidenceNode,
} from "@/lib/ip-boundary-ui";

export type BoundaryAuditStatus =
  | "idle"
  | "checking"
  | "ready"
  | "legacy"
  | "upgrade_required"
  | "stale"
  | "timeout"
  | "unavailable";

const MISSING_LABELS: Record<MissingElement, string> = {
  CLAIM: "缺少明确观点",
  REASONING: "缺少推理逻辑",
  CASE: "缺少具体案例",
  DATA: "缺少可靠数据",
  DETAIL: "缺少关键细节",
};

function readyPresentation(report: BoundaryReport) {
  if (report.stance === "CONFLICTING") {
    return { title: "立场冲突", tone: "border-[#F3C6C6] bg-[#FCEBEB]", text: "text-[#A32D2D]" };
  }
  if (report.coverage === "NONE") {
    return { title: "认知真空", tone: "border-[#D8D7D1] bg-[#F2F1ED]", text: "text-[#555]" };
  }
  if (report.coverage === "PARTIAL") {
    return { title: "认知部分覆盖", tone: "border-[#EBD89A] bg-[#FBF3D6]", text: "text-[#7A5C00]" };
  }
  if (report.stance === "UNDETERMINED") {
    return { title: "资料充分，未涉及明确立场", tone: "border-[#C9D9EE] bg-[#EEF5FD]", text: "text-[#315F91]" };
  }
  return { title: "认知充分匹配", tone: "border-[#CBE2B5] bg-[#EAF3DE]", text: "text-[#3B6D11]" };
}

export function BoundaryAuditPanel({
  status,
  report,
  evidenceNodes,
  message,
  onRetry,
  activeIPId,
}: {
  status: BoundaryAuditStatus;
  report: BoundaryReport | null;
  evidenceNodes: BoundaryEvidenceNode[];
  message?: string | null;
  onRetry?: () => void;
  activeIPId?: string | null;
}) {
  if (status === "idle") return null;
  const intakeHref = activeIPId?.trim()
    ? `/knowledge-intake/original?ipId=${encodeURIComponent(activeIPId.trim())}`
    : "/knowledge-intake/original";

  if (status === "checking") {
    return (
      <section aria-label="认知边界审计" className="min-h-[180px] break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[16px] border border-[#E5E4DE] bg-white p-5">
        <div className="text-[14px] font-bold text-[#1C1C1B]">正在核对IP认知边界…</div>
        <p className="mt-1 text-[12.5px] text-[#8A8A86]">审计完成前暂不开放脚本生成。</p>
        <div className="mt-5 animate-pulse space-y-3" aria-hidden="true">
          <div className="h-3 w-2/3 rounded-full bg-[#E8E7E2]" />
          <div className="h-3 w-full rounded-full bg-[#EFEDE8]" />
          <div className="h-12 w-full rounded-[10px] bg-[#F3F2EE]" />
        </div>
      </section>
    );
  }

  if (status === "legacy") {
    return (
      <section aria-label="认知边界审计" className="break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[16px] border border-[#EBD89A] bg-[#FBF3D6] p-5">
        <div className="text-[14px] font-bold text-[#7A5C00]">历史认知已登记，暂不支持节点级审计</div>
        <p className="mt-1 text-[12.5px] leading-5 text-[#6B5A1A]">仍可沿用原有生成流程；建议升级为V2认知后再使用精确边界判断。</p>
      </section>
    );
  }

  if (status === "timeout" || status === "stale") {
    return (
      <section aria-label="认知边界审计" className="break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[16px] border border-[#EBD89A] bg-[#FBF3D6] p-5">
        <div className="text-[14px] font-bold text-[#7A5C00]">{status === "timeout" ? "审计响应超时" : "选题内容已变更，请重新审计"}</div>
        <p className="mt-1 text-[12.5px] leading-5 text-[#6B5A1A]">{message ?? (status === "timeout" ? "本次没有在15秒内获得可信结论，生成入口继续保持锁定。" : "旧审计结论已失效，重新审计前不会开放生成入口。")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-bold text-white">
            重新审计
          </button>
        )}
      </section>
    );
  }

  if (status === "upgrade_required" || status === "unavailable" || !report) {
    return (
      <section aria-label="认知边界审计" className="break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[16px] border border-[#D8D7D1] bg-[#F2F1ED] p-5">
        <div className="text-[14px] font-bold text-[#555]">
          {status === "upgrade_required" ? "请先升级认知库" : "认知边界审计暂不可用"}
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-[#666]">{message ?? "本次没有获得可信的边界结论，已保持生成入口锁定。"}</p>
        <a href={intakeHref} className="mt-3 inline-flex rounded-full bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-bold text-white">导入资料</a>
      </section>
    );
  }

  const presentation = readyPresentation(report);
  const action = decideBoundaryAction(report);
  const trustedEvidence = evidenceNodes.filter(node => node.verificationStatus === "human_confirmed");

  return (
    <section aria-label="认知边界审计" className={`break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[16px] border p-5 ${presentation.tone}`}>
      <div className={`text-[15px] font-bold ${presentation.text}`}>{presentation.title}</div>
      <p className="mt-2 text-[13px] leading-6 text-[#444]">{report.explanation}</p>

      {report.missingElements.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="缺失要素">
          {report.missingElements.map(item => (
            <span key={item} className="rounded-full border border-[#D9C987] bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-[#7A5C00]">
              {MISSING_LABELS[item]}
            </span>
          ))}
        </div>
      )}

      {trustedEvidence.length > 0 && (
        <div className="mt-4 space-y-2" aria-label="认知证据">
          {trustedEvidence.map(node => (
            <article key={`${node.relation}-${node.nodeId}`} className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word] rounded-[12px] bg-white/80 p-3">
              <div className="text-[11px] font-bold text-[#8A8A86]">人工已确认 · {node.relation === "conflicting" ? "冲突依据" : "支撑依据"}</div>
              <div className="mt-1 text-[13px] font-semibold text-[#1C1C1B]">{node.claim}</div>
              {node.reasoningSteps.map((step, index) => (
                <p key={`${node.nodeId}-${index}`} className="mt-1 text-[12px] leading-5 text-[#555]">{index + 1}. {step}</p>
              ))}
            </article>
          ))}
        </div>
      )}

      {action === "intercept" && report.coverage === "NONE" && (
        <a href={intakeHref} className="mt-4 inline-flex rounded-full bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-bold text-white">导入资料</a>
      )}
    </section>
  );
}
