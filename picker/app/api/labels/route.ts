import { NextRequest, NextResponse } from "next/server";
import { readStore, writeLabel } from "@/lib/labelStore";
import type { CategoryId } from "@/lib/labels";
import { colorFor, syncRimSortColor, syncRimSortTags } from "@/lib/rimsort";

export async function GET() {
  try {
    return NextResponse.json(await readStore());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });

    const patch: { categories?: CategoryId[]; works16?: boolean; starred?: boolean } = {};
    if (Array.isArray(body.categories)) patch.categories = body.categories.map(String) as CategoryId[];
    if (typeof body.works16 === "boolean") patch.works16 = body.works16;
    if (typeof body.starred === "boolean") patch.starred = body.starred;

    const label = await writeLabel(packageId, patch);

    // RimSort's own colour and tags, kept in step — but only when a category actually
    // moved, and only when the client sent the mod's folder along. Best-effort:
    // a mod being labelled must never fail, or stall, because RimSort happens to
    // have its database open.
    const modPath = typeof body.path === "string" ? body.path : "";
    if (patch.categories && modPath) {
      void syncRimSortColor(modPath, colorFor(label)).then(() => syncRimSortTags(modPath, label.categories));
    }

    return NextResponse.json({ packageId, label });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
