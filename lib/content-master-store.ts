import type {
  ContentMaster,
  ContentMasterSegment,
  CreateContentMasterInput,
} from "./content-master-types";

export const CONTENT_MASTER_STORAGE_KEY = "flowpilot:contentMasters:v1";

export interface ContentMasterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ContentMasterWriteLock {
  request<T>(name: string, operation: () => T): Promise<T>;
}

interface ContentMasterState {
  schemaVersion: 1;
  drafts: ContentMaster[];
  nextDraftSequenceByDate: Record<string, number>;
}

const EMPTY_STATE: ContentMasterState = {
  schemaVersion: 1,
  drafts: [],
  nextDraftSequenceByDate: {},
};

const DRAFT_ID_PATTERN = /^MG-(\d{8})-(\d{3,})$/;
const SEGMENT_STATUS_VALUES = new Set(["正常", "已归并", "已拆分"]);
const CONTENT_MASTER_WRITE_LOCK_NAME = `${CONTENT_MASTER_STORAGE_KEY}:write`;

const UNSUPPORTED_BROWSER_WRITE_LOCK: ContentMasterWriteLock = {
  request() {
    return Promise.reject(new Error("当前浏览器不支持安全保存母稿，请升级浏览器后重试"));
  },
};

function getBrowserWriteLock(): ContentMasterWriteLock | null {
  if (typeof window === "undefined") return null;
  if (typeof navigator === "undefined" || !navigator.locks) {
    return UNSUPPORTED_BROWSER_WRITE_LOCK;
  }
  return {
    request(name, operation) {
      return navigator.locks.request(name, operation);
    },
  };
}

