import { NextResponse } from "next/server";
import {
  CANDIDATE_LIMITS,
  validateCandidateShape,
} from "../../../lib/protocol";

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > CANDIDATE_LIMITS.maximumBytes
    ) {
      return NextResponse.json(
        { valid: false, errors: ["request body is too large"] },
        { status: 413 },
      );
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CANDIDATE_LIMITS.maximumBytes) {
      return NextResponse.json(
        { valid: false, errors: ["request body is too large"] },
        { status: 413 },
      );
    }
    const payload = JSON.parse(text);
    const result = validateCandidateShape(payload);
    return NextResponse.json(result, { status: result.valid ? 200 : 422 });
  } catch {
    return NextResponse.json(
      { valid: false, errors: ["request body must be valid JSON"] },
      { status: 400 },
    );
  }
}
