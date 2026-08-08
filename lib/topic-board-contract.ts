export const TOPIC_BOARD_CONTRACT_VERSION = 1 as const;

export interface TopicBoardDimension {
  label: string;
  score: number;
  max: number;
}

export interface TopicBoardExpert {
  role: string;
  color: string;
  weight: number;
  observation: string;
  reasoning: string;
  conclusion: string;
  initialScore: number;
  finalScore: number;
  scoreChange: number;
  dimData: {
    dims: TopicBoardDimension[];
    formula: string;
    computed: number;
  };
  vote: string;
  veto: boolean;
  vetoReason: string | null;
}

export interface TopicBoardResult {
  contractVersion: typeof TOPIC_BOARD_CONTRACT_VERSION;
  topic: string;
  ipId: string;
  ipName: string;
  experts: TopicBoardExpert[];
  chiefOfficer: {
    role: string;
    reasons: string[];
    riskLevel: string;
    failProbability: number;
    dismissalSuggestion: string;
  };
  challenges: Array<{
    from: string;
    to: string;
    targetScore: number;
    challenge: string;
    affectedDimension: string;
    impact: string;
  }>;
  responses: Array<{
    role: string;
    challenge: string | null;
    response: string;
    initialScore: number;
    finalScore: number;
    scoreChange: number;
    finalFormula: string;
  }>;
  votes: Array<{ role: string; vote: string }>;
  voteResult: {
    supportCount: number;
    reserveCount: number;
    opposeCount: number;
    verdict: string;
  };
  safetyVeto: boolean;
  safetyVetoReason: string | null;
  weights: Array<{
    role: string;
    score: number;
    weight: number;
    contribution: number;
  }>;
  totalScore: number;
  level: string;
  finalRecommendation: string;
  scoreDisplay: string;
  beginnerAdvice: {
    canDo: string;
    why: string;
    biggestProblem: string;
    howToImprove: string;
    shouldTest: string;
  };
  confidenceNotice: string;
  riskLevel: "低" | "中" | "高";
  riskExplanation: string;
  scoreBreakdown: Array<{
    label: string;
    score: number;
    explanation: string;
  }>;
  dataEvidence: {
    matchedHighPerformance: boolean;
    matchedCount: number;
    items: Array<{
      id: string;
      title: string;
      source: string;
      metricsText: string;
      matchReason: string;
      performanceLevel: string;
    }>;
    impact: string;
    debugMessage: string;
    calibration: {
      highCount: number;
      mediumCount: number;
      lowCount: number;
      matchedCount: number;
      dominant: "high" | "medium" | "low" | "mixed" | "none";
      hasConflict: boolean;
      topMatchScore: number;
    };
  };
  knowledgeDiagnosis: {
    matched: boolean;
    reason: string;
    nextStep: string;
  };
  scoringBasis: {
    knowledgeRules: string[];
    historicalData: string[];
    ipInfo: string[];
    positiveFactors: string[];
    negativeFactors: string[];
  };
  optimizationPlan: {
    coreReason: string;
    keepParts: string[];
    weakenParts: string[];
    rewrittenDirections: string[];
    retestSuggestion: string;
  };
  credScore: number;
  credReasons: string[];
  risks: string[];
  upgradedTopics: string[];
  titles: string[];
  personaPreview: {
    personaReactions: Array<{
      personaName: string;
      wouldClick: string;
      wouldUnderstand: string;
      wouldSave: string;
      wouldComment: string;
      wouldPay: string;
      howToPresent: string;
      mainConcern: string;
    }>;
    mostInterestedPersona: string;
    leastInterestedPersona?: string;
    biggestConcern: string;
    mostLikelyComment: string;
    mostLikelyToSave: string;
    conversionOpportunity: string;
  } | null;
  hasPersonas: boolean;
}

export interface TopicEvaluationSummary {
  evaluatedAt: string;
  totalScore: number;
  scoreDisplay: string;
  level: string;
  finalRecommendation: string;
  verdict: string;
  riskLevel: "低" | "中" | "高";
  safetyVeto: boolean;
  confidenceNotice: string;
}

