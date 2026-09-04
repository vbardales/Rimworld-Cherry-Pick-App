import { NextRequest, NextResponse } from "next/server";
import { listMods } from "@/lib/cherrypick";

// The active modlist, or everything installed. With more than five thousand mods
// on disk, filtering happens here and not in the browser.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "active";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);

  try {
    let mods = await listMods(scope);
    const total = mods.length;

    if (q) {
      mods = mods.filter(
        (m) =>
          m.Name.toLowerCase().includes(q) ||
          m.PackageId.toLowerCase().includes(q),
      );
    }
    const matched = mods.length;

    return NextResponse.json({ total, matched, mods: mods.slice(0, limit) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
