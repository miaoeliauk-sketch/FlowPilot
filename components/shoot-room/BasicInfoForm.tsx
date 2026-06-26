"use client";

import { TIME_OPTIONS } from "./constants";

interface BasicInfoFormProps {
  date: string;
  availableTime: "2h" | "4h" | "full";
  location: string;
  soloShoot: boolean;
  hasPhotographer: boolean;
  onChange: (patch: Partial<{
    date: string;
    availableTime: "2h" | "4h" | "full";
    location: string;
    soloShoot: boolean;
    hasPhotographer: boolean;
  }>) => void;
}

export default function BasicInfoForm({
  date,
  availableTime,
  location,
  soloShoot,
  hasPhotographer,
  onChange,
}: BasicInfoFormProps) {
  return (
    <div className="rounded-[20px] bg-[#F4F4F2] p-4 md:p-5">
      <h3 className="mb-3 text-[13px] font-semibold text-[#8A8A86]">基础信息</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">拍摄日期</label>
          <input
            type="date"
            value={date}
            onChange={(e) => onChange({ date: e.target.value })}
            className="h-[48px] w-full rounded-[14px] border border-[#E5E4DE] bg-white px-4 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">拍摄地点</label>
          <input
            type="text"
            value={location}
            onChange={(e) => onChange({ location: e.target.value })}
            placeholder="例如：家里书房"
            className="h-[48px] w-full rounded-[14px] border border-[#E5E4DE] bg-white px-4 text-[14px] text-[#1C1C1B] outline-none focus:border-[#639922] focus:ring-2 focus:ring-[#EAF3DE]"
          />
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-[12.5px] text-[#8A8A86]">今日可用时间</label>
          <div className="flex gap-2">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ availableTime: opt.value })}
                className={`h-[44px] flex-1 rounded-[14px] text-[14px] font-semibold transition ${
                  availableTime === opt.value
                    ? "bg-[#639922] text-white"
                    : "bg-white text-[#8A8A86] hover:text-[#639922]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[14px] bg-white px-4 py-3 md:col-span-1">
          <span className="text-[14px] text-[#1C1C1B]">单人拍摄</span>
          <ToggleSwitch checked={soloShoot} onChange={(v) => onChange({ soloShoot: v })} />
        </div>

        <div className="flex items-center justify-between rounded-[14px] bg-white px-4 py-3 md:col-span-1">
          <span className="text-[14px] text-[#1C1C1B]">有摄影师协助</span>
          <ToggleSwitch
            checked={hasPhotographer}
            onChange={(v) => onChange({ hasPhotographer: v })}
          />
        </div>
      </div>
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${
        checked ? "bg-[#639922]" : "bg-[#E5E1F2]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
          checked ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}