export class TopicBoardContractError extends Error {
  readonly code: "INVALID_ROOT" | "UNSUPPORTED_VERSION" | "MISSING_FIELD" | "INVALID_FIELD";
  readonly field: string;

  constructor(
    code: TopicBoardContractError["code"],
    field: string,
    message: string,
  ) {
    super(message);
    this.name = "TopicBoardContractError";
    this.code = code;
    this.field = field;
  }
}

type ContractObject = Record<string, unknown>;

function contractObject(value: unknown, field: string): ContractObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是对象`);
  }
  return value as ContractObject;
}

function contractField(object: ContractObject, key: string, parent = ""): unknown {
  const field = parent ? `${parent}.${key}` : key;
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw new TopicBoardContractError("MISSING_FIELD", field, `缺少字段${field}`);
  }
  return object[key];
}

function contractString(value: unknown, field: string, nonEmpty = false): void {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是${nonEmpty ? "非空" : ""}字符串`);
  }
}

function contractNumber(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是有效数字`);
  }
}

function contractBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是布尔值`);
  }
}

function contractNullableString(value: unknown, field: string): void {
  if (value !== null && typeof value !== "string") {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是字符串或null`);
  }
}

function contractArray(
  value: unknown,
  field: string,
  validateItem: (item: unknown, itemField: string) => void,
): void {
  if (!Array.isArray(value)) {
    throw new TopicBoardContractError("INVALID_FIELD", field, `${field}必须是数组`);
  }
  value.forEach((item, index) => validateItem(item, `${field}[${index}]`));
}

function contractStringArray(value: unknown, field: string): void {
  contractArray(value, field, contractString);
}

function validateExpert(value: unknown, field: string): void {
  const expert = contractObject(value, field);
  for (const key of ["role", "color", "observation", "reasoning", "conclusion", "vote"] as const) {
    contractString(contractField(expert, key, field), `${field}.${key}`);
  }
  for (const key of ["weight", "initialScore", "finalScore", "scoreChange"] as const) {
    contractNumber(contractField(expert, key, field), `${field}.${key}`);
  }
  contractBoolean(contractField(expert, "veto", field), `${field}.veto`);
  contractNullableString(contractField(expert, "vetoReason", field), `${field}.vetoReason`);

  const dimDataField = `${field}.dimData`;
  const dimData = contractObject(contractField(expert, "dimData", field), dimDataField);
  contractString(contractField(dimData, "formula", dimDataField), `${dimDataField}.formula`);
  contractNumber(contractField(dimData, "computed", dimDataField), `${dimDataField}.computed`);
  contractArray(contractField(dimData, "dims", dimDataField), `${dimDataField}.dims`, (item, itemField) => {
    const dim = contractObject(item, itemField);
    contractString(contractField(dim, "label", itemField), `${itemField}.label`);
    contractNumber(contractField(dim, "score", itemField), `${itemField}.score`);
    contractNumber(contractField(dim, "max", itemField), `${itemField}.max`);
  });
}

function validatePersonaPreview(value: unknown, field: string): void {
  if (value === null) return;
  const preview = contractObject(value, field);
  contractArray(contractField(preview, "personaReactions", field), `${field}.personaReactions`, (item, itemField) => {
    const reaction = contractObject(item, itemField);
    for (const key of [
      "personaName",
      "wouldClick",
      "wouldUnderstand",
      "wouldSave",
      "wouldComment",
      "wouldPay",
      "howToPresent",
      "mainConcern",
    ] as const) {
      contractString(contractField(reaction, key, itemField), `${itemField}.${key}`);
    }
  });
  for (const key of [
    "mostInterestedPersona",
    "biggestConcern",
    "mostLikelyComment",
    "mostLikelyToSave",
    "conversionOpportunity",
  ] as const) {
    contractString(contractField(preview, key, field), `${field}.${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(preview, "leastInterestedPersona")) {
    contractString(preview.leastInterestedPersona, `${field}.leastInterestedPersona`);
  }
}

export function parseTopicBoardResult(value: unknown): TopicBoardResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TopicBoardContractError("INVALID_ROOT", "$", "选题董事会结果必须是对象");
  }
  const result = value as Record<string, unknown>;
  if (result.contractVersion !== TOPIC_BOARD_CONTRACT_VERSION) {
    throw new TopicBoardContractError(
      "UNSUPPORTED_VERSION",
      "contractVersion",
      "选题董事会结果版本不受支持",
    );
  }

  for (const key of [
    "topic",
    "ipId",
    "ipName",
    "level",
    "finalRecommendation",
    "scoreDisplay",
    "confidenceNotice",
    "riskExplanation",
  ] as const) {
    contractString(contractField(result, key), key, key === "topic" || key === "ipId" || key === "ipName");
  }
  contractNumber(contractField(result, "totalScore"), "totalScore");
  contractNumber(contractField(result, "credScore"), "credScore");
  contractBoolean(contractField(result, "safetyVeto"), "safetyVeto");
  contractNullableString(contractField(result, "safetyVetoReason"), "safetyVetoReason");
  contractBoolean(contractField(result, "hasPersonas"), "hasPersonas");

  const riskLevel = contractField(result, "riskLevel");
  if (riskLevel !== "低" && riskLevel !== "中" && riskLevel !== "高") {
    throw new TopicBoardContractError("INVALID_FIELD", "riskLevel", "riskLevel必须是低、中或高");
  }

  contractArray(contractField(result, "experts"), "experts", validateExpert);

  const chief = contractObject(contractField(result, "chiefOfficer"), "chiefOfficer");
  for (const key of ["role", "riskLevel", "dismissalSuggestion"] as const) {
    contractString(contractField(chief, key, "chiefOfficer"), `chiefOfficer.${key}`);
  }
  contractStringArray(contractField(chief, "reasons", "chiefOfficer"), "chiefOfficer.reasons");
  contractNumber(contractField(chief, "failProbability", "chiefOfficer"), "chiefOfficer.failProbability");

  contractArray(contractField(result, "challenges"), "challenges", (item, field) => {
    const challenge = contractObject(item, field);
    for (const key of ["from", "to", "challenge", "affectedDimension", "impact"] as const) {
      contractString(contractField(challenge, key, field), `${field}.${key}`);
    }
    contractNumber(contractField(challenge, "targetScore", field), `${field}.targetScore`);
  });

  contractArray(contractField(result, "responses"), "responses", (item, field) => {
    const response = contractObject(item, field);
    for (const key of ["role", "response", "finalFormula"] as const) {
      contractString(contractField(response, key, field), `${field}.${key}`);
    }
    contractNullableString(contractField(response, "challenge", field), `${field}.challenge`);
    for (const key of ["initialScore", "finalScore", "scoreChange"] as const) {
      contractNumber(contractField(response, key, field), `${field}.${key}`);
    }
  });

  contractArray(contractField(result, "votes"), "votes", (item, field) => {
    const vote = contractObject(item, field);
    contractString(contractField(vote, "role", field), `${field}.role`);
    contractString(contractField(vote, "vote", field), `${field}.vote`);
  });

  const voteResult = contractObject(contractField(result, "voteResult"), "voteResult");
  for (const key of ["supportCount", "reserveCount", "opposeCount"] as const) {
    contractNumber(contractField(voteResult, key, "voteResult"), `voteResult.${key}`);
  }
  contractString(contractField(voteResult, "verdict", "voteResult"), "voteResult.verdict");

  contractArray(contractField(result, "weights"), "weights", (item, field) => {
    const weight = contractObject(item, field);
    contractString(contractField(weight, "role", field), `${field}.role`);
    for (const key of ["score", "weight", "contribution"] as const) {
      contractNumber(contractField(weight, key, field), `${field}.${key}`);
    }
  });

  const beginnerAdvice = contractObject(contractField(result, "beginnerAdvice"), "beginnerAdvice");
  for (const key of ["canDo", "why", "biggestProblem", "howToImprove", "shouldTest"] as const) {
    contractString(contractField(beginnerAdvice, key, "beginnerAdvice"), `beginnerAdvice.${key}`);
  }

  contractArray(contractField(result, "scoreBreakdown"), "scoreBreakdown", (item, field) => {
    const score = contractObject(item, field);
    contractString(contractField(score, "label", field), `${field}.label`);
    contractNumber(contractField(score, "score", field), `${field}.score`);
    contractString(contractField(score, "explanation", field), `${field}.explanation`);
  });

  const evidence = contractObject(contractField(result, "dataEvidence"), "dataEvidence");
  contractBoolean(contractField(evidence, "matchedHighPerformance", "dataEvidence"), "dataEvidence.matchedHighPerformance");
  contractNumber(contractField(evidence, "matchedCount", "dataEvidence"), "dataEvidence.matchedCount");
  contractString(contractField(evidence, "impact", "dataEvidence"), "dataEvidence.impact");
  contractString(contractField(evidence, "debugMessage", "dataEvidence"), "dataEvidence.debugMessage");
  contractArray(contractField(evidence, "items", "dataEvidence"), "dataEvidence.items", (item, field) => {
    const evidenceItem = contractObject(item, field);
    for (const key of ["id", "title", "source", "metricsText", "matchReason", "performanceLevel"] as const) {
      contractString(contractField(evidenceItem, key, field), `${field}.${key}`);
    }
  });
  const calibration = contractObject(contractField(evidence, "calibration", "dataEvidence"), "dataEvidence.calibration");
  for (const key of ["highCount", "mediumCount", "lowCount", "matchedCount", "topMatchScore"] as const) {
    contractNumber(contractField(calibration, key, "dataEvidence.calibration"), `dataEvidence.calibration.${key}`);
  }
  contractBoolean(contractField(calibration, "hasConflict", "dataEvidence.calibration"), "dataEvidence.calibration.hasConflict");
  const dominant = contractField(calibration, "dominant", "dataEvidence.calibration");
  if (
    typeof dominant !== "string"
    || !["high", "medium", "low", "mixed", "none"].includes(dominant)
  ) {
    throw new TopicBoardContractError("INVALID_FIELD", "dataEvidence.calibration.dominant", "校准主导类型不合法");
  }

  const diagnosis = contractObject(contractField(result, "knowledgeDiagnosis"), "knowledgeDiagnosis");
  contractBoolean(contractField(diagnosis, "matched", "knowledgeDiagnosis"), "knowledgeDiagnosis.matched");
  for (const key of ["reason", "nextStep"] as const) {
    contractString(contractField(diagnosis, key, "knowledgeDiagnosis"), `knowledgeDiagnosis.${key}`);
  }

  const basis = contractObject(contractField(result, "scoringBasis"), "scoringBasis");
  for (const key of ["knowledgeRules", "historicalData", "ipInfo", "positiveFactors", "negativeFactors"] as const) {
    contractStringArray(contractField(basis, key, "scoringBasis"), `scoringBasis.${key}`);
  }

  const plan = contractObject(contractField(result, "optimizationPlan"), "optimizationPlan");
  contractString(contractField(plan, "coreReason", "optimizationPlan"), "optimizationPlan.coreReason");
  contractString(contractField(plan, "retestSuggestion", "optimizationPlan"), "optimizationPlan.retestSuggestion");
  for (const key of ["keepParts", "weakenParts", "rewrittenDirections"] as const) {
    contractStringArray(contractField(plan, key, "optimizationPlan"), `optimizationPlan.${key}`);
  }

  for (const key of ["credReasons", "risks", "upgradedTopics", "titles"] as const) {
    contractStringArray(contractField(result, key), key);
  }
  validatePersonaPreview(contractField(result, "personaPreview"), "personaPreview");

  return value as TopicBoardResult;
}

export function createTopicEvaluationSummary(
  result: TopicBoardResult,
  evaluatedAt: string,
): TopicEvaluationSummary {
  return {
    evaluatedAt,
    totalScore: result.totalScore,
    scoreDisplay: result.scoreDisplay,
    level: result.level,
    finalRecommendation: result.finalRecommendation,
    verdict: result.voteResult.verdict,
    riskLevel: result.riskLevel,
    safetyVeto: result.safetyVeto,
    confidenceNotice: result.confidenceNotice,
  };
}
