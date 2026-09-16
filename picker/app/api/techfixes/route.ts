import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { GAME_DIR } from "@/lib/cherrypick";
import { MOD_NAME, PACKAGE_ID, readFixes, write, type TechFix } from "@/lib/techFixes";

// The corrections already written for one mod, or null when it has no file yet.
export async function GET(req: NextRequest) {
  const packageId = (req.nextUrl.searchParams.get("packageId") ?? "").trim();
  if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });
  return NextResponse.json({ written: await readFixes(GAME_DIR, packageId), modName: MOD_NAME, packageId: PACKAGE_ID });
}

// Rewrites this mod's file with exactly the corrections ticked on the sheet.
// An empty list removes the file.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    const name = String(body?.name ?? packageId).trim();
    if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });
    const fixes: TechFix[] = Array.isArray(body?.fixes)
      ? body.fixes.map((f: Record<string, unknown>) => ({
          defType: String(f.defType ?? ""),
          defName: String(f.defName ?? ""),
          from: typeof f.from === "string" ? f.from : null,
          to: String(f.to ?? ""),
        }) as TechFix)
      : [];
    const res = await write(GAME_DIR, { packageId, name }, fixes);
    return NextResponse.json({ ...res, file: path.basename(res.file), modName: MOD_NAME });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
