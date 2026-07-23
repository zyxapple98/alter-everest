import { NextResponse } from "next/server";
import { validateCandidateShape } from "../../../lib/protocol";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = validateCandidateShape(payload);
    return NextResponse.json(result, { status: result.valid ? 200 : 422 });
  } catch {
    return NextResponse.json(
      { valid: false, errors: ["request body must be valid JSON"] },
      { status: 400 },
    );
  }
}
