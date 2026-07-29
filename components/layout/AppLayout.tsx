"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useIP } from "@/lib/ip-context";
import { getIPDisplayLabel } from "@/lib/ip-display";
import { getUserProfile, setUserProfile, getOperatorDisplayName } from "@/lib/ip-store";
import { UserProfile } from "@/lib/types";
import { Icon, IconName } from "@/components/ui/icon";

const MAIN_NAV: { label: string; href: string; icon: IconName }[] = [
  { label: "工作台", href: "/", icon: "grid" },
  { label: "IP身份中心", href: "/ip", icon: "id" },
  { label: "知识库中心", href: "/knowledge-hub", icon: "book" },
  { label: "设置", href: "/settings", icon: "settings" },
];
const MEMORY_NAV: { label: string; href: string; icon: IconName }[] = [
  { label: "我的判断库", href: "/decision-memory", icon: "flask" },
];
const WORKFLOW_NAV: { label: string; href: string; icon: IconName; step: string }[] = [
  { label: "AI 选题董事会", href: "/topic-board", icon: "chat", step: "01" },
  { label: "AI IP脚本工厂", href: "/script-factory", icon: "film", step: "02" },
  { label: "AI 拍摄作战室", href: "/shoot-room", icon: "camera", step: "03" },
  { label: "AI 评论区需求雷达", href: "/comment-radar", icon: "radar", step: "04" },
  { label: "爆款分析", href: "/hot-analysis", icon: "fire", step: "05" },
  { label: "文案优化", href: "/copy-optimization", icon: "edit", step: "06" },
  { label: "发布复盘", href: "/review", icon: "calendar", step: "07" },
];

function IPSwitcher() {
  const { ips, activeIP, switchIP, loading } = useIP();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (loading) {
    return <div className="card mb-3 p-3.5 h-[60px] animate-pulse" />;
  }

  return (
    <div className="relative mb-3" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="card w-full p-3 flex items-center gap-2.5 text-left"
      >
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
          style={{ background: activeIP?.color ?? "#999" }}
        >
          {activeIP?.avatar ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-[#BBB] leading-tight">当前操盘IP</div>
          <div className="text-[13px] font-bold text-[#1A1A1A] truncate leading-tight">
            {activeIP ? getIPDisplayLabel(activeIP, ips) : "未选择"}
          </div>
        </div>
        <div className={`text-[#999] transition-transform ${open ? "rotate-180" : ""}`}>
          <Icon name="chevronDown" size="sm" />
        </div>
      </button>

      {open && (
        <div className="card absolute left-0 top-[calc(100%+6px)] z-20 w-full p-1.5">
          {ips.map((ip) => (
            <button
              key={ip.id}
              onClick={() => { switchIP(ip.id); setOpen(false); }}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-[#F2F1ED]"
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: ip.color }}
              >
                {ip.avatar}
              </div>
              <span className="flex-1 truncate text-[12.5px] font-medium text-[#1A1A1A]">{getIPDisplayLabel(ip, ips)}</span>
              {ip.id === activeIP?.id && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#C8F04A" }} />
              )}
            </button>
          ))}
          <Link
            href="/ip"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12.5px] font-medium text-[#639922] hover:bg-[#F2F1ED]"
          >
            <Icon name="plus" size="sm" /> 管理 / 新建 IP
          </Link>
        </div>
      )}
    </div>
  );
}

