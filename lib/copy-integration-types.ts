export interface CopyIntegrationSource {
  id: string;
  name: string;
  content: string;
  contentWeight?: number;
}

export interface CopyIntegrationNote {
  summary: string;
  sourceIds: string[];
}

export interface CopyIntegrationConflictAlternative {
  brief: string;
  text: string;
  sourceIds: string[];
}

export interface CopyIntegrationConflict {
  topic: string;
  conflictPoint: string;
  alternatives: CopyIntegrationConflictAlternative[];
}

export interface CopyIntegrationReviewItem extends CopyIntegrationNote {
  reason: string;
}

export interface CopyIntegrationParagraph {
  text: string;
  sourceIds: string[];
  exclusionCandidateIds?: string[];
}

export interface CopyIntegrationExclusionCandidate extends CopyIntegrationReviewItem {
  id: string;
}

export interface CopyIntegrationResult {
  draft: {
    sections: Array<{
      heading: string;
      paragraphs: CopyIntegrationParagraph[];
    }>;
    fullText: string;
  };
  decisionSummary: {
    items: string[];
  };
  conflicts: CopyIntegrationConflict[];
  exclusionCandidates: CopyIntegrationExclusionCandidate[];
  contentReview: {
    exclusions: CopyIntegrationReviewItem[];
    evidenceGaps: CopyIntegrationReviewItem[];
  };
}
