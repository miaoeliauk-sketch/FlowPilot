export interface TranscriptSourceItem {
  title: string;
  text: string;
  sourceUrl: string;
}

export type TranscriptSource =
  | { kind: "manual"; items: TranscriptSourceItem[] }
  | { kind: "audio"; items: TranscriptSourceItem[] }
  | { kind: "douyin"; items: TranscriptSourceItem[] };

export function buildTranscriptText(source: TranscriptSource): string {
  if (source.items.length === 1) return source.items[0]?.text ?? "";
  return source.items
    .map(item => `【${item.title}】\n${item.text}`)
    .join("\n\n");
}

export function attachManualTranscript(
  source: TranscriptSource,
  text: string,
): TranscriptSource {
  if (source.kind === "douyin") return source;
  if (source.items.length > 0) {
    return {
      ...source,
      items: [{ ...source.items[0]!, text }],
    };
  }
  return {
    ...source,
    items: [{
      title: source.kind === "audio" ? "音频逐字稿" : "手动粘贴逐字稿",
      text,
      sourceUrl: "",
    }],
  };
}
