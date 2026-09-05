import { NextRequest, NextResponse } from "next/server";
import { listMods } from "@/lib/cherrypick";
import { readStore } from "@/lib/labelStore";
import { isSorted, key, EMPTY, type CategoryId } from "@/lib/labels";

// The active modlist, or everything installed.
//
// Filtering used to happen here, and it had to: the answer was capped at 200
// rows, and a filter applied after a truncation answers a question nobody asked —
// with 9612 mods installed and 199 labelled, "sorted" found the one that happened
// to fall inside the first 200, and the count said so.
//
// The page now asks for the whole scope once (limit=0) and filters what it holds,
// so the cap and the filtering that had to work around it are both optional. They
// stay for anything else calling this route, and because a capped answer is still
// the right shape for a search box that queries as it types.
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "active";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const sift = req.nextUrl.searchParams.get("sift") ?? "all";
  const only = (req.nextUrl.searchParams.get("only") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean) as CategoryId[];
  // limit=0 means the whole scope, no cap: the page reads once and filters on its
  // own, so a truncated answer would silently hide mods from every later filter.
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const capped = limit > 0;

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
      mods: capped ? mods.slice(0, limit) : mods,
      // The labels of the rows sent back — but only when there are few of them.
      // Uncapped, the page has already loaded the whole classification from
      // /api/labels, and 9612 mostly-empty entries would double the payload to say
      // nothing.
      labels: capped
        ? Object.fromEntries(mods.slice(0, limit).map((m) => [key(m.PackageId), labelOf(m.PackageId)]))
        : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
