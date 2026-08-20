import { GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS } from "./knowledge-intake-limits";

export interface KnowledgeIntakeSegment {
  id: string;
  title: string;
  content: string;
  charCount: number;
  chapterTitles: string[];
}

export type KnowledgeIntakeSegmentationResult =
  | {
      status: "ready";
      segments: KnowledgeIntakeSegment[];
    }
  | {
      status: "manual_required";
      reason: "no_reliable_headings" | "section_too_long";
      message: string;
      segments: [];
    };

interface SourceSection {
  title: string;
  content: string;
}

function readMarkdownHeading(line: string): string | null {
  const match = line.match(/^ {0,3}#{1,6}[\t ]+(.+?)\s*#*\s*$/);
  return match?.[1]?.trim() || null;
}

function readChineseChapterHeading(line: string): string | null {
  const normalized = line.trim();
  if (normalized.length > 60) return null;
  return /^\u7b2c[\u96f6\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24\d]+[章节篇部讲课](?:[\t ]*[：:、.．—-]?[\t ]*).*$/.test(normalized)
    ? normalized
    : null;
}

function readChineseNumberedHeading(line: string): string | null {
  const normalized = line.trim();
  if (normalized.length > 60) return null;
  return /^(?:[\u96f6\u3007\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e24]+|[1-9]\d*)[、.．][\t ]*\S/.test(normalized)
    ? normalized
    : null;
}

function collectReliableHeadings(lines: string[]): Array<{ lineIndex: number; title: string }> {
  const markdownHeadings: Array<{ lineIndex: number; title: string }> = [];
  const chapterHeadings: Array<{ lineIndex: number; title: string }> = [];
  const numberedHeadings: Array<{ lineIndex: number; title: string }> = [];
  let fenceMarker: "`" | "~" | null = null;
  let fenceLength = 0;
  let inListBlock = false;

  for (const [lineIndex, line] of lines.entries()) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1]?.[0] as "`" | "~";
      const length = fence[1]?.length ?? 0;
      if (!fenceMarker) {
        fenceMarker = marker;
        fenceLength = length;
      } else if (marker === fenceMarker && length >= fenceLength) {
        fenceMarker = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMarker) continue;
    if (!line.trim()) {
      inListBlock = false;
      continue;
    }
    if (/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+\S/.test(line)) {
      inListBlock = true;
      continue;
    }
    if (inListBlock && /^ {2,}\S/.test(line)) continue;
    inListBlock = false;
    const markdownTitle = readMarkdownHeading(line);
    if (markdownTitle) {
      markdownHeadings.push({ lineIndex, title: markdownTitle });
      continue;
    }
    const chapterTitle = readChineseChapterHeading(line);
    if (chapterTitle) {
      chapterHeadings.push({ lineIndex, title: chapterTitle });
      continue;
    }
    const numberedTitle = readChineseNumberedHeading(line);
    if (numberedTitle) numberedHeadings.push({ lineIndex, title: numberedTitle });
  }

  if (markdownHeadings.length >= 2) return markdownHeadings;
  if (chapterHeadings.length >= 2) return chapterHeadings;
  if (numberedHeadings.length >= 2) return numberedHeadings;
  return [];
}

function buildSections(
  lines: string[],
  headings: Array<{ lineIndex: number; title: string }>,
): SourceSection[] {
  return headings.map((heading, index) => {
    const start = index === 0 ? 0 : heading.lineIndex;
    const end = headings[index + 1]?.lineIndex ?? lines.length;
    return {
      title: heading.title,
      content: lines.slice(start, end).join("\n").trim(),
    };
  });
}

function buildSegment(sections: SourceSection[], index: number): KnowledgeIntakeSegment {
  const chapterTitles = sections.map(section => section.title);
  const content = sections.map(section => section.content).join("\n").trim();
  return {
    id: `segment-${index + 1}`,
    title: chapterTitles.length === 1
      ? chapterTitles[0]!
      : `${chapterTitles[0]} 等${chapterTitles.length}个章节`,
    content,
    charCount: content.length,
    chapterTitles,
  };
}

export function segmentKnowledgeIntakeContent(
  source: string,
): KnowledgeIntakeSegmentationResult {
  const content = source.trim();
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const headings = collectReliableHeadings(lines);

  if (headings.length < 2) {
    return {
      status: "manual_required",
      reason: "no_reliable_headings",
      message: "未识别到可靠的章节结构，请按章节手动分段后导入",
      segments: [],
    };
  }

  const sections = buildSections(lines, headings);
  const oversizedSection = sections.find(
    section => section.content.length > GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS,
  );
  if (oversizedSection) {
    return {
      status: "manual_required",
      reason: "section_too_long",
      message: `章节「${oversizedSection.title}」超过4000字且没有可用的下一层边界，请先手动拆分该章节`,
      segments: [],
    };
  }

  const groupedSections: SourceSection[][] = [];
  let currentGroup: SourceSection[] = [];
  for (const section of sections) {
    const candidate = [...currentGroup, section];
    const candidateLength = candidate.map(item => item.content).join("\n").trim().length;
    if (currentGroup.length > 0 && candidateLength > GLOBAL_KNOWLEDGE_INTAKE_MAX_CHARS) {
      groupedSections.push(currentGroup);
      currentGroup = [section];
    } else {
      currentGroup = candidate;
    }
  }
  if (currentGroup.length > 0) groupedSections.push(currentGroup);

  return {
    status: "ready",
    segments: groupedSections.map(buildSegment),
  };
}
