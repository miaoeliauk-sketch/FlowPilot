"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IPSourceAnchor } from "@/lib/types";

export interface SourceViewerProps {
  sourceContent: string;
  activeAnchor: IPSourceAnchor | null;
}

function isValidAnchor(sourceContent: string, anchor: IPSourceAnchor | null): anchor is IPSourceAnchor {
  return Boolean(anchor)
    && Number.isInteger(anchor?.startPosition)
    && Number.isInteger(anchor?.endPosition)
    && anchor!.startPosition >= 0
    && anchor!.endPosition > anchor!.startPosition
    && anchor!.endPosition <= sourceContent.length
    && sourceContent.slice(anchor!.startPosition, anchor!.endPosition) === anchor!.quote;
}

export function SourceViewer({ sourceContent, activeAnchor }: SourceViewerProps) {
  const activeMarkRef = useRef<HTMLElement | null>(null);
  const validAnchor = useMemo(
    () => isValidAnchor(sourceContent, activeAnchor) ? activeAnchor : null,
    [activeAnchor, sourceContent],
  );

  useEffect(() => {
    if (validAnchor && typeof activeMarkRef.current?.scrollIntoView === "function") {
      activeMarkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [validAnchor]);

  return (
    <div className="rounded-[12px] border border-[#E5E4DE] bg-[#FAFAF8] p-4">
      {activeAnchor && !validAnchor && (
        <div role="status" className="mb-3 rounded-[8px] bg-[#FFF1F1] px-3 py-2 text-[11.5px] font-semibold text-[#A32D2D]">
          锚点失效
        </div>
      )}
      <div data-testid="source-content" className="whitespace-pre-wrap break-words text-[13px] leading-7 text-[#333]">
        {validAnchor ? (
          <>
            {sourceContent.slice(0, validAnchor.startPosition)}
            <mark
              id="active-source-anchor"
              ref={activeMarkRef}
              className="rounded bg-[#FFF2A8] px-0.5 text-inherit"
            >
              {sourceContent.slice(validAnchor.startPosition, validAnchor.endPosition)}
            </mark>
            {sourceContent.slice(validAnchor.endPosition)}
          </>
        ) : sourceContent}
      </div>
    </div>
  );
}
