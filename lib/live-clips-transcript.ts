import type {
  SourceRemovalSuggestion,
  TopicBlock,
  TranscriptChunk,
  TranscriptParagraph,
} from "./live-clips-types";

interface ParseTranscriptOptions {
  maxParagraphChars?: number;
}

interface ChunkOptions {
  targetChars?: number;
  maxChars?: number;
  overlapParagraphs?: number;
  overlapChars?: number;
}

interface ParsedTimecode {
  normalized: string;
  seconds: number;
}

interface ParsedLineTimecode {
  start: ParsedTimecode | null;
  end: ParsedTimecode | null;
  remaining: string;
  isRangeOnly: boolean;
}

function normalizeTimecode(hours: number, minutes: number, seconds: number) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseTimeParts(value: string): ParsedTimecode | null {
  const clean = value.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const numbers = parts.map(part => Number(part));
  if (numbers.some(Number.isNaN)) return null;
  const hours = parts.length === 3 ? numbers[0] : 0;
  const minutes = parts.length === 3 ? numbers[1] : numbers[0];
  const secondsWithMs = parts.length === 3 ? numbers[2] : numbers[1];
  const seconds = Math.floor(secondsWithMs);
  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59 || hours < 0) return null;
  return {
    normalized: normalizeTimecode(hours, minutes, seconds),
    seconds: hours * 3600 + minutes * 60 + secondsWithMs,
  };
}

function parseLineTimecode(line: string): ParsedLineTimecode {
  const range = line.match(/^\s*(\d{1,2}:\d{2}:\d{2}(?:[,.]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}:\d{2}(?:[,.]\d{1,3})?)\s*$/);
  if (range) {
    return {
      start: parseTimeParts(range[1]),
      end: parseTimeParts(range[2]),
      remaining: "",
      isRangeOnly: true,
    };
  }

  const bracketed = line.match(/^\s*[\[【](\d{1,2}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)[\]】]\s*(.*)$/);
  if (bracketed) {
    const start = parseTimeParts(bracketed[1]);
    if (!start) return { start: null, end: null, remaining: line.trim(), isRangeOnly: false };
    return {
      start,
      end: null,
      remaining: bracketed[2].trim(),
      isRangeOnly: false,
    };
  }

  const leading = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)\s+(.+)$/);
  if (leading) {
    const start = parseTimeParts(leading[1]);
    if (!start) return { start: null, end: null, remaining: line.trim(), isRangeOnly: false };
    return {
      start,
      end: null,
      remaining: leading[2].trim(),
      isRangeOnly: false,
    };
  }

  return { start: null, end: null, remaining: line.trim(), isRangeOnly: false };
}

function splitCompleteSentences(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]?/g)?.map(value => value.trim()).filter(Boolean) ?? [text];
  const groups: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      groups.push(current);
      current = "";
    }
    if (sentence.length > maxChars) {
      if (current) groups.push(current);
      groups.push(sentence);
      continue;
    }
    current += sentence;
  }
  if (current) groups.push(current);
  return groups;
}

