import { NextRequest, NextResponse } from "next/server";

import { getEmotionalCoercionConstraintStatus, GlobalConstraintServerError } from "@/lib/global-content-constraint-server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(await getEmotionalCoercionConstraintStatus());
  } catch (error) {
    if (error instanceof GlobalConstraintServerError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "服务端规则状态读取失败", code: "STATUS_READ_FAILED" }, { status: 500 });
  }
}
