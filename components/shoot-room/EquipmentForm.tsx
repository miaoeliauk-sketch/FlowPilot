"use client";

import { EQUIPMENT_ITEMS, RESHOOT_OPTIONS } from "./constants";
import { ToggleSwitch } from "./BasicInfoForm";

interface EquipmentFormProps {
  props: boolean;
  outfit: boolean;
  mic: boolean;
  lighting: boolean;
  teleprompter: boolean;
  reshootNeeds: string[];
  onChange: (patch: Partial<{
    props: boolean;
    outfit: boolean;
    mic: boolean;
    lighting: boolean;
    teleprompter: boolean;
    reshootNeeds: string[];
  }>) => void;
}

export default function EquipmentForm({
  props,
  outfit,
  mic,
  lighting,
  teleprompter,
  reshootNeeds,
  onChange,
}: EquipmentFormProps) {
  const values: Record<string, boolean> = { props, outfit, mic, lighting, teleprompter };

  function toggleReshoot(item: string) {
    const next = reshootNeeds.includes(item)
      ? reshootNeeds.filter((r) => r !== item)
      : [...reshootNeeds, item];
    onChange({ reshootNeeds: next });
  }

  return (
    <div className="rounded-[20px] bg-[#F4F4F2] p-4 md:p-5">
      <h3 className="mb-3 text-[13px] font-semibold text-[#8A8A86]">素材与设备准备</h3>

      <div className="mb-4 overflow-hidden rounded-[16px] bg-white">
        {EQUIPMENT_ITEMS.map((item, i) => (
          <div
            key={item.key}
            className={`flex items-center justify-between px-4 py-3 ${
              i !== EQUIPMENT_ITEMS.length - 1 ? "border-b border-[#E5E4DE]" : ""
            }`}
          >
            <span className="text-[14px] text-[#1C1C1B]">{item.label}</span>
            <ToggleSwitch
              checked={values[item.key]}
              onChange={(v) => onChange({ [item.key]: v } as Partial<EquipmentFormProps>)}
            />
          </div>
        ))}
      </div>

      <label className="mb-2 block text-[12.5px] text-[#8A8A86]">补拍素材需求（可多选）</label>
      <div className="flex flex-wrap gap-2">
        {RESHOOT_OPTIONS.map((opt) => {
          const active = reshootNeeds.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleReshoot(opt)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                active ? "bg-[#639922] text-white" : "bg-white text-[#8A8A86] hover:text-[#639922]"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
