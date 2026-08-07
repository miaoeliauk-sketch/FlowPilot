export interface CopyIntegrationSource {
  id: string;
  name: string;
  content: string;
}

export interface CopyIntegrationNote {
  summary: string;
  sourceIds: string[];
}

export interface CopyIntegrationConflictAlternative {
  text: string;
  sourceIds: string[];
}

export interface CopyIntegrationResult {
  draft: {
    sections: Array<{
      heading: string;
      paragraphs: string[];
      sourceIds: string[];
    }>;
    fullText: string;
  };
  integrationNotes: {
    mergedDuplicates: CopyIntegrationNote[];
    conflicts: Array<{
      summary: string;
      alternatives: CopyIntegrationConflictAlternative[];
    }>;
    exclusions: Array<CopyIntegrationNote & { reason: string }>;
  };
}
