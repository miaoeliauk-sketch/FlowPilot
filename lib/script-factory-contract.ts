export type ScriptFactoryStage = "content" | "storyboard" | "execution";
export type PartialScriptFailedStage = Exclude<ScriptFactoryStage, "content">;
export type ScriptGenerationStatus = "complete" | "partial";

export interface ScriptPartialFailure {
  stage: PartialScriptFailedStage;
  errorCode: string;
  message: string;
}