export function parseLiveTranscript(rawTranscript: string, options: ParseTranscriptOptions = {}) {
  if (!rawTranscript.trim()) throw new Error("逐字稿内容为空");
  const maxParagraphChars = options.maxParagraphChars ?? 600;
  const normalized = rawTranscript.replace(/\r\n?/g, "\n");
  const rawLines = normalized.split("\n");
  const paragraphs: TranscriptParagraph[] = [];
  let sourceOffset = 0;
  let pendingRange: { start: ParsedTimecode; end: ParsedTimecode } | null = null;
  let pendingStart: ParsedTimecode | null = null;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const rawLine = rawLines[lineIndex];
    const lineStartOffset = sourceOffset;
    sourceOffset += rawLine.length + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || (/^\d+$/.test(trimmed) && rawLines[lineIndex + 1]?.includes("-->"))) continue;

    const parsedTime = parseLineTimecode(rawLine);
    if (parsedTime.isRangeOnly && parsedTime.start && parsedTime.end) {
      pendingRange = { start: parsedTime.start, end: parsedTime.end };
      pendingStart = null;
      continue;
    }
    const text = parsedTime.remaining;
    if (!text) {
      if (parsedTime.start) {
        pendingStart = parsedTime.start;
        pendingRange = null;
      }
      continue;
    }
    const timeStart = parsedTime.start ?? pendingRange?.start ?? pendingStart ?? null;
    const timeEnd = parsedTime.end ?? pendingRange?.end ?? null;
    pendingRange = null;
    pendingStart = null;
    const splitParts = splitCompleteSentences(text, maxParagraphChars);
    let textOffset = 0;
    for (const [partIndex, part] of splitParts.entries()) {
      const relative = rawLine.indexOf(part, textOffset);
      const partStart = relative >= 0 ? lineStartOffset + relative : lineStartOffset;
      textOffset = relative >= 0 ? relative + part.length : textOffset;
      paragraphs.push({
        paragraphNumber: paragraphs.length + 1,
        text: part,
        rawLine,
        startOffset: partStart,
        endOffset: partStart + part.length,
        startTime: partIndex === 0 ? timeStart?.normalized ?? null : null,
        endTime: partIndex === splitParts.length - 1 ? timeEnd?.normalized ?? null : null,
        startSeconds: partIndex === 0 ? timeStart?.seconds ?? null : null,
        endSeconds: partIndex === splitParts.length - 1 ? timeEnd?.seconds ?? null : null,
      });
    }
  }

  if (paragraphs.length === 0) throw new Error("逐字稿未解析出有效段落");
  return {
    paragraphs,
    hasTimecode: paragraphs.some(paragraph => paragraph.startTime !== null || paragraph.endTime !== null),
  };
}

export function deriveSourceLocation(
  paragraphs: TranscriptParagraph[],
  startParagraph: number,
  endParagraph: number,
) {
  const selected = paragraphs.filter(paragraph => (
    paragraph.paragraphNumber >= startParagraph && paragraph.paragraphNumber <= endParagraph
  ));
  if (selected.length === 0) throw new Error("切片段落范围无效");
  const preceding = paragraphs
    .filter(paragraph => paragraph.paragraphNumber <= startParagraph && paragraph.startSeconds !== null)
    .at(-1) ?? null;
  const endParagraphRecord = paragraphs.find(paragraph => paragraph.paragraphNumber === endParagraph) ?? null;
  const following = paragraphs.find(paragraph => (
    paragraph.paragraphNumber > endParagraph && paragraph.startSeconds !== null
  )) ?? null;
  const endTime = endParagraphRecord?.endTime ?? following?.startTime ?? null;
  const endSeconds = endParagraphRecord?.endSeconds ?? following?.startSeconds ?? null;
  const startTime = preceding?.startTime ?? null;
  const startSeconds = preceding?.startSeconds ?? null;
  const actualDuration = startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
    ? Math.round(endSeconds - startSeconds)
    : null;
  const textChars = selected.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
  return {
    startTime,
    endTime,
    estimatedDurationSeconds: actualDuration ?? Math.max(1, Math.round(textChars / 3.5)),
    durationBasis: actualDuration === null ? "text-estimate" as const : "actual" as const,
  };
}

function chunkText(paragraphs: TranscriptParagraph[]) {
  return paragraphs.map(paragraph => {
    const time = paragraph.startTime ? `[${paragraph.startTime}]` : "";
    return `[P${paragraph.paragraphNumber}]${time} ${paragraph.text}`;
  }).join("\n");
}

