import { NextRequest, NextResponse } from "next/server";
import { scanOneNow } from "@/lib/modAnalysis";

// A single mods forced rescan, asked for from the list — the one place the
// background job's own pace is not good enough: a person just installed or
// edited this exact mod and wants to see its tech level and suggestions land
// now, not whenever the corpus queue reaches it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    const path = String(body?.path ?? "").trim();
    if (!packageId || !path) {
      return NextResponse.json({ error: "packageId ou path manquant" }, { status: 400 });
    }

    const analysis = await scanOneNow(packageId, path);
    return NextResponse.json({ packageId, analysis });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
