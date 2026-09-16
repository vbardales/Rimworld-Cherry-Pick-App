import path from "node:path";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { CATEGORIES, type CategoryId, type ModLabel } from "./labels";

// The colour a category paints in the picker's own list, kept in one place so it
// can be read from server code — CSS custom properties in globals.css are not.
//
// MUST STAY IN STEP with the `--c:` values under `.labeler [data-cat=...]` there.
// Nothing enforces that automatically; a colour changed in one place and not the
// other just drifts quietly until someone notices the two disagree.
const CATEGORY_COLOR: Record<CategoryId, string> = {
  engine: "#d4498a",
  gameplay: "#4f9c3e",
  animals: "#a8801a",
  joy: "#d1741f",
  textures: "#b0a01e",
  food: "#4d5bd0",
  plants: "#2f7d4a",
  factions: "#b04a34",
  races: "#8b5cc4",
  medical: "#2e93b8",
  furniture: "#8a6a3a",
  apparel: "#14907f",
  ideology: "#c02a52",
  armor: "#5c728f",
  structure: "#6e6a63",
  vehicles: "#9b3fa8",
  props: "#2c4a7c",
  biotech: "#1f8f6b",
  children: "#c46a9a",
};

// A mod can carry several categories, RimSort's colour is one hex string per
// mod. The rightmost ticked chip wins — "rightmost" meaning latest in
// CATEGORIES' own fixed order, which is also the order the chips are drawn in,
// so it is the last one lit up when looking at the row left to right.
export function rightmostCategory(categories: CategoryId[]): CategoryId | null {
  for (let i = CATEGORIES.length - 1; i >= 0; i--) {
    if (categories.includes(CATEGORIES[i].id)) return CATEGORIES[i].id;
  }
  return null;
}

export function colorFor(label: Pick<ModLabel, "categories">): string | null {
  const cat = rightmostCategory(label.categories);
  return cat ? CATEGORY_COLOR[cat] : null;
}

// RimSort's own settings say which instance is current, and each instance keeps
// its colours in its own SQLite file — never assume "Default".
async function auxMetadataPath(): Promise<string | null> {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  try {
    const settings = JSON.parse(
      await fs.readFile(path.join(local, "RimSort", "settings.json"), "utf8"),
    );
    const dir = settings?.current_instance_path;
    if (typeof dir !== "string" || !dir) return null;
    const db = path.join(dir, "aux_metadata.db");
    await fs.access(db);
    return db;
  } catch {
    return null; // RimSort not installed, never run, or a different layout
  }
}

// "YYYY-MM-DD HH:MM:SS", matching the format already sitting in the column —
// not ISO 8601, which is what RimSort itself writes.
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Best-effort: a mod picked here that RimSort has never seen gets a fresh row
// (every other column falls back to its own schema default, `type` included —
// RimSort corrects that itself next time it scans). A mod RimSort already knows
// keeps everything else about it; only `color_hex` moves.
//
// Failures are swallowed on purpose. RimSort locks this file solidly while it is
// open with a mod list loaded, and a label click here must never fail — or feel
// slower — because another program happens to be running.
export async function syncRimSortColor(modPath: string, hex: string | null): Promise<boolean> {
  const dbPath = await auxMetadataPath();
  if (!dbPath) return false;
  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(dbPath, { timeout: 2000 });
    db.prepare(
      `INSERT INTO auxiliary_metadata (path, color_hex, db_time_touched)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET color_hex = excluded.color_hex, db_time_touched = excluded.db_time_touched`,
    ).run(modPath, hex, stamp());
    return true;
  } catch {
    return false; // RimSort has the file open and locked, or some other hiccup
  } finally {
    db?.close();
  }
}
