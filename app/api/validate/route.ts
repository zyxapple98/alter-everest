import { NextResponse } from "next/server";
import { validateExpedition } from "../../../lib/protocol";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = validateExpedition(payload);
    return NextResponse.json(result, { status: result.valid ? 200 : 422 });
  } catch {
    return NextResponse.json(
      { valid: false, errors: ["request body must be valid JSON"], steps: 0 },
      { status: 400 },
    );
  }
}