export function buildTranscriptChunks(
  liveTranscriptId: string,
  paragraphs: TranscriptParagraph[],
  options: ChunkOptions = {},
): TranscriptChunk[] {
  if (paragraphs.length === 0) return [];
  const targetChars = options.targetChars ?? 6000;
  const maxChars = options.maxChars ?? 8000;
  const overlapParagraphs = options.overlapParagraphs ?? 2;
  const overlapChars = options.overlapChars ?? 800;
  const ownedGroups: TranscriptParagraph[][] = [];
  let current: TranscriptParagraph[] = [];
  let currentChars = 0;

  for (const paragraph of paragraphs) {
    const nextChars = currentChars + paragraph.text.length;
    if (current.length > 0 && (nextChars > maxChars || (currentChars >= targetChars && nextChars > targetChars))) {
      ownedGroups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(paragraph);
    currentChars += paragraph.text.length;
  }
  if (current.length > 0) ownedGroups.push(current);

  return ownedGroups.map((owned, index) => {
    const previous = ownedGroups[index - 1] ?? [];
    const overlap: TranscriptParagraph[] = [];
    let overlapLength = 0;
    for (const paragraph of previous.slice(-overlapParagraphs).reverse()) {
      if (overlapLength + paragraph.text.length > overlapChars && overlap.length > 0) break;
      overlap.unshift(paragraph);
      overlapLength += paragraph.text.length;
    }
    const included = [...overlap, ...owned];
    const location = deriveSourceLocation(
      paragraphs,
      included[0].paragraphNumber,
      included.at(-1)!.paragraphNumber,
    );
    return {
      id: `${liveTranscriptId}-chunk-${index + 1}`,
      liveTranscriptId,
      paragraphNumbers: included.map(paragraph => paragraph.paragraphNumber),
      ownedStartParagraph: owned[0].paragraphNumber,
      ownedEndParagraph: owned.at(-1)!.paragraphNumber,
      startParagraph: included[0].paragraphNumber,
      endParagraph: included.at(-1)!.paragraphNumber,
      startTime: location.startTime,
      endTime: location.endTime,
      text: chunkText(included),
      status: "pending" as const,
      errorStage: null,
      errorCause: null,
      errorReason: null,
      removalSuggestions: [],
    };
  });
}

function countOccurrences(text: string, quote: string) {
  if (!quote) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(quote, offset);
    if (index < 0) break;
    count += 1;
    offset = index + quote.length;
  }
  return count;
}

export function verifySourceQuote(
  paragraphs: TranscriptParagraph[],
  paragraphNumber: number,
  quote: string,
) {
  const paragraph = paragraphs.find(item => item.paragraphNumber === paragraphNumber);
  return !!paragraph && countOccurrences(paragraph.text, quote) === 1;
}

export function applyVerifiedRemovals(
  paragraphs: TranscriptParagraph[],
  removals: SourceRemovalSuggestion[],
) {
  const byParagraph = new Map<number, SourceRemovalSuggestion[]>();
  for (const removal of removals) {
    if (!verifySourceQuote(paragraphs, removal.paragraphNumber, removal.quote)) {
      throw new Error(`删除片段无法在原文中唯一定位：第${removal.paragraphNumber}段`);
    }
    const list = byParagraph.get(removal.paragraphNumber) ?? [];
    list.push(removal);
    byParagraph.set(removal.paragraphNumber, list);
  }
  return paragraphs.map(paragraph => {
    return removeVerifiedQuotes(
      paragraph.text,
      byParagraph.get(paragraph.paragraphNumber) ?? [],
      `第${paragraph.paragraphNumber}段`,
    ).trim();
  }).filter(Boolean).join("\n");
}

function removeVerifiedQuotes(
  text: string,
  removals: SourceRemovalSuggestion[],
  locationLabel: string,
) {
  const ranges = removals.map(removal => {
    const start = text.indexOf(removal.quote);
    if (start < 0 || text.indexOf(removal.quote, start + removal.quote.length) >= 0) {
      throw new Error(`删除片段无法在原文中唯一定位：${locationLabel}`);
    }
    return { start, end: start + removal.quote.length };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new Error(`删除片段相互重叠：${locationLabel}`);
    }
  }

  let cleaned = text;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    cleaned = cleaned.slice(0, range.start) + cleaned.slice(range.end);
  }
  return cleaned;
}

interface ClipTextInput {
  startParagraph: number;
  endParagraph: number;
  startQuote: string;
  endQuote: string;
}