// 侧边栏底部"操盘人"卡片——和上面的IPSwitcher是两个独立组件，互不影响。
// 点击卡片可以编辑昵称/姓名，不是写死的展示文字。
function OperatorCard() {
  const [profile, setProfile] = useState<UserProfile>({ nickname: "", name: "" });
  const [editing, setEditing] = useState(false);
  const [draftNickname, setDraftNickname] = useState("");
  const [draftName, setDraftName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setProfile(getUserProfile()); }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const displayName = getOperatorDisplayName(profile);

  function openEdit() {
    setDraftNickname(profile.nickname);
    setDraftName(profile.name);
    setEditing(true);
  }

  function handleSave() {
    const next: UserProfile = { nickname: draftNickname, name: draftName };
    setUserProfile(next);
    setProfile(next);
    setEditing(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={openEdit} className="card w-full p-3 flex items-center gap-3 text-left">
        <div className="h-8 w-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0" style={{ background: "#333" }}>
          {displayName.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[#1A1A1A] truncate">{displayName}</div>
          <div className="text-[10px] text-[#999]">AI+IP操盘手</div>
        </div>
      </button>

      {editing && (
        <div className="card absolute left-0 bottom-[calc(100%+6px)] z-20 w-full p-3 flex flex-col gap-2">
          <div className="text-[11px] font-bold text-[#888]">操盘人信息（独立于当前操盘IP）</div>
          <input
            value={draftNickname} onChange={e => setDraftNickname(e.target.value)}
            placeholder="昵称（优先显示，默认彭彭）"
            className="rounded-[8px] border border-[#E5E4DE] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#639922]"
          />
          <input
            value={draftName} onChange={e => setDraftName(e.target.value)}
            placeholder="真实姓名（昵称为空时显示）"
            className="rounded-[8px] border border-[#E5E4DE] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#639922]"
          />
          <button onClick={handleSave} className="rounded-[8px] bg-[#1C1C1B] px-3 py-1.5 text-[12px] font-semibold text-white">保存</button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;

  return (
    <div className="flex min-h-screen" style={{ background: "#F2F1ED" }}>
      <aside className="flex w-[220px] flex-shrink-0 flex-col p-3 sticky top-0 h-screen gap-1 overflow-y-auto">
        <div className="card mb-3 p-3.5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[13px] font-black" style={{ background: "#C8F04A", color: "#1A1A1A" }}>FP</div>
          <div>
            <div className="text-[14px] font-bold text-[#1A1A1A]">FlowPilot</div>
            <div className="text-[11px] text-[#999]">AI+IP操盘工作台</div>
          </div>
        </div>

        <IPSwitcher />

        <div className="px-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-[#BBB]">主菜单</div>
        {MAIN_NAV.map(item => (
          <Link key={item.href} href={item.href}
            className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13.5px] font-medium transition-all"
            style={isActive(item.href) ? { background: "#C8F04A", color: "#1A1A1A", fontWeight: 700 } : { color: "#555" }}>
            <Icon name={item.icon} size="sm" />{item.label}
          </Link>
        ))}

        <div className="px-2 mt-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-[#BBB]">记忆层</div>
        {MEMORY_NAV.map(item => (
          <Link key={item.href} href={item.href}
            className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13.5px] font-medium transition-all"
            style={isActive(item.href) ? { background: "#C8F04A", color: "#1A1A1A", fontWeight: 700 } : { color: "#555" }}>
            <Icon name={item.icon} size="sm" />{item.label}
          </Link>
        ))}

        <div className="px-2 mt-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-[#BBB]">内容生产流程</div>
        {WORKFLOW_NAV.map(item => (
          <Link key={item.href} href={item.href}
            className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13.5px] font-medium transition-all"
            style={isActive(item.href) ? { background: "#C8F04A", color: "#1A1A1A", fontWeight: 700 } : { color: "#555" }}>
            <Icon name={item.icon} size="sm" />
            <span className="flex-1">{item.label}</span>
            <span className="text-[10px] font-bold rounded-full px-2 py-0.5"
              style={{ background: isActive(item.href) ? "rgba(0,0,0,0.12)" : "#EAEAE6", color: isActive(item.href) ? "#1A1A1A" : "#888" }}>
              {item.step}
            </span>
          </Link>
        ))}

        <div className="mt-auto pt-3">
          <OperatorCard />
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-5">{children}</main>
    </div>
  );
}
