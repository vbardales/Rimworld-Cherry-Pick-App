import { NextRequest, NextResponse } from "next/server";
import { isUnderAllowedRoot, scanMod } from "@/lib/cherrypick";
import { loadVanillaResearch } from "@/lib/modAnalysis";
import { techItems, techRange, unobtainableItems, type TechDef } from "@/lib/techRules";

// One mod's tech range, item by item: what the list's tag is made of. Reads the
// same cached inventory as /api/scan, so it costs nothing once the sheet is open.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const modPath = req.nextUrl.searchParams.get("path");
  if (!id || !modPath) return NextResponse.json({ error: "id et path sont requis" }, { status: 400 });
  if (!isUnderAllowedRoot(modPath)) return NextResponse.json({ error: "chemin hors des racines de mods" }, { status: 403 });

  try {
    const inv = (await scanMod(id, modPath)) as { Defs?: TechDef[] };
    const vanilla = await loadVanillaResearch();
    const defs = inv.Defs ?? [];
    return NextResponse.json({
      range: techRange(defs, vanilla),
      items: techItems(defs, vanilla),
      unobtainable: unobtainableItems(defs),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
