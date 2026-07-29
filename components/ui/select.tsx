"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "./icon";

export interface SelectOption {
  value: string;
  label: string;
  avatarText?: string;
  avatarColor?: string;
}

export function Select({
  value, onChange, options, placeholder = "请选择", className = "",
}: {
  value: string; onChange: (v: string) => void;
  options: Array<SelectOption | string>; placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const normalizedOptions = options.map((option) => (
    typeof option === "string" ? { value: option, label: option } : option
  ));
  const selected = normalizedOptions.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-[10px] border border-[#E5E4DE] bg-white px-3 py-2 text-[13px] text-[#1C1C1B] hover:border-[#639922]"
      >
        <span className={selected ? "text-[#1C1C1B]" : "text-[#BBB]"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""} text-[#999]`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-20 w-full overflow-hidden rounded-[10px] border border-[#E5E4DE] bg-white shadow-lg">
          {normalizedOptions.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#F7F6F2]"
              style={o.value === value ? { color: "#639922", fontWeight: 600 } : { color: "#1C1C1B" }}
            >
              {o.avatarText && (
                <span
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: o.avatarColor ?? "#999" }}
                >
                  {o.avatarText}
                </span>
              )}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
