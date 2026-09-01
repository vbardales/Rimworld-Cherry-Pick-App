import { NextRequest, NextResponse } from "next/server";
import { scanMod, isUnderAllowedRoot } from "@/lib/cherrypick";

// L'inventaire d'UN mod, a la demande. Le chemin est verifie avant tout appel :
// on ne scanne que ce qui vit sous une racine de mods connue.
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
    return NextResponse.json(await scanMod(id, modPath));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
