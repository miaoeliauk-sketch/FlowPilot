"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "./icon";

export interface SelectOption { value: string; label: string; }

export function Select({
  value, onChange, options, placeholder = "请选择", className = "",
}: {
  value: string; onChange: (v: string) => void;
  options: SelectOption[]; placeholder?: string; className?: string;
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

  const selected = options.find(o => o.value === value);

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
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-[#F7F6F2]"
              style={o.value === value ? { color: "#639922", fontWeight: 600 } : { color: "#1C1C1B" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
