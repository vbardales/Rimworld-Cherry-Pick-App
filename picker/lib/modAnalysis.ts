import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listMods, scanMod, type ModRow } from "./cherrypick";
import { key, type CategoryId } from "./labels";
import { TECH_LEVELS, type ModAnalysis, type TechLevel } from "./techLevels";

// A background reading of the whole corpus: minimum tech level and a guess at
// what a mod is FOR, computed from the same `scan` the engine already knows how
// to do — see scanMod() in cherrypick.ts, which caches the raw inventory to disk.
//
// Nothing here is asked for by a page request. A full corpus is nine thousand
// mods and a few seconds each: synchronous, that is hours behind one GET. So the
// job runs on its own clock, in the background, and a page reads whatever it has
// produced so far — "not yet scanned" for the rest.

// ModAnalysis, TechLevel and TECH_LEVELS live in techLevels.ts, a module free
// of server-only imports — see the comment there for why: this file pulls in
// cherrypick.ts (node:child_process), and page.tsx, a client component, needs
// TECH_LEVELS as a real value for its filter <select>.
type AnalysisStore = Record<string, ModAnalysis>;

const CACHE_DIR = path.join(os.tmpdir(), "cherrypick-scans");
const FILE = path.join(CACHE_DIR, "mod-analysis.json");

// What the shape of a def looks like once it comes back from `dotnet cherrypick
// scan`, serialized straight from engine/Model.cs's DefEntry. Only the fields the
// guess actually reads.
type DefLike = {
  IsAbstract?: boolean;
  DefType?: string;
  TechLevel?: string | null;
  ArchitectCategory?: string | null;
  Race?: string | null;
  AddsHediff?: string | null;
  ThingCategories?: string[];
  ApparelLayers?: string[];
};
type InventoryLike = { Defs?: DefLike[] };

function computeMinTechLevel(defs: DefLike[]): TechLevel | null {
  let min: number | null = null;
  for (const d of defs) {
    const t = d.TechLevel;
    if (!t || t === "Undefined") continue;
    const idx = TECH_LEVELS.indexOf(t as TechLevel);
    if (idx < 0) continue;
    if (min === null || idx < min) min = idx;
  }
  return min === null ? null : TECH_LEVELS[min];
}

// What a single def suggests about what the mod is FOR. Deliberately permissive
// — better to offer a wrong dashed chip that a glance dismisses than to stay
// silent on a mod nobody has looked at yet.
function guessCategoriesForDef(d: DefLike): CategoryId[] {
  const out: CategoryId[] = [];
  const type = d.DefType ?? "";
  const arch = (d.ArchitectCategory ?? "").toLowerCase();
  const cats = (d.ThingCategories ?? []).map((c) => c.toLowerCase());
  const hasLayers = (d.ApparelLayers ?? []).length > 0;

  if (d.Race) out.push("animals");
  if (type === "PawnKindDef" && !d.Race) out.push("factions");
  if (type === "FactionDef") out.push("factions");
  if (type === "HediffDef" || (type === "RecipeDef" && d.AddsHediff)) out.push("medical");
  if (type === "PlantDef") out.push("plants");
  if (hasLayers || cats.includes("apparel")) out.push("apparel");
  if (cats.some((c) => c.includes("weapon"))) out.push("armor");
  if (cats.some((c) => c.includes("food") || c.includes("meals") || c.includes("drug"))) out.push("food");
  if (cats.some((c) => c.includes("furniture")) || arch.includes("furniture")) out.push("furniture");
  if (arch.includes("structure") || arch.includes("floor") || cats.includes("floors")) out.push("structure");
  if (type.startsWith("Precept") || type.startsWith("Ideo") || type.startsWith("Ritual")) out.push("ideology");
  if (type === "GeneDef" || type === "XenotypeDef" || type === "GenepackDef") out.push("biotech");
  if (type === "ResearchProjectDef" || type === "TraitDef" || type === "IncidentDef") out.push("gameplay");
  if (type === "VehicleDef" || cats.includes("vehicles")) out.push("vehicles");
  if (type === "ThingStyleDef" || type === "StyleCategoryDef") out.push("textures");
  return out;
}

// Aggregated over the whole mod: the categories its concrete defs point to most,
// capped so a big mod does not end up wearing every chip at once.
function computeSuggestedCategories(defs: DefLike[]): CategoryId[] {
  const counts = new Map<CategoryId, number>();
  for (const d of defs) {
    for (const c of guessCategoriesForDef(d)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);
}

// The store is held in memory once loaded, and mutated in place: a full
// read-modify-write per mod would cost O(n) on a file that, on a well-stocked
// Workshop, ends up with thousands of entries — O(n^2) over a corpus pass.
// Disk writes are debounced instead, see scheduleFlush.
let store: AnalysisStore | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function loadStore(): Promise<AnalysisStore> {
  if (store) return store;
  try {
    store = JSON.parse(await fs.readFile(FILE, "utf8")) as AnalysisStore;
  } catch {
    store = {};
  }
  return store;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, 3000);
}

