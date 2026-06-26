"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { IPProfile } from "./types";
import * as ipStore from "./ip-store";

interface IPContextValue {
  ips: IPProfile[];
  activeIP: IPProfile | null;
  loading: boolean;
  switchIP: (id: string) => void;
  createIP: (input: Omit<IPProfile, "id" | "createdAt" | "updatedAt" | "color">) => IPProfile;
  updateIP: (id: string, patch: Partial<IPProfile>) => void;
  deleteIP: (id: string) => void;
  refresh: () => void;
}

const IPContext = createContext<IPContextValue | null>(null);

export function IPProvider({ children }: { children: ReactNode }) {
  const [ips, setIps] = useState<IPProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const all = ipStore.getAllIPs();
    setIps(all);
    const active = ipStore.getOrInitActiveIP();
    setActiveId(active.id);
  }, []);

  useEffect(() => {
    // VoiceSample → IP语料库 一次性数据迁移，幂等，用户无感知
    ipStore.migrateVoiceSamplesToKnowledge();
    refresh();
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchIP = useCallback((id: string) => {
    ipStore.setActiveIPId(id);
    setActiveId(id);
  }, []);

  const createIP = useCallback((input: Omit<IPProfile, "id" | "createdAt" | "updatedAt" | "color">) => {
    const created = ipStore.createIP(input);
    refresh();
    switchIP(created.id);
    return created;
  }, [refresh, switchIP]);

  const updateIP = useCallback((id: string, patch: Partial<IPProfile>) => {
    ipStore.updateIP(id, patch);
    refresh();
  }, [refresh]);

  const deleteIP = useCallback((id: string) => {
    ipStore.deleteIP(id);
    refresh();
  }, [refresh]);

  const activeIP = ips.find((ip) => ip.id === activeId) ?? null;

  return (
    <IPContext.Provider value={{ ips, activeIP, loading, switchIP, createIP, updateIP, deleteIP, refresh }}>
      {children}
    </IPContext.Provider>
  );
}

export function useIP() {
  const ctx = useContext(IPContext);
  if (!ctx) throw new Error("useIP 必须在 IPProvider 内部使用");
  return ctx;
}
