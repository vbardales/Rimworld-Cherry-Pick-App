import { NextRequest, NextResponse } from "next/server";
import { scanMod, isUnderAllowedRoot } from "@/lib/cherrypick";

// The inventory of ONE mod, on demand. The path is checked before any call: we
// only scan what lives under a known mods root.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const modPath = req.nextUrl.searchParams.get("path");
  if (!id || !modPath) {
    return NextResponse.json({ error: "id et path sont requis" }, { status: 400 });
  }
  if (!isUnderAllowedRoot(modPath)) {
    return NextResponse.json({ error: "chemin hors des racines de mods" }, { status: 403 });
  }

  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    return NextResponse.json(await scanMod(id, modPath, refresh));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
