import { NextRequest, NextResponse } from "next/server";
import { setActive } from "@/lib/cherrypick";

// Turns one mod on or off in ModsConfig.xml — the same file RimSort and the
// game's own mod list write. Nothing here decides load order: a mod switched on
// lands at the end, exactly where RimWorld and RimSort both put a freshly
// ticked one, and reordering stays their job, not this tool's.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    const on = Boolean(body?.on);
    if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });

    await setActive(packageId, on);
    return NextResponse.json({ packageId, active: on });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
