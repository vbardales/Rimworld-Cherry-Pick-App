import { NextRequest, NextResponse } from "next/server";
import { GONE_MESSAGE, isGone, isUnderAllowedRoot } from "@/lib/cherrypick";
import { analysisOf, ensureJobStarted, jobStatus, readAnalysisStore, scanOneNow } from "@/lib/modAnalysis";
import { ANALYSIS_RULE_VERSION } from "@/lib/techLevels";

// The background scan's results, read as they stand — never awaited into
// existence here. ensureJobStarted() is a no-op after the first call in the
// process's life; the actual scanning runs on its own clock, well outside this
// request.
//
// With ?packageId and ?path, one mod only — and brought up to date on the spot
// when its analysis is missing or was computed under older rules. A mod sheet
// is one mod: waiting for the corpus job to come round, after a rule change
// that restarted it, would show an outdated or empty guess.
export async function GET(req: NextRequest) {
  ensureJobStarted();
  const packageId = (req.nextUrl.searchParams.get("packageId") ?? "").trim();
  const modPath = (req.nextUrl.searchParams.get("path") ?? "").trim();
  try {
    if (!packageId) return NextResponse.json({ mods: await readAnalysisStore(), job: jobStatus() });

    const current = analysisOf(await readAnalysisStore(), packageId);
    if (current && current.ruleVersion === ANALYSIS_RULE_VERSION) return NextResponse.json({ analysis: current });
    if (!modPath || !isUnderAllowedRoot(modPath)) return NextResponse.json({ analysis: current ?? null });
    if (await isGone(modPath)) return NextResponse.json({ error: GONE_MESSAGE }, { status: 404 });
    return NextResponse.json({ analysis: await scanOneNow(packageId, modPath) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
