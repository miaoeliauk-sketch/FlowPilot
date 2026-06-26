// ─────────────────────────────────────────────
// 素材库 Tab — MaterialLibTab.tsx
// 存储层：localStorage（key: "flowpilot:materials"）
// 后续迁移桌面端只需替换 loadMaterials / saveMaterials 两个函数
// ─────────────────────────────────────────────

"use client";
import { useState, useEffect, useRef } from "react";

// ── 类型定义 ──────────────────────────────────
export type MaterialType = "image" | "texture" | "video" | "audio" | "font" | "other";

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  size: string;
  dataUrl: string;          // base64，后续桌面端改成 filePath
  aiTags: string[];
  tagging: boolean;
  createdAt: string;
}

const TYPE_LABEL: Record<MaterialType, string> = {
  image: "图片",
  texture: "纹理/背景",
  video: "视频/动效",
  audio: "音效/BGM",
  font: "字体/icon",
  other: "其他",
};

const TYPE_EMOJI: Record<MaterialType, string> = {
  image: "🖼",
  texture: "🎨",
  video: "🎬",
  audio: "🎵",
  font: "🔤",
  other: "📄",
};

// ── 存储层（只需改这两个函数即可迁移桌面端）──
const STORAGE_KEY = "flowpilot:materials";

function loadMaterials(): Material[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMaterials(list: Material[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ── 工具函数 ──────────────────────────────────
function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function detectType(file: File): MaterialType {
  const t = file.type || "";
  const n = file.name.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (n.endsWith(".ttf") || n.endsWith(".otf") || n.endsWith(".woff") || n.endsWith(".ico")) return "font";
  if (n.endsWith(".svg")) return "font";
  return "other";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── AI 打标 ───────────────────────────────────
async function runAITag(item: Material, file?: File): Promise<{ tags: string[]; finalType: MaterialType }> {
  let messages: object[];

  if (item.type === "image" || item.type === "texture") {
    const imagePrompt = `你是专业视频创作素材分析师。请仔细观察这张图片，完成以下任务：

第一步：判断这是【图片素材】还是【纹理/背景素材】
- 纹理/背景：重复图案、材质表面、无明显主体、适合铺底的背景图
- 图片素材：有具体主体内容（人物/场景/产品等）

第二步：输出10-14个具体可搜索的标签，用逗号分隔。
标签规则：
- 必须具体，不能模糊。错误：「纹理」「背景」。正确：「米色牛皮纸纹理」「深灰金属拉丝质感」
- 覆盖：①主体内容 ②主色调（具体颜色名）③材质/质感 ④风格（极简/复古/科技感/国风等）⑤用途（封面背景/转场叠加/文字压字区等）⑥氛围（冷峻/温暖/神秘/活泼等）
- 如果是纹理/背景，最后加「#纹理」标签
- 只输出标签，英文逗号分隔，不要其他文字`;

    messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: file?.type || "image/jpeg",
              data: item.dataUrl.split(",")[1],
            },
          },
          { type: "text", text: imagePrompt },
        ],
      },
    ];
  } else {
    const typeHints: Record<string, string> = {
      video: `视频/动效素材「${item.name}」。根据文件名推断：动效类型（粒子/光效/故障/转场/字幕等）、风格、适用场景`,
      audio: `音频素材「${item.name}」。根据文件名推断：类型（BGM/环境音/UI音效/转场音等）、情绪氛围、节奏、适用视频类型`,
      font: `字体/图标素材「${item.name}」。根据文件名推断：字体风格（衬线/无衬线/手写/毛笔/像素等）、视觉风格、适用场景`,
      other: `素材「${item.name}」，根据文件名推断用途和风格`,
    };
    messages = [
      {
        role: "user",
        content: `你是专业视频创作素材分析师。根据以下素材信息打标：

素材：${typeHints[item.type] || `文件「${item.name}」`}

输出10-14个具体可搜索的标签，英文逗号分隔。
标签要精准，能直接搜索定位。不要「音效」「视频」这类宽泛词，要「科技感开场BGM」「快节奏电子鼓点」「霓虹故障转场」这类具体标签。
只输出标签，不要其他文字。`,
      },
    ];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 300, messages }),
  });
  const data = await res.json();
  const text: string = data.content?.map((c: { text?: string }) => c.text || "").join("") || "";
  let tags = text
    .split(/[,，]/)
    .map((t: string) => t.trim())
    .filter((t: string) => t.length > 0 && t.length < 20);

  let finalType = item.type;
  if (tags.some((t: string) => t === "#纹理")) {
    tags = tags.filter((t: string) => t !== "#纹理");
    finalType = "texture";
  }

  return { tags, finalType };
}

