import { NextResponse } from "next/server";
import { listMods } from "@/lib/cherrypick";
import { readStore } from "@/lib/labelStore";
import { syncAllRimSortTags } from "@/lib/rimsort";

// Writes every label's categories to RimSort as tags, for the mods on disk. A
// label whose mod is no longer installed has no folder to hang a tag on.
export async function POST() {
  try {
    const [store, mods] = await Promise.all([readStore(), listMods("all")]);
    const byId = new Map(mods.filter((m) => m.Found && m.Path).map((m) => [m.PackageId.toLowerCase(), m.Path]));
    const rows = Object.entries(store.mods)
      .map(([id, l]) => ({ path: byId.get(id.toLowerCase()), categories: l.categories ?? [] }))
      .filter((r): r is { path: string; categories: typeof r.categories } => !!r.path);
    const { written } = await syncAllRimSortTags(rows);
    return NextResponse.json({ written, labelled: Object.keys(store.mods).length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
