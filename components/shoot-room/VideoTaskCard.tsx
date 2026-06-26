"use client";

import { VideoTask, Readiness } from "./types";
import {
  CATEGORY_OPTIONS,
  DURATION_OPTIONS,
  PRIORITY_OPTIONS,
  READINESS_OPTIONS,
  SCENE_OPTIONS,
} from "./constants";
import { ToggleSwitch } from "./BasicInfoForm";
import { Select } from "@/components/ui/select";

interface VideoTaskCardProps {
  video: VideoTask;
  index: number;
  onChange: (id: string, patch: Partial<VideoTask>) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  S: { bg: "#FBE2EC", text: "#E0608E" },
  A: { bg: "#FBF3D6", text: "#C99A1E" },
  B: { bg: "#DCEBFB", text: "#4A8FD6" },
};

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`h-[36px] flex-1 rounded-[12px] text-[12.5px] font-semibold transition ${
            value === opt.value
              ? "bg-[#639922] text-white"
              : "bg-[#F4F4F2] text-[#8A8A86] hover:text-[#639922]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PrepToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex h-[40px] items-center justify-center gap-1.5 rounded-[12px] text-[12.5px] font-medium transition ${
        checked ? "bg-[#DBF1E6] text-[#3DA876]" : "bg-[#F4F4F2] text-[#8A8A86]"
      }`}
    >
      {checked ? "✓ " : ""}
      {label}
    </button>
  );
}

export default function VideoTaskCard({
  video,
  index,
  onChange,
  onRemove,
  canRemove,
}: VideoTaskCardProps) {
  function update(patch: Partial<VideoTask>) {
    onChange(video.id, patch);
  }

  function toggleScene(scene: string) {
    const next = video.scenes.includes(scene)
      ? video.scenes.filter((s) => s !== scene)
      : [...video.scenes, scene];
    update({ scenes: next });
  }

  const priorityColor = PRIORITY_COLORS[video.priority];

  return (
    <div className="rounded-[20px] bg-[#F4F4F2] p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
            style={{ background: priorityColor.bg, color: priorityColor.text }}
          >
            {index + 1}
          </span>
          <span className="text-[13px] font-semibold text-[#8A8A86]">视频 {index + 1}</span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(video.id)}
            className="text-[12.5px] font-medium text-[#E0608E]"
          >
            删除
          </button>
        )}
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">视频名称</label>
        <input
          type="text"
          value={video.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="例如：ChatGPT做副业"
          className="h-[46px] w-full rounded-[14px] border border-[#E5E4DE] bg-white px-4 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
        />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">选题类型</label>
          <Select
            value={video.category}
            onChange={(v) => update({ category: v })}
            options={CATEGORY_OPTIONS}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">预计时长</label>
          <Select
            value={video.duration}
            onChange={(v) => update({ duration: v })}
            options={DURATION_OPTIONS}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">优先级</label>
          <SegmentedControl
            options={PRIORITY_OPTIONS}
            value={video.priority}
            onChange={(v) => update({ priority: v })}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">脚本完成情况</label>
        <SegmentedControl<Readiness>
          options={READINESS_OPTIONS}
          value={video.scriptStatus}
          onChange={(v) => update({ scriptStatus: v })}
        />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">内容准备情况</label>
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
          <PrepToggle label="标题" checked={video.titleReady} onChange={(v) => update({ titleReady: v })} />
          <PrepToggle label="封面文案" checked={video.coverCopyReady} onChange={(v) => update({ coverCopyReady: v })} />
          <PrepToggle label="案例" checked={video.caseReady} onChange={(v) => update({ caseReady: v })} />
          <PrepToggle label="数据" checked={video.dataReady} onChange={(v) => update({ dataReady: v })} />
          <PrepToggle label="截图" checked={video.screenshotReady} onChange={(v) => update({ screenshotReady: v })} />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">拍摄场景（可多选）</label>
        <div className="flex flex-wrap gap-2">
          {SCENE_OPTIONS.map((scene) => {
            const active = video.scenes.includes(scene);
            return (
              <button
                key={scene}
                type="button"
                onClick={() => toggleScene(scene)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                  active ? "bg-[#639922] text-white" : "bg-white text-[#8A8A86] hover:text-[#639922]"
                }`}
              >
                {scene}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
