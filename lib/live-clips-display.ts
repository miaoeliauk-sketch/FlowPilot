interface SourcePosition {
  startTime: string | null;
  endTime: string | null;
  startParagraph: number;
  endParagraph: number;
}

export function formatLiveClipPosition(source: SourcePosition) {
  if (source.startTime && source.endTime) return `${source.startTime} → ${source.endTime}`;
  if (source.startTime) return `${source.startTime}起 · 第${source.startParagraph}段 → 第${source.endParagraph}段`;
  return `第${source.startParagraph}段 → 第${source.endParagraph}段`;
}