export async function runWithContentMasterWriteLock<T>(
  lock: ContentMasterWriteLock | null | undefined,
  operation: () => T,
): Promise<T> {
  const targetLock = lock === undefined ? getBrowserWriteLock() : lock;
  if (!targetLock) return operation();
  return targetLock.request(CONTENT_MASTER_WRITE_LOCK_NAME, operation);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isStringMatrix(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(isStringArray);
}

function isContentMasterSource(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string";
}

function isContentMasterSegment(value: unknown, draftId: string): value is ContentMasterSegment {
  if (!isRecord(value)) return false;
  const segmentPrefix = `${draftId}-P`;
  const sequence = typeof value.id === "string" && value.id.startsWith(segmentPrefix)
    ? value.id.slice(segmentPrefix.length)
    : "";
  return /^\d{2,}$/.test(sequence)
    && typeof value.heading === "string"
    && typeof value.content === "string"
    && typeof value.order === "number"
    && Number.isFinite(value.order)
    && value.order > 0
    && isStringArray(value.sourceIds)
    && (value.paragraphSourceIds === undefined || isStringMatrix(value.paragraphSourceIds))
    && typeof value.status === "string"
    && SEGMENT_STATUS_VALUES.has(value.status);
}

function isContentMaster(value: unknown): value is ContentMaster {
  if (!isRecord(value) || typeof value.id !== "string" || !DRAFT_ID_PATTERN.test(value.id)) {
    return false;
  }
  const draftId = value.id;
  return typeof value.title === "string"
    && typeof value.fullText === "string"
    && Array.isArray(value.sources)
    && value.sources.every(isContentMasterSource)
    && Array.isArray(value.segments)
    && value.segments.every(segment => isContentMasterSegment(segment, draftId))
    && isPositiveInteger(value.nextSegmentSequence)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isContentMasterState(value: unknown): value is ContentMasterState {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Array.isArray(value.drafts)
    || !value.drafts.every(isContentMaster)
    || !isRecord(value.nextDraftSequenceByDate)
  ) {
    return false;
  }
  if (!Object.entries(value.nextDraftSequenceByDate).every(([dateKey, sequence]) =>
    /^\d{8}$/.test(dateKey) && isPositiveInteger(sequence))) {
    return false;
  }
  const draftIds = new Set<string>();
  const segmentIds = new Set<string>();
  for (const draft of value.drafts) {
    if (draftIds.has(draft.id)) return false;
    draftIds.add(draft.id);
    for (const segment of draft.segments) {
      if (segmentIds.has(segment.id)) return false;
      segmentIds.add(segment.id);
    }
  }
  return true;
}

export function assertValidContentMasterBackupData(value: unknown): void {
  if (!isContentMasterState(value)) {
    throw new Error("内容母稿备份数据格式异常，为避免覆盖现有数据，系统已停止恢复");
  }
}

function getBrowserStorage(): ContentMasterStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function requireStorage(storage: ContentMasterStorage | null): ContentMasterStorage {
  if (!storage) throw new Error("当前环境无法保存内容母稿");
  return storage;
}

function readState(storage: ContentMasterStorage): ContentMasterState {
  const raw = storage.getItem(CONTENT_MASTER_STORAGE_KEY);
  if (!raw) return { ...EMPTY_STATE, drafts: [], nextDraftSequenceByDate: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("内容母稿本地数据格式异常，为避免覆盖原数据，系统已停止写入");
  }
  if (!isContentMasterState(parsed)) {
    throw new Error("内容母稿本地数据格式异常，为避免覆盖原数据，系统已停止写入");
  }
  return parsed;
}

function writeState(storage: ContentMasterStorage, state: ContentMasterState): void {
  storage.setItem(CONTENT_MASTER_STORAGE_KEY, JSON.stringify(state));
}

function localDateKey(now: Date): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDraftId(dateKey: string, sequence: number): string {
  return `MG-${dateKey}-${String(sequence).padStart(3, "0")}`;
}

function formatSegmentId(draftId: string, sequence: number): string {
  return `${draftId}-P${String(sequence).padStart(2, "0")}`;
}

function nextAvailableDraftSequence(state: ContentMasterState, dateKey: string): number {
  const usedIds = new Set(state.drafts.map(draft => draft.id));
  const usedSequences = state.drafts.flatMap((draft) => {
    const match = DRAFT_ID_PATTERN.exec(draft.id);
    return match?.[1] === dateKey ? [Number(match[2])] : [];
  });
  let sequence = Math.max(
    state.nextDraftSequenceByDate[dateKey] ?? 1,
    usedSequences.length > 0 ? Math.max(...usedSequences) + 1 : 1,
  );
  while (usedIds.has(formatDraftId(dateKey, sequence))) sequence += 1;
  return sequence;
}

function nextAvailableSegmentSequences(draft: ContentMaster, count: number): number[] {
  const prefix = `${draft.id}-P`;
  const usedIds = new Set(draft.segments.map(segment => segment.id));
  const usedSequences = draft.segments.map(segment => Number(segment.id.slice(prefix.length)));
  let sequence = Math.max(
    draft.nextSegmentSequence,
    usedSequences.length > 0 ? Math.max(...usedSequences) + 1 : 1,
  );
  const available: number[] = [];
  while (available.length < count) {
    if (!usedIds.has(formatSegmentId(draft.id, sequence))) available.push(sequence);
    sequence += 1;
  }
  return available;
}

function requireSegment(segments: ContentMasterSegment[], id: string): ContentMasterSegment {
  const segment = segments.find(item => item.id === id);
  if (!segment) throw new Error("片段保存结果异常，请重试");
  return segment;
}

function buildFullText(segments: ContentMasterSegment[]): string {
  return segments
    .filter(segment => segment.status === "正常")
    .sort((first, second) => first.order - second.order)
    .map(segment => `## ${segment.heading}\n\n${segment.content}`)
    .join("\n\n");
}

interface ParagraphRange {
  start: number;
  end: number;
}

function contentParagraphRanges(content: string): ParagraphRange[] {
  const ranges: ParagraphRange[] = [];
  const separator = /\n{2,}/g;
  let start = 0;
  for (const match of content.matchAll(separator)) {
    const end = match.index ?? start;
    if (content.slice(start, end).trim()) ranges.push({ start, end });
    start = end + match[0].length;
  }
  if (content.slice(start).trim()) ranges.push({ start, end: content.length });
  return ranges;
}

function splitParagraphText(text: string): string[] {
  return text.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean);
}

function segmentParagraphSources(segment: ContentMasterSegment): string[][] {
  return contentParagraphRanges(segment.content)
    .map((_, index) => segment.paragraphSourceIds?.[index] ?? segment.sourceIds);
}

