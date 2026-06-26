import Link from "next/link";

const MODULES = [
  {
    href: "/topic-board",
    step: "01",
    title: "AI 选题董事会",
    desc: "8 位虚拟专家独立打分，给出综合评分、爆款等级与优化建议。",
    icon: "chat",
    ready: true,
  },
  {
    href: "/script-factory",
    step: "02",
    title: "AI IP脚本工厂",
    desc: "基于当前IP的人设、受众与表达风格，一次性生成标题、封面、口播逐字稿、分镜与拍摄建议。",
    icon: "film",
    ready: true,
  },
  {
    href: "/shoot-room",
    step: "03",
    title: "AI 拍摄作战室",
    desc: "管理一次完整拍摄战役：完成度评分、风险扫描、执行计划与拍摄清单。",
    icon: "camera",
    ready: true,
  },
  {
    href: "/transcribe",
    step: "04",
    title: "录音转逐字稿",
    desc: "上传录音，自动转写成文字稿，方便整理成文案与脚本素材。",
    icon: "mic",
    ready: false,
  },
  {
    href: "/hot-analysis",
    step: "05",
    title: "爆款分析",
    desc: "批量分析同赛道高赞视频，拆解结构、节奏与爆点。",
    icon: "chart",
    ready: false,
  },
  {
    href: "/copy-optimization",
    step: "06",
    title: "文案优化",
    desc: "把爆款视频拆成逐句脚本，结合账号定位重写出你的版本。",
    icon: "edit",
    ready: false,
  },
  {
    href: "/review",
    step: "07",
    title: "发布复盘",
    desc: "回顾已发布内容的数据表现，沉淀经验到下一轮选题。",
    icon: "calendar",
    ready: false,
  },
];

function ModuleIcon({ name }: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    chat: <path d="M4 5H20V16H11L6 20V16H4V5Z" strokeLinejoin="round" />,
    camera: (
      <>
        <path d="M3 7L9 4L15 7L21 4V17L15 20L9 17L3 20V7Z" strokeLinejoin="round" />
        <path d="M9 4V17M15 7V20" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11C5 14.866 8.13401 18 12 18C15.866 18 19 14.866 19 11" strokeLinecap="round" />
        <path d="M12 18V21M9 21H15" strokeLinecap="round" />
      </>
    ),
    chart: (
      <>
        <path d="M4 19V13M9 19V8M14 19V11M19 19V5" strokeLinecap="round" />
        <path d="M3 19H21" strokeLinecap="round" />
      </>
    ),
    edit: (
      <>
        <path d="M5 4H19V20L12 16.5L5 20V4Z" strokeLinejoin="round" />
        <path d="M9 9H15M9 12H13" strokeLinecap="round" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 9H20M8 3V6M16 3V6" strokeLinecap="round" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M3 15h18M8 5v4M8 15v4M16 5v4M16 15v4" strokeLinecap="round" />
      </>
    ),
  };

  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F4F4F2] p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1B]">
          你好，彭彭 👋
        </h1>
        <p className="mt-1 text-[13.5px] text-[#8A8A86]">
          工作台已为你准备好 7 个内容生产工具，按流程顺序逐步开放。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => {
          const card = (
            <div
              className={`flex h-full flex-col gap-3 rounded-[14px] border border-[#E5E4DE] bg-white p-5 transition ${
                m.ready ? "hover:border-[#639922]" : "opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#EAF3DE] text-[#3B6D11]">
                  <ModuleIcon name={m.icon} />
                </div>
                <span className="rounded-full bg-[#F1EFE8] px-2.5 py-1 text-[11px] font-semibold text-[#5F5E5A]">
                  {m.step}
                </span>
              </div>
              <h3 className="text-[15px] font-semibold text-[#1C1C1B]">{m.title}</h3>
              <p className="flex-1 text-[13px] leading-6 text-[#8A8A86]">{m.desc}</p>
              <span className="text-[12.5px] font-semibold text-[#639922]">
                {m.ready ? "进入工具 →" : "敬请期待"}
              </span>
            </div>
          );

          return m.ready ? (
            <Link key={m.href} href={m.href}>
              {card}
            </Link>
          ) : (
            <div key={m.href} className="cursor-default">
              {card}
            </div>
          );
        })}
      </div>
    </div>
  );
}
