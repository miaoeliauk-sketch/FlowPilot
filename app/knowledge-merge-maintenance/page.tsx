"use client";

import { useState } from "react";
import {
  getActiveIPId,
  mergeLegacyKnowledgeGroupStrict,
  prepareLegacyKnowledgeMergeGroup,
  type LegacyKnowledgeMergePreparation,
} from "@/lib/ip-store";

interface LockedMergeGroup {
  preparation: LegacyKnowledgeMergePreparation;
  backupContentSha256: string;
  mergedRawContent: string;
}

export default function KnowledgeMergeMaintenancePage() {
  const [groupId, setGroupId] = useState("");
  const [survivorId, setSurvivorId] = useState("");
  const [sourceIdsText, setSourceIdsText] = useState("");
  const [backupContentSha256, setBackupContentSha256] = useState("");
  const [mergedRawContent, setMergedRawContent] = useState("");
  const [locked, setLocked] = useState<LockedMergeGroup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function invalidateLock(): void {
    setLocked(null);
    setConfirmed(false);
    setNotice("");
    setError("");
  }

  function changeValue(setter: (value: string) => void, value: string): void {
    setter(value);
    invalidateLock();
  }

  function parseSourceIds(): string[] {
    return sourceIdsText
      .split(/[\s,，]+/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  function handlePrepare(): void {
    setError("");
    setNotice("");
    try {
      if (!/^[a-f0-9]{64}$/.test(backupContentSha256)) {
        throw new Error("完整备份SHA-256无效，已停止锁定");
      }
      if (!mergedRawContent.trim()) {
        throw new Error("请先填写人工合并后的完整正文");
      }
      const preparation = prepareLegacyKnowledgeMergeGroup({
        groupId,
        activeIPId: getActiveIPId(),
        survivorId,
        sourceIds: parseSourceIds(),
      });
      setLocked({ preparation, backupContentSha256, mergedRawContent });
      setConfirmed(false);
      setNotice(`已锁定${preparation.groupId}，尚未修改任何知识`);
    } catch (prepareError) {
      setLocked(null);
      setConfirmed(false);
      setError(prepareError instanceof Error ? prepareError.message : "锁定失败，请重新核对");
    }
  }

  async function handleMerge(): Promise<void> {
    if (!locked || !confirmed || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mergeLegacyKnowledgeGroupStrict({
        groupId: locked.preparation.groupId,
        backupContentSha256: locked.backupContentSha256,
        activeIPId: locked.preparation.activeIPId,
        survivor: locked.preparation.survivor,
        sources: locked.preparation.sources,
        mergedContent: { rawContent: locked.mergedRawContent },
      });
      setLocked(null);
      setConfirmed(false);
      setNotice(
        `${result.auditRecord.groupId}处理完成：保留“${result.survivor.title}”，删除${result.removedEntries.length}条旧知识`,
      );
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "合并失败，请立即核对原数据");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 text-[#1C1C1B]">
      <header className="mb-6">
        <p className="text-sm text-[#8A8A86]">受控维护工具</p>
        <h1 className="text-2xl font-semibold">旧知识严格合并</h1>
        <p className="mt-2 text-sm leading-6 text-[#686864]">
          一次只处理一个人工确认组。先载入并锁定原始快照，再二次确认执行；失败时会尝试严格恢复。
        </p>
      </header>

      <section className="grid gap-4 rounded-2xl border border-[#E5E4DE] bg-white p-5">
        <label className="grid gap-1 text-sm">
          <span>复核组编号</span>
          <input aria-label="复核组编号" value={groupId}
            onChange={event => changeValue(setGroupId, event.target.value)} className="rounded-lg border p-2" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>保留项编号</span>
          <input aria-label="保留项编号" value={survivorId}
            onChange={event => changeValue(setSurvivorId, event.target.value)} className="rounded-lg border p-2" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>被合并项编号</span>
          <input aria-label="被合并项编号" value={sourceIdsText}
            onChange={event => changeValue(setSourceIdsText, event.target.value)} className="rounded-lg border p-2"
            placeholder="同组多条编号可用逗号分隔" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>完整备份SHA-256</span>
          <input aria-label="完整备份SHA-256" value={backupContentSha256}
            onChange={event => changeValue(setBackupContentSha256, event.target.value)} className="rounded-lg border p-2" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>人工合并后的完整正文</span>
          <textarea aria-label="人工合并后的完整正文" value={mergedRawContent}
            onChange={event => changeValue(setMergedRawContent, event.target.value)} className="min-h-48 rounded-lg border p-3" />
        </label>
        <button type="button" onClick={handlePrepare} disabled={busy}
          className="rounded-xl bg-[#1C1C1B] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
          载入并锁定本组
        </button>
      </section>

      {locked && (
        <section className="mt-5 rounded-2xl border border-[#D6D4CB] bg-[#F7F6F2] p-5">
          <h2 className="font-semibold">{locked.preparation.groupId}锁定快照</h2>
          <div className="mt-3 rounded-xl bg-white p-4">
            <p className="text-xs text-[#8A8A86]">保留</p>
            <strong>{locked.preparation.survivor.title}</strong>
            <p className="mt-1 break-all text-xs text-[#686864]">{locked.preparation.survivor.id}</p>
            <p className="mt-2 text-sm">分类：{locked.preparation.survivor.category}</p>
            <p className="mt-1 text-sm">
              来源：{locked.preparation.survivor.sourceName || "未记录来源名称"} · {locked.preparation.survivor.sourcePlatform || "未记录来源平台"}
            </p>
            <details className="mt-3 rounded-lg border border-[#E5E4DE] p-3" open>
              <summary className="cursor-pointer text-sm font-medium">展开核对锁定原文</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{locked.preparation.survivor.rawContent}</pre>
            </details>
          </div>
          {locked.preparation.sources.map(source => (
            <div key={source.id} className="mt-3 rounded-xl bg-white p-4">
              <p className="text-xs text-[#8A8A86]">删除并保留完整恢复记录</p>
              <strong>{source.title}</strong>
              <p className="mt-1 break-all text-xs text-[#686864]">{source.id}</p>
              <p className="mt-2 text-sm">分类：{source.category}</p>
              <p className="mt-1 text-sm">
                来源：{source.sourceName || "未记录来源名称"} · {source.sourcePlatform || "未记录来源平台"}
              </p>
              <details className="mt-3 rounded-lg border border-[#E5E4DE] p-3" open>
                <summary className="cursor-pointer text-sm font-medium">展开核对锁定原文</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{source.rawContent}</pre>
              </details>
            </div>
          ))}
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span>我已核对本组内容并确认只处理这一组</span>
          </label>
          <button type="button" onClick={handleMerge} disabled={!confirmed || busy}
            className="mt-4 rounded-xl bg-[#9F2D22] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? "处理中…" : `确认执行${locked.preparation.groupId}`}
          </button>
        </section>
      )}

      {notice && <p role="status" className="mt-4 rounded-xl bg-[#EAF3DE] p-3 text-sm text-[#3B6D11]">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-[#FBE9E7] p-3 text-sm text-[#9F2D22]">{error}</p>}
    </main>
  );
}