async function flushNow(): Promise<void> {
  if (!store) return;
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    // Suffixed with pid AND a random tag, not pid alone: under Next dev/Turbopack,
    // editing this file mid-session can leave an OLD module instance alive
    // alongside the new one (hot reload does not always tear down a running
    // setTimeout/loop), and both instances share the same process.pid. Two
    // concurrent flushes racing on the identical "pid.tmp" name is exactly what
    // produced an ENOENT on rename in practice: one instance renamed the file
    // away while the other still held a handle open on it.
    const tmp = `${FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store), "utf8");
    await fs.rename(tmp, FILE);
  } catch (e) {
    // A lost write here costs, at worst, one debounce window of analysis
    // results — the next scheduleFlush() tries again. Letting it throw instead
    // crashes the WHOLE dev server: flushNow is only ever called fire-and-forget
    // from a setTimeout, so an unhandled rejection here has nothing to be
    // caught by upstream.
    console.error("cherrypick: mod-analysis flush failed (will retry on the next write):", e);
  }
}

export async function readAnalysisStore(): Promise<AnalysisStore> {
  return await loadStore();
}

export function analysisOf(store: AnalysisStore, packageId: string): ModAnalysis | undefined {
  return store[key(packageId)];
}

// --- the background job itself -------------------------------------------

export type JobStatus = {
  total: number;
  done: number;
  queued: number;
  running: boolean;
  current: string | null;
};

let started = false;
const queue: ModRow[] = [];
const queuedSet = new Set<string>();
const status: JobStatus = { total: 0, done: 0, queued: 0, running: false, current: null };

// A page asks for this on every read of /api/mods and /api/analysis, so it has
// to be free once the job is already running: the check is a boolean read, and
// the actual loop is fired once and left to its own pace.
export function ensureJobStarted(): void {
  if (started) return;
  started = true;
  void loop().catch((e) => console.error("cherrypick: background scan loop died:", e));
}

export function jobStatus(): JobStatus {
  return { ...status, queued: queue.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Breathing room between two mods. The job never blocks a request — it runs on
// its own timers — but a tight loop of `dotnet` spawns would still starve the
// process of CPU a page's own request needs, on a machine mid-scan.
const TICK_MS = 150;

// How long a folder can go unre-listed before the job checks the disk again for
// mods installed or removed mid-session. Ten minutes: often enough that a fresh
// install joins the queue within the same sitting, rare enough that it costs
// nothing next to the scans themselves.
const REFILL_EVERY_MS = 10 * 60_000;

async function isStale(a: ModAnalysis | undefined, modPath: string): Promise<boolean> {
  if (!a) return true;
  try {
    const dir = await fs.stat(modPath);
    return dir.mtimeMs > a.folderStamp;
  } catch {
    return true;
  }
}

async function refillQueue(): Promise<void> {
  const mods = await listMods("all");
  const known = await loadStore();
  status.total = mods.length;
  for (const m of mods) {
    const id = key(m.PackageId);
    if (queuedSet.has(id)) continue;
    if (!(await isStale(known[id], m.Path))) continue;
    queue.push(m);
    queuedSet.add(id);
  }
}

async function analyzeOne(m: ModRow): Promise<void> {
  let folderStamp: number;
  try {
    folderStamp = (await fs.stat(m.Path)).mtimeMs;
  } catch {
    return; // gone since it was queued: nothing to analyze
  }

  const inv = (await scanMod(m.PackageId, m.Path)) as InventoryLike;
  const defs = inv.Defs ?? [];

  const entry: ModAnalysis = {
    minTechLevel: computeMinTechLevel(defs),
    suggested: computeSuggestedCategories(defs),
    scannedAt: new Date().toISOString(),
    folderStamp,
  };

  const s = await loadStore();
  s[key(m.PackageId)] = entry;
  scheduleFlush();
}

// A person clicking "scan now" on one mod. The background job never blocks a
// request, but this one is awaited by its caller (the API route below): a
// single mod is a few seconds at most, and the whole point of the button is to
// see the result land, not to queue behind nine thousand others.
//
// Bypasses scanMod's own cache (refresh: true) so a mod just edited by hand
// gets a real rescan, not the stale inventory sitting on disk.
export async function scanOneNow(packageId: string, modPath: string): Promise<ModAnalysis> {
  const folderStamp = (await fs.stat(modPath)).mtimeMs;
  const inv = (await scanMod(packageId, modPath, true)) as InventoryLike;
  const defs = inv.Defs ?? [];

  const entry: ModAnalysis = {
    minTechLevel: computeMinTechLevel(defs),
    suggested: computeSuggestedCategories(defs),
    scannedAt: new Date().toISOString(),
    folderStamp,
  };

  const s = await loadStore();
  s[key(packageId)] = entry;
  scheduleFlush();
  return entry;
}

async function loop(): Promise<void> {
  // Every await in this loop can throw for reasons that have nothing to do
  // with any one mod — the engine not built yet, a transient disk error, the
  // corpus listing itself failing. ensureJobStarted() fires this with a bare
  // `void loop()`: nothing upstream catches a rejection, so one would crash
  // the whole dev server exactly the way the flush race did. The one
  // per-mod catch below was not enough — refillQueue() and loadStore() sat
  // outside it entirely. Wrapping the whole iteration is what actually makes
  // this loop unkillable by a single bad tick.
  for (;;) {
    try {
      await loadStore();
      if (queue.length === 0) await refillQueue();

      const next = queue.shift();
      if (!next) {
        // Nothing left to do: the whole corpus is fresh. Check back
        // occasionally for what a session installs along the way, without
        // spinning.
        await sleep(REFILL_EVERY_MS);
        continue;
      }
      queuedSet.delete(key(next.PackageId));

      status.running = true;
      status.current = next.PackageId;
      await analyzeOne(next);
      status.done++;
    } catch (e) {
      // One mod's XML being unreadable, or the engine hiccuping, must not stop
      // the corpus behind it — or crash the process this job shares with every
      // other request the app is serving.
      console.error("cherrypick: background scan step failed (continuing):", e);
    } finally {
      status.running = false;
      status.current = null;
    }

    await sleep(TICK_MS);
  }
}
