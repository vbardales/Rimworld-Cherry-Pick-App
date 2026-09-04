import { NextRequest, NextResponse } from "next/server";
import { listMods } from "@/lib/cherrypick";
import { readStore } from "@/lib/labelStore";
import { isSorted, key, EMPTY, type CategoryId } from "@/lib/labels";

// The active modlist, or everything installed. With more than nine thousand mods
// on disk, filtering happens here and not in the browser.
//
// The classification filters here too, and that is not an optimisation. The
// answer is capped at 200 rows, so filtering in the browser filters the page
// rather than the set: with 9612 mods installed and 199 labelled, "sorted" found
// one — the only one that happened to fall inside the first 200 — and the count
// said so. A filter applied after a truncation answers a question nobody asked.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "active";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const sift = req.nextUrl.searchParams.get("sift") ?? "all";
  const only = (req.nextUrl.searchParams.get("only") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean) as CategoryId[];
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);

  try {
    let mods = await listMods(scope);
    const total = mods.length;

    if (q) {
      mods = mods.filter(
        (m) => m.Name.toLowerCase().includes(q) || m.PackageId.toLowerCase().includes(q),
      );
    }

    const { mods: store } = await readStore();
    const labelOf = (packageId: string) => store[key(packageId)] ?? EMPTY;

    // Counted over everything the search kept, before any truncation: these two
    // numbers are what says how much work is left.
    const sorted = mods.filter((m) => isSorted(labelOf(m.PackageId))).length;

    if (sift === "todo") mods = mods.filter((m) => !isSorted(labelOf(m.PackageId)));
    if (sift === "done") mods = mods.filter((m) => isSorted(labelOf(m.PackageId)));
    // Several labels ticked means OR: one looks for "everything touching animals
    // or plants", not their intersection, which would almost always be empty.
    if (only.length > 0 && sift !== "todo")
      mods = mods.filter((m) => only.some((c) => labelOf(m.PackageId).categories.includes(c)));

    const matched = mods.length;
    return NextResponse.json({
      total,
      matched,
      sorted,
      todo: total - sorted,
      mods: mods.slice(0, limit),
      labels: Object.fromEntries(mods.slice(0, limit).map((m) => [key(m.PackageId), labelOf(m.PackageId)])),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
