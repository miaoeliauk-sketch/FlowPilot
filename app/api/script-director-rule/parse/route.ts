import { NextRequest, NextResponse } from "next/server";

import { DEEPSEEK_MODEL } from "@/lib/deepseek";
import {
  parseScriptDirectorRuleImportResponse,
  type ScriptDirectorRuleImportContext,
} from "@/lib/script-director-rule-import";
import { callStructuredDeepSeek, StructuredDeepSeekError } from "@/lib/structured-deepseek";

const MAX_IP_NAME_CHARS = 100;
const MAX_AUDIENCE_CHARS = 1_000;
const MAX_FILE_NAME_CHARS = 200;
const MAX_RULE_DOCUMENT_CHARS = 50_000;
const MAX_TOKENS = 8_000;

const SYSTEM_PROMPT = `你是FlowPilot的IP专属编导规则解析助手。你的任务是把用户提供的规则文档忠实整理成结构化JSON，不得补写文档中没有的IP观点或创作素材。

必须遵守：
1. 平台定位由IP档案提供，不要在输出中重复保存。
2. 每一条规则都必须有level、enforcement、scope。
3. level只能是hard_block、quality_warning、preference。
4. enforcement只能是deterministic、model_review、prompt_only。
5. scope只能是title、opening、body、ending、fact、attribution、compression、output。
6. maximumCasesPerClaim和targetReduction也必须带level、enforcement、scope；它们通常属于quality_warning和deterministic。
7. 示例只用于展示格式和语气，materialPermission必须为false，不得把示例人物、企业、事件当作后续创作素材。每个示例中的人物、企业、品牌和案例名称都必须逐项写入protectedEntities，不得遗漏。
8. 没有明确写出的规则使用空数组或null，不要猜测补全。
9. 只输出JSON对象，不要输出Markdown代码块、解释或系统字段。`;

function buildUserPrompt(ipName: string, audience: string, rawMarkdown: string): string {
  return `当前IP：${ipName}
IP档案中的目标受众：${audience || "未填写"}

【待解析规则文档】
${rawMarkdown}

严格输出以下顶层字段：
{
  "targetAudience": ["目标受众"],
  "language": {
    "catchphrases": [{"id":"唯一编号","text":"规则原文或忠实整理","level":"preference","enforcement":"prompt_only","scope":"body"}],
    "forbiddenExpressions": [],
    "toneGuidelines": []
  },
  "opening": {"requirements": [], "forbiddenPatterns": []},
  "body": {
    "reasoningSequence": [],
    "casePolicy": {"maximumCasesPerClaim": null, "level":"quality_warning", "enforcement":"deterministic", "scope":"body", "requirements": []},
    "materialPolicies": []
  },
  "ending": {"requirements": [], "forbiddenPatterns": []},
  "examples": [{"id":"唯一编号","kind":"title|opening|ending|body","content":"范例原文","demonstrates":"演示什么","sourceReference":"用户导入规则文档","confirmationStatus":"confirmed|unconfirmed","materialPermission":false,"protectedEntities":[]}],
  "compression": {
    "enabled": false,
    "targetReduction": null,
    "mustKeep": [],
    "preferRemove": [],
    "otherRequirements": []
  },
  "specialRules": [],
  "validationRequirements": []
}

所有规则数组中的条目都必须使用统一结构：
{"id":"唯一编号","text":"规则内容","level":"hard_block|quality_warning|preference","enforcement":"deterministic|model_review|prompt_only","scope":"允许的作用阶段"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestError(error: string, field?: string) {
  return NextResponse.json({
    code: "INVALID_REQUEST",
    error,
    ...(field ? { errorField: field } : {}),
    apiMeta: { apiCalled: false },
  }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return requestError("请求格式错误");
  }
  if (!isRecord(body)) return requestError("请求格式错误");
  if (!isRecord(body.ipProfile)) return requestError("请求格式错误", "ipProfile");

  const { id, name, audience } = body.ipProfile;
  if (typeof id !== "string" || !id.trim()) return requestError("请选择有效的IP", "ipProfile.id");
  if (typeof name !== "string" || !name.trim()) return requestError("请选择有效的IP", "ipProfile.name");
  if (name.trim().length > MAX_IP_NAME_CHARS) return requestError("IP名称过长", "ipProfile.name");
  if (typeof audience !== "string") return requestError("请求格式错误", "ipProfile.audience");
  if (audience.length > MAX_AUDIENCE_CHARS) return requestError("目标受众内容过长", "ipProfile.audience");
  if (typeof body.rawMarkdown !== "string" || !body.rawMarkdown.trim()) {
    return requestError("请上传或粘贴专属编导规则文档", "rawMarkdown");
  }
  if (body.rawMarkdown.length > MAX_RULE_DOCUMENT_CHARS) {
    return requestError(`规则文档最多${MAX_RULE_DOCUMENT_CHARS}字`, "rawMarkdown");
  }
  if (body.fileName !== null && typeof body.fileName !== "string") {
    return requestError("请求格式错误", "fileName");
  }
  if (typeof body.fileName === "string" && body.fileName.length > MAX_FILE_NAME_CHARS) {
    return requestError("文件名过长", "fileName");
  }

  const importedAt = new Date().toISOString();
  const context: ScriptDirectorRuleImportContext = {
    ipId: id.trim(),
    ipName: name.trim(),
    rawMarkdown: body.rawMarkdown,
    fileName: typeof body.fileName === "string" ? body.fileName : null,
    importedAt,
    version: "1.0.0",
  };

  try {
    const result = await callStructuredDeepSeek({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(context.ipName, audience.trim(), context.rawMarkdown),
      parse: content => parseScriptDirectorRuleImportResponse(content, context),
      buildParseRetryInstruction: failureCode => (
        failureCode === "INVALID_JSON"
          ? "上次不是合法JSON。请只输出一个完整JSON对象。"
          : "上次规则字段未通过契约。请补齐全部字段，并确保每条规则包含合法的level、enforcement、scope。"
      ),
      preserveParserErrorCode: true,
      rejectTruncatedOutput: true,
      apiKey: req.headers.get("X-DeepSeek-Key") ?? undefined,
      maxTokens: MAX_TOKENS,
      temperature: 0.1,
      timeoutMs: 60_000,
      maxRetries: 1,
    });
    return NextResponse.json({
      rule: result.data,
      apiMeta: {
        apiCalled: true,
        model: DEEPSEEK_MODEL,
        attempts: result.attempts,
        attemptDiagnostics: result.attemptDiagnostics,
      },
    });
  } catch (error) {
    if (error instanceof StructuredDeepSeekError) {
      const missingKey = error.attemptDiagnostics.some(item => item.failureCode === "MISSING_API_KEY");
      return NextResponse.json({
        code: missingKey ? "MISSING_API_KEY" : "RULE_PARSE_FAILED",
        error: missingKey
          ? "请先在设置中填写DeepSeek API Key"
          : "AI未能完整解析规则文档，已自动重试，请检查文档结构后再试",
        apiMeta: {
          apiCalled: !missingKey,
          model: DEEPSEEK_MODEL,
          attempts: error.attempts,
          attemptDiagnostics: error.attemptDiagnostics,
        },
      }, { status: missingKey ? 400 : 502 });
    }
    console.error("[script-director-rule-parse]", error);
    return NextResponse.json({
      code: "UNEXPECTED_ERROR",
      error: "规则解析失败，请稍后重试",
      apiMeta: { apiCalled: false },
    }, { status: 500 });
  }
}
