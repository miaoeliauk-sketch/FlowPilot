export type ScriptFactoryStage = "content" | "storyboard" | "execution";
export type PartialScriptFailedStage = Exclude<ScriptFactoryStage, "content">;
export type ScriptGenerationStatus = "complete" | "partial";

export interface ScriptPartialFailure {
  stage: PartialScriptFailedStage;
  errorCode: string;
  message: string;
}

export type ScriptQualityWarningCode =
  | "dense_closing_style"
  | "example_not_supporting_claim"
  | "analogy_mechanism_mismatch"
  | "correlation_as_causation";

export interface ScriptQualityWarning {
  category: "style" | "argument";
  code: ScriptQualityWarningCode;
  title: "表达待调整" | "论证待核对";
  sectionLabel: string;
  excerpt: string;
  message: string;
}

export interface ScriptQualityCheck {
  status: "passed" | "needs_review" | "unavailable";
  warnings: ScriptQualityWarning[];
  message?: string;
}