function paragraphSourcesForSlice(
  segment: ContentMasterSegment,
  sliceStart: number,
  sliceEnd: number,
): string[][] {
  const sources = segmentParagraphSources(segment);
  const result: string[][] = [];
  contentParagraphRanges(segment.content).forEach(({ start, end }, index) => {
    if (end > sliceStart && start < sliceEnd) result.push([...sources[index]]);
  });
  return result.length > 0 ? result : [[...segment.sourceIds]];
}

function updateContentMaster(
  id: string,
  storage: ContentMasterStorage,
  updater: (draft: ContentMaster) => ContentMaster,
): ContentMaster {
  const state = readState(storage);
  const index = state.drafts.findIndex(draft => draft.id === id);
  if (index < 0) throw new Error("没有找到这份内容母稿");
  const updated = updater(state.drafts[index]);
  const drafts = [...state.drafts];
  drafts[index] = updated;
  writeState(storage, { ...state, drafts });
  return updated;
}

function normalizeActiveOrders(segments: ContentMasterSegment[]): ContentMasterSegment[] {
  const activeOrderById = new Map(
    segments
      .filter(segment => segment.status === "正常")
      .sort((first, second) => first.order - second.order)
      .map((segment, index) => [segment.id, index + 1]),
  );
  return segments.map(segment => activeOrderById.has(segment.id)
    ? { ...segment, order: activeOrderById.get(segment.id) ?? segment.order }
    : segment);
}

