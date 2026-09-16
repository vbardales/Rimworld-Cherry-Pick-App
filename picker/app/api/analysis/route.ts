import { NextResponse } from "next/server";
import { ensureJobStarted, jobStatus, readAnalysisStore } from "@/lib/modAnalysis";

// The background scan's results, read as they stand — never awaited into
// existence here. ensureJobStarted() is a no-op after the first call in the
// process's life; the actual scanning runs on its own clock, well outside this
// request.
export async function GET() {
  ensureJobStarted();
  try {
    const mods = await readAnalysisStore();
    return NextResponse.json({ mods, job: jobStatus() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
