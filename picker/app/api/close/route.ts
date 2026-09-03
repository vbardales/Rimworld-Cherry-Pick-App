import { NextRequest, NextResponse } from "next/server";
import { closeMod, isUnderAllowedRoot } from "@/lib/cherrypick";

// Ce qu'une selection entraine, et ce qu'elle contredit.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.path) return NextResponse.json({ error: "path est requis" }, { status: 400 });
  if (!isUnderAllowedRoot(body.path)) {
    return NextResponse.json({ error: "chemin hors des racines de mods" }, { status: 403 });
  }

  try {
    const picked: string[] = Array.isArray(body.picked) ? body.picked : [];
    const excluded: string[] = Array.isArray(body.excluded) ? body.excluded : [];
    return NextResponse.json(await closeMod(body.path, picked, excluded));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
