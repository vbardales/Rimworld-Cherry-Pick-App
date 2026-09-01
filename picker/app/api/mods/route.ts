import { NextRequest, NextResponse } from "next/server";
import { listMods } from "@/lib/cherrypick";

// La modlist active, ou tout ce qui est installe. Avec plus de cinq mille mods
// sur disque, le filtrage se fait ici et non dans le navigateur.
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
