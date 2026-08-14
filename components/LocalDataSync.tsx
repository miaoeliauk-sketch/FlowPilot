"use client";

import { useEffect, useRef } from "react";
import {
  isLocalSyncKey,
  LOCAL_SYNC_KEYS,
} from "@/lib/local-sync-contract";

const LAST_SYNC_RELOAD_KEY = "flowpilot:lastSyncReloadAt";
const LAST_SUCCESSFUL_SNAPSHOT_KEY = "flowpilot:lastSuccessfulLocalSyncSnapshot:v1";

type SyncAttemptResult = "success" | "retryable" | "blocked";

function collectLocalData() {
  const data: Record<string, string> = {};
  for (const key of LOCAL_SYNC_KEYS) {
    const value = localStorage.getItem(key);
    if (value != null && value !== "" && value !== "[]" && value !== "{}") {
      data[key] = value;
    }
  }
  return data;
}

function countUsefulKeys(data: Record<string, string>) {
  return Object.values(data).filter(value => value && value !== "[]" && value !== "{}").length;
}

function snapshotsMatch(
  localData: Record<string, string>,
  serverData: Record<string, string>,
) {
  return LOCAL_SYNC_KEYS.every(key => localData[key] === serverData[key]);
}

function snapshotFingerprint(data: Record<string, string>) {
  const serialized = JSON.stringify(data);
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${serialized.length}:${(hash >>> 0).toString(16)}`;
}

function localSnapshotFingerprint() {
  return snapshotFingerprint(collectLocalData());
}

function isEmptyValue(value: string | null) {
  return !value || value === "[]" || value === "{}" || value === "null";
}

function getItemIdentity(item: unknown) {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  return String(record.id ?? record.name ?? record.title ?? record.hookText ?? record.localId ?? JSON.stringify(record));
}

function mergeSyncValue(key: string, localValue: string | null, serverValue: string) {
  if (key === "ipwr:activeIpId") return isEmptyValue(localValue) ? serverValue : localValue;
  if (isEmptyValue(localValue)) return serverValue;
  try {
    const localParsed = JSON.parse(localValue || "");
    const serverParsed = JSON.parse(serverValue);
    if (Array.isArray(localParsed) && Array.isArray(serverParsed)) {
      const merged = [...localParsed];
      const seen = new Set(merged.map(getItemIdentity));
      for (const item of serverParsed) {
        const id = getItemIdentity(item);
        if (!seen.has(id)) {
          merged.push(item);
          seen.add(id);
        }
      }
      return JSON.stringify(merged);
    }
  } catch {
    // 不是 JSON 数组时，保留本地已有值。
  }
  return localValue || serverValue;
}

export function LocalDataSync() {
  const pushingRef = useRef(false);
  const pendingPushRef = useRef(false);
  const lastLocalSnapshotRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const retryAfterRef = useRef(0);
  const blockedSnapshotRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let initialPullComplete = false;
    let pullRetryTimer: number | null = null;
    const abortController = new AbortController();
    const initialLocalFingerprint = localSnapshotFingerprint();

    async function pushNow(): Promise<SyncAttemptResult> {
      if (pushingRef.current) {
        pendingPushRef.current = true;
        return "retryable";
      }
      pushingRef.current = true;
      try {
        do {
          pendingPushRef.current = false;
          const snapshot = collectLocalData();
          const fingerprint = snapshotFingerprint(snapshot);
          const response = await fetch("/api/local-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: snapshot }),
            signal: abortController.signal,
          });
          if (cancelled) return "blocked";
          if (!response.ok) {
            window.dispatchEvent(new Event("flowpilot-local-sync-error"));
            if ([400, 409, 413].includes(response.status)) {
              blockedSnapshotRef.current = fingerprint;
              return "blocked";
            } else {
              retryAfterRef.current = Date.now() + 1_000;
              return "retryable";
            }
          }
          localStorage.setItem(LAST_SUCCESSFUL_SNAPSHOT_KEY, fingerprint);
          blockedSnapshotRef.current = "";
          retryAfterRef.current = 0;
        } while (!cancelled && pendingPushRef.current);
        return "success";
      } catch {
        if (!cancelled) {
          retryAfterRef.current = Date.now() + 1_000;
          window.dispatchEvent(new Event("flowpilot-local-sync-error"));
        }
        return cancelled ? "blocked" : "retryable";
      } finally {
        pushingRef.current = false;
      }
    }

    function schedulePush() {
      if (timerRef.current !== null || cancelled) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void pushNow();
      }, 500);
    }

    async function pullAndMerge(): Promise<SyncAttemptResult> {
      try {
        const res = await fetch("/api/local-sync", {
          cache: "no-store",
          signal: abortController.signal,
        });
        if (cancelled) return "blocked";
        if (!res.ok) {
          window.dispatchEvent(new Event("flowpilot-local-sync-error"));
          if ([400, 409, 413].includes(res.status)) {
            blockedSnapshotRef.current = localSnapshotFingerprint();
            return "blocked";
          }
          return "retryable";
        }
        const server = await res.json();
        if (cancelled) return "blocked";
        const serverData: Record<string, string> = server?.data ?? {};
        const localData = collectLocalData();
        const serverUseful = countUsefulKeys(serverData);
        const localUseful = countUsefulKeys(localData);
        const localFingerprint = snapshotFingerprint(localData);
        const lastSuccessfulFingerprint = localStorage.getItem(LAST_SUCCESSFUL_SNAPSHOT_KEY);

        if (
          !lastSuccessfulFingerprint
          && localFingerprint !== initialLocalFingerprint
        ) {
          return pushNow();
        }

        if (serverUseful === 0 && localUseful > 0) {
          return pushNow();
        }

        if (
          lastSuccessfulFingerprint
          && lastSuccessfulFingerprint !== localFingerprint
        ) {
          return pushNow();
        }

        if (lastSuccessfulFingerprint === localFingerprint) {
          let changed = false;
          for (const key of LOCAL_SYNC_KEYS) {
            const serverValue = serverData[key];
            const localValue = localStorage.getItem(key);
            if (serverValue === undefined) {
              if (localValue !== null) {
                localStorage.removeItem(key);
                changed = true;
              }
            } else if (localValue !== serverValue) {
              localStorage.setItem(key, serverValue);
              changed = true;
            }
          }
          localStorage.setItem(
            LAST_SUCCESSFUL_SNAPSHOT_KEY,
            localSnapshotFingerprint(),
          );
          if (changed) {
            window.dispatchEvent(new Event("flowpilot-local-sync"));
            const reloadMarker = server?.updatedAt || "local-sync";
            if (sessionStorage.getItem(LAST_SYNC_RELOAD_KEY) !== reloadMarker) {
              sessionStorage.setItem(LAST_SYNC_RELOAD_KEY, reloadMarker);
              window.location.reload();
            }
          }
          return "success";
        }

        let changed = false;
        for (const key of LOCAL_SYNC_KEYS) {
          const serverValue = serverData[key];
          if (!serverValue) continue;
          const localValue = localStorage.getItem(key);
          const nextValue = mergeSyncValue(key, localValue, serverValue);
          if (nextValue && localValue !== nextValue) {
            // 服务端下发的数据只写入浏览器，不触发反向推送，避免尚未合并完就覆盖服务端完整数据。
            localStorage.setItem(key, nextValue);
            changed = true;
          }
        }

        const mergedLocalData = collectLocalData();
        const shouldPushMergedData = !snapshotsMatch(mergedLocalData, serverData);
        if (shouldPushMergedData) {
          const pushed = await pushNow();
          if (pushed !== "success" || cancelled) return pushed;
        } else {
          localStorage.setItem(
            LAST_SUCCESSFUL_SNAPSHOT_KEY,
            snapshotFingerprint(mergedLocalData),
          );
        }
        if (changed) {
          window.dispatchEvent(new Event("flowpilot-local-sync"));
          const reloadMarker = server?.updatedAt || "local-sync";
          if (sessionStorage.getItem(LAST_SYNC_RELOAD_KEY) !== reloadMarker) {
            sessionStorage.setItem(LAST_SYNC_RELOAD_KEY, reloadMarker);
            window.location.reload();
          }
        }
        return "success";
      } catch {
        return cancelled ? "blocked" : "retryable";
      }
    }

    async function initializeFromServer() {
      const result = await pullAndMerge();
      if (cancelled) return;
      if (result === "retryable") {
        pullRetryTimer = window.setTimeout(initializeFromServer, 1_000);
        return;
      }
      lastLocalSnapshotRef.current = localSnapshotFingerprint();
      initialPullComplete = true;
    }

    void initializeFromServer();

    function detectLocalChange() {
      if (!initialPullComplete) return;
      const fingerprint = localSnapshotFingerprint();
      const lastSuccessful = localStorage.getItem(LAST_SUCCESSFUL_SNAPSHOT_KEY);
      const hasUnsyncedChanges = fingerprint !== lastSuccessful;
      if (!hasUnsyncedChanges || blockedSnapshotRef.current === fingerprint) return;
      if (Date.now() < retryAfterRef.current) return;
      if (fingerprint === lastLocalSnapshotRef.current && timerRef.current !== null) return;
      lastLocalSnapshotRef.current = fingerprint;
      schedulePush();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key && !isLocalSyncKey(event.key)) return;
      detectLocalChange();
    }

    const pollTimer = window.setInterval(detectLocalChange, 500);
    window.addEventListener("storage", handleStorage);

    return () => {
      cancelled = true;
      abortController.abort();
      window.clearInterval(pollTimer);
      window.removeEventListener("storage", handleStorage);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (pullRetryTimer !== null) window.clearTimeout(pullRetryTimer);
    };
  }, []);

  return null;
}
