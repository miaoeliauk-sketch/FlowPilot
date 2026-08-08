export type ContentMasterSegmentStatus = "正常" | "已归并" | "已拆分";

export interface ContentMasterSourceRef {
  id: string;
  name: string;
}

export interface ContentMasterSegment {
  id: string;
  heading: string;
  content: string;
  order: number;
  sourceIds: string[];
  status: ContentMasterSegmentStatus;
}

export interface ContentMaster {
  id: string;
  title: string;
  fullText: string;
  sources: ContentMasterSourceRef[];
  segments: ContentMasterSegment[];
  nextSegmentSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentMasterSectionInput {
  heading: string;
  paragraphs: string[];
  sourceIds: string[];
}

export interface CreateContentMasterInput {
  title: string;
  sections: ContentMasterSectionInput[];
  sources: ContentMasterSourceRef[];
}