function extractClipSegments(
  paragraphs: TranscriptParagraph[],
  input: ClipTextInput,
) {
  const selected = paragraphs.filter(paragraph => (
    paragraph.paragraphNumber >= input.startParagraph && paragraph.paragraphNumber <= input.endParagraph
  ));
  if (selected.length === 0) throw new Error("切片段落范围无效");
  const first = selected[0];
  const last = selected.at(-1)!;
  if (!verifySourceQuote(paragraphs, first.paragraphNumber, input.startQuote)) {
    throw new Error("建议开始句无法在原文中唯一定位");
  }
  if (!verifySourceQuote(paragraphs, last.paragraphNumber, input.endQuote)) {
    throw new Error("建议结束句无法在原文中唯一定位");
  }
  const startIndex = first.text.indexOf(input.startQuote);
  const endIndex = last.text.indexOf(input.endQuote) + input.endQuote.length;
  if (first.paragraphNumber === last.paragraphNumber && endIndex <= startIndex) {
    throw new Error("建议开始句必须早于建议结束句");
  }
  return selected.map((paragraph, index) => ({
    paragraphNumber: paragraph.paragraphNumber,
    text: selected.length === 1
      ? paragraph.text.slice(startIndex, endIndex)
      : index === 0
        ? paragraph.text.slice(startIndex)
        : index === selected.length - 1
          ? paragraph.text.slice(0, endIndex)
          : paragraph.text,
  }));
}

export function extractClipText(
  paragraphs: TranscriptParagraph[],
  input: ClipTextInput,
) {
  return extractClipSegments(paragraphs, input).map(segment => segment.text).join("\n");
}

export function extractCleanedClipText(
  paragraphs: TranscriptParagraph[],
  input: ClipTextInput,
  removals: SourceRemovalSuggestion[],
) {
  const segments = extractClipSegments(paragraphs, input);
  const selectedNumbers = new Set(segments.map(segment => segment.paragraphNumber));
  if (removals.some(removal => !selectedNumbers.has(removal.paragraphNumber))) {
    throw new Error("删除片段超出切片段落范围");
  }
  return segments.map(segment => removeVerifiedQuotes(
    segment.text,
    removals.filter(removal => removal.paragraphNumber === segment.paragraphNumber),
    `第${segment.paragraphNumber}段切片`,
  ).trim()).filter(Boolean).join("\n");
}

function keywordSimilarity(a: string[], b: string[]) {
  const left = new Set(a.map(value => value.trim().toLowerCase()).filter(Boolean));
  const right = new Set(b.map(value => value.trim().toLowerCase()).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter(value => right.has(value)).length;
  return intersection / Math.min(left.size, right.size);
}

function rangeOverlap(a: TopicBlock, b: TopicBlock) {
  const intersection = Math.max(0, Math.min(a.endParagraph, b.endParagraph) - Math.max(a.startParagraph, b.startParagraph) + 1);
  const shorter = Math.min(a.endParagraph - a.startParagraph + 1, b.endParagraph - b.startParagraph + 1);
  return shorter > 0 ? intersection / shorter : 0;
}

function mergeTopicPair(left: TopicBlock, right: TopicBlock): TopicBlock {
  return {
    ...left,
    title: right.title.length > left.title.length ? right.title : left.title,
    summary: right.summary.length > left.summary.length ? right.summary : left.summary,
    mainPoint: right.mainPoint.length > left.mainPoint.length ? right.mainPoint : left.mainPoint,
    startParagraph: Math.min(left.startParagraph, right.startParagraph),
    endParagraph: Math.max(left.endParagraph, right.endParagraph),
    startTime: left.startTime ?? right.startTime,
    endTime: right.endTime ?? left.endTime,
    keywords: Array.from(new Set([...left.keywords, ...right.keywords])).slice(0, 8),
    sourceChunkIds: Array.from(new Set([...left.sourceChunkIds, ...right.sourceChunkIds])),
    candidateStatus: "pending",
    candidateError: null,
    candidateErrorReason: null,
  };
}

export function mergeAdjacentTopicBlocks(topicBlocks: TopicBlock[]) {
  const sorted = [...topicBlocks].sort((a, b) => a.startParagraph - b.startParagraph || a.endParagraph - b.endParagraph);
  const result: TopicBlock[] = [];
  for (const topic of sorted) {
    const previous = result.at(-1);
    if (!previous) {
      result.push(topic);
      continue;
    }
    const gap = topic.startParagraph - previous.endParagraph - 1;
    const shouldMerge = rangeOverlap(previous, topic) >= 0.5
      || (gap >= 0 && gap <= 2 && keywordSimilarity(previous.keywords, topic.keywords) >= 0.5);
    if (shouldMerge) result[result.length - 1] = mergeTopicPair(previous, topic);
    else result.push(topic);
  }
  return result;
}