// ── 子组件：素材卡片 ──────────────────────────
function MaterialCard({ m, onClick }: { m: Material; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-[14px] border border-[#E5E4DE] bg-white overflow-hidden hover:border-[#639922] transition-colors"
    >
      {/* 缩略图 */}
      <div className="h-[100px] bg-[#F7F6F2] flex items-center justify-center overflow-hidden relative">
        {m.type === "image" || m.type === "texture" ? (
          <img src={m.dataUrl} alt={m.name} className="w-full h-full object-cover" />
        ) : m.type === "video" ? (
          <video src={m.dataUrl} className="w-full h-full object-cover" muted />
        ) : (
          <span className="text-4xl">{TYPE_EMOJI[m.type]}</span>
        )}
        {m.aiTags.length > 0 && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-[#E9E6F7] px-2 py-0.5 text-[10px] text-[#5B3FA0] font-semibold">
            AI标注
          </span>
        )}
      </div>
      {/* 信息 */}
      <div className="p-3">
        <div className="text-[12.5px] font-semibold text-[#1C1C1B] truncate mb-0.5">{m.name}</div>
        <div className="text-[11px] text-[#999] mb-1.5">{TYPE_LABEL[m.type]} · {m.size}</div>
        <div className="flex flex-wrap gap-1">
          {m.tagging ? (
            <span className="rounded-full bg-[#F2F1ED] px-2 py-0.5 text-[10px] text-[#aaa] italic">AI分析中…</span>
          ) : (
            m.aiTags.slice(0, 3).map((tag, i) => (
              <span key={i} className="rounded-full bg-[#E9E6F7] px-2 py-0.5 text-[10px] text-[#5B3FA0]">{tag}</span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── 子组件：详情弹窗 ─────────────────────────
function MaterialDetailModal({
  m,
  onClose,
  onRetag,
  onDelete,
}: {
  m: Material;
  onClose: () => void;
  onRetag: () => void;
  onDelete: () => void;
}) {
  function copyDesc() {
    const text = `素材名称：${m.name}\n类型：${TYPE_LABEL[m.type]}\n标签：${m.aiTags.join("、")}`;
    navigator.clipboard.writeText(text);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-[520px] overflow-y-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 缩略图 */}
        <div className="h-[180px] bg-[#F7F6F2] flex items-center justify-center overflow-hidden rounded-t-[14px]">
          {m.type === "image" || m.type === "texture" ? (
            <img src={m.dataUrl} alt={m.name} className="w-full h-full object-contain" />
          ) : m.type === "video" ? (
            <video src={m.dataUrl} controls className="w-full h-full object-contain" />
          ) : m.type === "audio" ? (
            <div className="flex flex-col items-center gap-3 w-full px-6">
              <span className="text-5xl">{TYPE_EMOJI[m.type]}</span>
              <audio src={m.dataUrl} controls className="w-full" />
            </div>
          ) : (
            <span className="text-6xl">{TYPE_EMOJI[m.type]}</span>
          )}
        </div>

        {/* 内容 */}
        <div className="p-5">
          <div className="flex items-start justify-between mb-1">
            <div className="text-[16px] font-bold text-[#1C1C1B] pr-2">{m.name}</div>
            <button onClick={onClose} className="text-[18px] text-[#999] hover:text-[#1C1C1B] shrink-0">×</button>
          </div>
          <div className="text-[12px] text-[#999] mb-4">
            {TYPE_LABEL[m.type]} · {m.size} · {new Date(m.createdAt).toLocaleDateString("zh-CN")}
          </div>

          <div className="text-[11px] text-[#888] uppercase tracking-wide mb-2">AI 标签</div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {m.tagging ? (
              <span className="rounded-full bg-[#F2F1ED] px-2 py-1 text-[11px] text-[#aaa]">AI 分析中…</span>
            ) : m.aiTags.length === 0 ? (
              <span className="text-[12px] text-[#bbb]">暂无标签</span>
            ) : (
              m.aiTags.map((tag, i) => (
                <span key={i} className="rounded-full bg-[#E9E6F7] px-2.5 py-1 text-[11.5px] text-[#5B3FA0]">{tag}</span>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyDesc}
              className="rounded-[10px] border border-[#E5E4DE] px-3.5 py-2 text-[12.5px] text-[#555] hover:bg-[#F7F6F2] transition-colors"
            >
              复制调用描述
            </button>
            <button
              onClick={onRetag}
              disabled={m.tagging}
              className="rounded-[10px] border border-[#E5E4DE] px-3.5 py-2 text-[12.5px] text-[#555] hover:bg-[#F7F6F2] disabled:opacity-40 transition-colors"
            >
              {m.tagging ? "分析中…" : "重新打标"}
            </button>
            <button
              onClick={onDelete}
              className="rounded-[10px] border border-[#FCEBEB] px-3.5 py-2 text-[12.5px] text-[#A32D2D] hover:bg-[#FCEBEB] transition-colors ml-auto"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 主组件：素材库 Tab ────────────────────────
export default function MaterialLibTab() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [catFilter, setCatFilter] = useState<MaterialType | "all">("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Material | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化加载
  useEffect(() => {
    setMaterials(loadMaterials());
  }, []);

  function persist(list: Material[]) {
    setMaterials(list);
    saveMaterials(list);
  }

  // ── 上传处理 ──
  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      const dataUrl = await readFileAsDataUrl(file);
      const item: Material = {
        id: genId(),
        name: file.name,
        type: detectType(file),
        size: formatSize(file.size),
        dataUrl,
        aiTags: [],
        tagging: true,
        createdAt: new Date().toISOString(),
      };
      // 立即显示卡片，后台打标
      setMaterials((prev) => {
        const next = [item, ...prev];
        saveMaterials(next);
        return next;
      });
      // 异步打标
      runAITag(item, file)
        .then(({ tags, finalType }) => {
          setMaterials((prev) => {
            const next = prev.map((m) =>
              m.id === item.id ? { ...m, aiTags: tags, type: finalType, tagging: false } : m
            );
            saveMaterials(next);
            return next;
          });
        })
        .catch(() => {
          setMaterials((prev) => {
            const next = prev.map((m) =>
              m.id === item.id ? { ...m, aiTags: ["打标失败，可点击重试"], tagging: false } : m
            );
            saveMaterials(next);
            return next;
          });
        });
    }
  }

  // ── 重新打标 ──
  async function handleRetag(id: string) {
    const m = materials.find((x) => x.id === id);
    if (!m) return;
    setMaterials((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, tagging: true, aiTags: [] } : x));
      saveMaterials(next);
      return next;
    });
    if (detail?.id === id) setDetail((prev) => prev ? { ...prev, tagging: true, aiTags: [] } : null);
    try {
      const { tags, finalType } = await runAITag(m);
      setMaterials((prev) => {
        const next = prev.map((x) => (x.id === id ? { ...x, aiTags: tags, type: finalType, tagging: false } : x));
        saveMaterials(next);
        return next;
      });
      if (detail?.id === id) setDetail((prev) => prev ? { ...prev, aiTags: tags, type: finalType, tagging: false } : null);
    } catch {
      setMaterials((prev) => {
        const next = prev.map((x) => (x.id === id ? { ...x, aiTags: ["打标失败，可点击重试"], tagging: false } : x));
        saveMaterials(next);
        return next;
      });
    }
  }

  // ── 删除 ──
  function handleDelete(id: string) {
    const next = materials.filter((m) => m.id !== id);
    persist(next);
    setDetail(null);
  }

  // ── 拖拽 ──
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() {
    setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  // ── 筛选 ──
  const filtered = materials.filter((m) => {
    if (catFilter !== "all" && m.type !== catFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return m.name.toLowerCase().includes(q) || m.aiTags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  const counts: Record<string, number> = { all: materials.length };
  (Object.keys(TYPE_LABEL) as MaterialType[]).forEach((t) => {
    counts[t] = materials.filter((m) => m.type === t).length;
  });

  const CATS: { id: MaterialType | "all"; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "image", label: "图片" },
    { id: "texture", label: "纹理/背景" },
    { id: "video", label: "视频/动效" },
    { id: "audio", label: "音效/BGM" },
    { id: "font", label: "字体/icon" },
  ];

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* 顶部操作栏 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* 分类筛选 */}
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCatFilter(c.id)}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all"
              style={
                catFilter === c.id
                  ? { background: "#1C1C1B", color: "#fff" }
                  : { background: "#F2F1ED", color: "#888" }
              }
            >
              {c.label}
              {counts[c.id] > 0 && (
                <span className="ml-1 opacity-60">{counts[c.id]}</span>
              )}
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索素材或标签…"
          className="ml-auto h-[36px] w-[200px] rounded-[10px] border border-[#E5E4DE] px-3 text-[13px] outline-none focus:border-[#639922]"
        />

        {/* 上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-[10px] bg-[#1C1C1B] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#333] transition-colors"
        >
          + 上传素材
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.ttf,.otf,.woff,.svg,.ico"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* 拖拽提示区 */}
      {dragging && (
        <div className="mb-4 rounded-[14px] border-2 border-dashed border-[#639922] bg-[#F4FAE8] py-8 text-center text-[13.5px] font-semibold text-[#639922]">
          松开即可上传素材 · AI 自动打标分类
        </div>
      )}

      {/* 空状态 */}
      {materials.length === 0 && !dragging && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-[14px] border border-dashed border-[#E5E4DE] py-16 text-center hover:border-[#639922] transition-colors"
        >
          <div className="text-4xl mb-3">🗂</div>
          <div className="text-[14px] font-semibold text-[#888] mb-1">还没有素材</div>
          <div className="text-[12.5px] text-[#bbb]">拖拽文件到页面，或点击这里上传 · AI 自动打标分类</div>
        </div>
      )}

      {/* 素材网格 */}
      {filtered.length > 0 && (
        <>
          <div className="mb-3 text-[12px] text-[#8A8A86]">共 {filtered.length} 个素材</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MaterialCard key={m.id} m={m} onClick={() => setDetail(m)} />
            ))}
          </div>
        </>
      )}

      {/* 筛选无结果 */}
      {materials.length > 0 && filtered.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-[#E5E4DE] py-12 text-center text-[13px] text-[#999]">
          没有匹配的素材
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <MaterialDetailModal
          m={detail}
          onClose={() => setDetail(null)}
          onRetag={() => handleRetag(detail.id)}
          onDelete={() => handleDelete(detail.id)}
        />
      )}
    </div>
  );
}
