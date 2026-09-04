import path from "node:path";
import fs from "node:fs/promises";
import type { CategoryId, LabelStore, ModLabel } from "./labels";
import { CATEGORIES } from "./labels";

// Classifying a modlist takes weeks, one mod at a time. So it cannot live in the
// browser: clearing site data would wipe it, and it would not follow from one
// machine to another. It lives in the repository, in plain text, and can be read
// back without the tool.
const FILE = path.resolve(process.cwd(), "..", "data", "mod-labels.json");

const KNOWN = new Set<string>(CATEGORIES.map((c) => c.id));

export async function readStore(): Promise<LabelStore> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.mods) return { version: 1, mods: raw.mods };
  } catch {
    // File missing on first run, or unreadable: start from an empty
    // classification rather than refuse to serve the page.
  }
  return { version: 1, mods: {} };
}

// A write always re-reads the file first: with two tabs open on the list, a save
// made from a stale state would wipe the classification done in the other.
//
// Writes are serialized by this promise chain. They are rare — a human click —
// but two clicks close together would be enough to lose one.
let queue: Promise<unknown> = Promise.resolve();

export function writeLabel(
  packageId: string,
  patch: { categories?: CategoryId[]; works16?: boolean },
): Promise<ModLabel> {
  const task = queue.then(async () => {
    const store = await readStore();
    const cur: ModLabel = store.mods[packageId] ?? { categories: [], updated: "" };
    const works16 = patch.works16 ?? cur.works16 ?? false;

    const categories = patch.categories
      ? [...new Set(patch.categories.filter((c) => KNOWN.has(c)))]
      : cur.categories;
    const next: ModLabel = { categories, works16, updated: new Date().toISOString() };

    // A mod with no label has no business in the file: it is simply unsorted, like
    // the thousands that never appeared in it. Keeping it would grow the
    // classification by an empty entry on every cancelled click.
    //
    // Unless it carries the 1.6 flag: that is not a classification but the result
    // of a test in game, and losing it would cost running the test again.
    if (categories.length === 0 && !works16) delete store.mods[packageId];
    else store.mods[packageId] = next;

    await fs.mkdir(path.dirname(FILE), { recursive: true });
    // Atomic write: a cut in the middle would leave truncated JSON, hence the
    // whole classification unreadable at next start.
    const tmp = `${FILE}.${process.pid}.tmp`;
    const ordered = Object.fromEntries(Object.entries(store.mods).sort(([a], [b]) => a.localeCompare(b)));
    await fs.writeFile(tmp, JSON.stringify({ version: 1, mods: ordered }, null, 2), "utf8");
    await fs.rename(tmp, FILE);

    return next;
  });
  queue = task.catch(() => {});
  return task;
}