function createContentMasterUnlocked(
  input: CreateContentMasterInput,
  storage: ContentMasterStorage | null,
  now = new Date(),
): ContentMaster {
  const targetStorage = requireStorage(storage);
  const state = readState(targetStorage);
  const dateKey = localDateKey(now);
  const draftSequence = nextAvailableDraftSequence(state, dateKey);

  // 本地存储阶段只保证同一份本地数据集内按日不重复。
  // 未来接入数据库后，必须改用服务端事务重新设计跨设备全局唯一编号。
  const id = formatDraftId(dateKey, draftSequence);
  if (state.drafts.some(draft => draft.id === id)) {
    throw new Error("母稿编号发生冲突，请刷新页面后重试");
  }
  const segments = input.sections.map((section, index): ContentMasterSegment => {
    const paragraphs = section.paragraphs
      .flatMap(paragraph => {
        const text = typeof paragraph === "string" ? paragraph : paragraph.text;
        const sourceIds = typeof paragraph === "string" ? section.sourceIds : paragraph.sourceIds;
        return splitParagraphText(text).map(item => ({ text: item, sourceIds }));
      })
      .filter(paragraph => Boolean(paragraph.text));
    const paragraphSourceIds = paragraphs.map(paragraph => Array.from(new Set(paragraph.sourceIds)));
    return {
      id: formatSegmentId(id, index + 1),
      heading: section.heading.trim(),
      content: paragraphs.map(paragraph => paragraph.text).join("\n\n"),
      order: index + 1,
      sourceIds: Array.from(new Set(paragraphSourceIds.flat())),
      paragraphSourceIds,
      status: "正常",
    };
  });
  const timestamp = now.toISOString();
  const draft: ContentMaster = {
    id,
    title: input.title.trim(),
    fullText: buildFullText(segments),
    sources: input.sources.map(source => ({ id: source.id, name: source.name })),
    segments,
    nextSegmentSequence: segments.length + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeState(targetStorage, {
    schemaVersion: 1,
    drafts: [...state.drafts, draft],
    nextDraftSequenceByDate: {
      ...state.nextDraftSequenceByDate,
      [dateKey]: draftSequence + 1,
    },
  });
  return draft;
}

export function createContentMaster(
  input: CreateContentMasterInput,
  storage: ContentMasterStorage | null = getBrowserStorage(),
  now = new Date(),
  lock: ContentMasterWriteLock | null = getBrowserWriteLock(),
): Promise<ContentMaster> {
  return runWithContentMasterWriteLock(lock, () => createContentMasterUnlocked(input, storage, now));
}

export function getContentMaster(
  id: string,
  storage: ContentMasterStorage | null = getBrowserStorage(),
): ContentMaster | null {
  const targetStorage = requireStorage(storage);
  return readState(targetStorage).drafts.find(draft => draft.id === id) ?? null;
}

export function getContentMasterSegment(
  segmentId: string,
  storage: ContentMasterStorage | null = getBrowserStorage(),
): ContentMasterSegment | null {
  const targetStorage = requireStorage(storage);
  for (const draft of readState(targetStorage).drafts) {
    const segment = draft.segments.find(item => item.id === segmentId);
    if (segment) return segment;
  }
  return null;
}

export function getActiveContentMasterSegments(
  draftId: string,
  storage: ContentMasterStorage | null = getBrowserStorage(),
): ContentMasterSegment[] {
  const draft = getContentMaster(draftId, storage);
  if (!draft) return [];
  return draft.segments
    .filter(segment => segment.status === "正常")
    .sort((first, second) => first.order - second.order);
}

function renameContentMasterSegmentUnlocked(
  draftId: string,
  segmentId: string,
  heading: string,
  storage: ContentMasterStorage | null,
  now = new Date(),
): ContentMasterSegment {
  const targetStorage = requireStorage(storage);
  const cleanHeading = heading.trim();
  if (!cleanHeading) throw new Error("片段小标题不能为空");
  const updated = updateContentMaster(draftId, targetStorage, (draft) => {
    const current = draft.segments.find(segment => segment.id === segmentId);
    if (!current || current.status !== "正常") throw new Error("没有找到可修改的当前片段");
    const segments = draft.segments.map(segment => segment.id === segmentId
      ? { ...segment, heading: cleanHeading }
      : segment);
    return {
      ...draft,
      segments,
      fullText: buildFullText(segments),
      updatedAt: now.toISOString(),
    };
  });
  return requireSegment(updated.segments, segmentId);
}

export function renameContentMasterSegment(
  draftId: string,
  segmentId: string,
  heading: string,
  storage: ContentMasterStorage | null = getBrowserStorage(),
  now = new Date(),
  lock: ContentMasterWriteLock | null = getBrowserWriteLock(),
): Promise<ContentMasterSegment> {
  return runWithContentMasterWriteLock(lock, () =>
    renameContentMasterSegmentUnlocked(draftId, segmentId, heading, storage, now));
}

function mergeAdjacentContentMasterSegmentsUnlocked(
  draftId: string,
  firstSegmentId: string,
  secondSegmentId: string,
  heading: string,
  storage: ContentMasterStorage | null,
  now = new Date(),
): ContentMasterSegment {
  const targetStorage = requireStorage(storage);
  const cleanHeading = heading.trim();
  if (!cleanHeading) throw new Error("合并后的片段小标题不能为空");

  const updated = updateContentMaster(draftId, targetStorage, (draft) => {
    const active = draft.segments
      .filter(segment => segment.status === "正常")
      .sort((first, second) => first.order - second.order);
    const firstIndex = active.findIndex(segment => segment.id === firstSegmentId);
    if (firstIndex < 0 || active[firstIndex + 1]?.id !== secondSegmentId) {
      throw new Error("只能合并相邻的当前片段");
    }
    const first = active[firstIndex];
    const second = active[firstIndex + 1];
    const [mergedSequence] = nextAvailableSegmentSequences(draft, 1);
    const mergedId = formatSegmentId(draft.id, mergedSequence);
    const merged: ContentMasterSegment = {
      id: mergedId,
      heading: cleanHeading,
      content: `${first.content}\n\n${second.content}`,
      order: first.order,
      sourceIds: Array.from(new Set([...first.sourceIds, ...second.sourceIds])),
      paragraphSourceIds: [
        ...segmentParagraphSources(first),
        ...segmentParagraphSources(second),
      ],
      status: "正常",
    };
    const segments = normalizeActiveOrders([
      ...draft.segments.map(segment =>
        segment.id === firstSegmentId || segment.id === secondSegmentId
          ? { ...segment, status: "已归并" as const }
          : segment),
      merged,
    ]);
    return {
      ...draft,
      segments,
      nextSegmentSequence: mergedSequence + 1,
      fullText: buildFullText(segments),
      updatedAt: now.toISOString(),
    };
  });
  return requireSegment(updated.segments, formatSegmentId(draftId, updated.nextSegmentSequence - 1));
}

export function mergeAdjacentContentMasterSegments(
  draftId: string,
  firstSegmentId: string,
  secondSegmentId: string,
  heading: string,
  storage: ContentMasterStorage | null = getBrowserStorage(),
  now = new Date(),
  lock: ContentMasterWriteLock | null = getBrowserWriteLock(),
): Promise<ContentMasterSegment> {
  return runWithContentMasterWriteLock(lock, () => mergeAdjacentContentMasterSegmentsUnlocked(
    draftId,
    firstSegmentId,
    secondSegmentId,
    heading,
    storage,
    now,
  ));
}

function splitContentMasterSegmentUnlocked(
  draftId: string,
  segmentId: string,
  splitAt: number,
  headings: [string, string],
  storage: ContentMasterStorage | null,
  now = new Date(),
): [ContentMasterSegment, ContentMasterSegment] {
  const targetStorage = requireStorage(storage);
  const cleanHeadings = headings.map(heading => heading.trim()) as [string, string];
  if (cleanHeadings.some(heading => !heading)) throw new Error("拆分后的片段小标题不能为空");
  let createdIds: [string, string] = ["", ""];

  const updated = updateContentMaster(draftId, targetStorage, (draft) => {
    const current = draft.segments.find(segment => segment.id === segmentId);
    if (!current || current.status !== "正常") throw new Error("没有找到可拆分的当前片段");
    if (!Number.isInteger(splitAt) || splitAt <= 0 || splitAt >= current.content.length) {
      throw new Error("请把拆分位置放在片段正文中间");
    }
    const firstContent = current.content.slice(0, splitAt).trim();
    const secondContent = current.content.slice(splitAt).trim();
    if (!firstContent || !secondContent) throw new Error("拆分后的两个片段都必须有正文");

    const createdSequences = nextAvailableSegmentSequences(draft, 2);
    createdIds = createdSequences.map(sequence => formatSegmentId(draft.id, sequence)) as [string, string];
    const firstParagraphSourceIds = paragraphSourcesForSlice(current, 0, splitAt);
    const secondParagraphSourceIds = paragraphSourcesForSlice(current, splitAt, current.content.length);
    const first: ContentMasterSegment = {
      id: createdIds[0],
      heading: cleanHeadings[0],
      content: firstContent,
      order: current.order,
      sourceIds: Array.from(new Set(firstParagraphSourceIds.flat())),
      paragraphSourceIds: firstParagraphSourceIds,
      status: "正常",
    };
    const second: ContentMasterSegment = {
      id: createdIds[1],
      heading: cleanHeadings[1],
      content: secondContent,
      order: current.order + 0.5,
      sourceIds: Array.from(new Set(secondParagraphSourceIds.flat())),
      paragraphSourceIds: secondParagraphSourceIds,
      status: "正常",
    };
    const segments = normalizeActiveOrders([
      ...draft.segments.map(segment => segment.id === segmentId
        ? { ...segment, status: "已拆分" as const }
        : segment),
      first,
      second,
    ]);
    return {
      ...draft,
      segments,
      nextSegmentSequence: createdSequences[1] + 1,
      fullText: buildFullText(segments),
      updatedAt: now.toISOString(),
    };
  });
  return [
    requireSegment(updated.segments, createdIds[0]),
    requireSegment(updated.segments, createdIds[1]),
  ];
}

export function splitContentMasterSegment(
  draftId: string,
  segmentId: string,
  splitAt: number,
  headings: [string, string],
  storage: ContentMasterStorage | null = getBrowserStorage(),
  now = new Date(),
  lock: ContentMasterWriteLock | null = getBrowserWriteLock(),
): Promise<[ContentMasterSegment, ContentMasterSegment]> {
  return runWithContentMasterWriteLock(lock, () => splitContentMasterSegmentUnlocked(
    draftId,
    segmentId,
    splitAt,
    headings,
    storage,
    now,
  ));
}
