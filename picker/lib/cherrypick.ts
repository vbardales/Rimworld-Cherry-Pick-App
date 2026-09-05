import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const run = promisify(execFile);

// The engine stays the C# binary: it carries the whole XML analysis, already
// proven. Next is only the interface and the orchestration.
// picker/ and engine/ sit side by side at the root of the repository.
const ROOT = path.resolve(process.cwd(), "..");

// We invoke `dotnet cherrypick.dll`, never an exe.
//
// A freshly compiled apphost is unsigned, and Smart App Control blocks it.
// dotnet.exe, on the other hand, is signed by Microsoft. So the csproj sets
// UseAppHost to false: no exe is produced at all.
//
// Never disable Smart App Control to work around that kind of block: under
// Windows 11 it cannot be turned back on without reinstalling the system.
export const DLL = path.join(ROOT, "engine", "bin", "Release", "net8.0", "cherrypick.dll");
export const DOTNET = process.env.DOTNET_PATH ?? "dotnet";

export const GAME_DIR =
  process.env.RIMWORLD_DIR ?? "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld";

// The only roots a file will ever be served from. Without this list, the texture
// route would be arbitrary disk reading offered to anything that can talk to
// localhost.
export function allowedRoots(): string[] {
  const steamapps = path.resolve(GAME_DIR, "..", "..");
  return [
    path.join(GAME_DIR, "Data"),
    path.join(GAME_DIR, "Mods"),
    path.join(steamapps, "workshop", "content", "294100"),
  ].map((p) => path.resolve(p));
}

export function isUnderAllowedRoot(candidate: string): boolean {
  const target = path.resolve(candidate);
  return allowedRoots().some((root) => {
    const rel = path.relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

export type ModRow = {
  PackageId: string;
  Name: string;
  Path: string;
  Source: string;
  Found: boolean;
  Active: boolean;
  SupportedVersions: string[];
  DeadBefore16: boolean;
};

// execFile's default output buffer is too small: a big mod's inventory goes well
// past a megabyte.
const MAX = 256 * 1024 * 1024;

// The modlist, kept in memory between requests.
//
// Filtering moved to the server so that it would happen before the 200-row cut —
// otherwise "sorted" answered about the page instead of the set. But that made
// every change of filter re-run the engine: measured between 8 and 24 seconds per
// click on a full Workshop, because the cost is spawning dotnet, walking nine
// thousand About.xml files and parsing the JSON back, and none of that depends on
// the filter.
//
// So the engine is asked once and the answer is held. What invalidates it differs
// by scope, and guessing one rule for both would be wrong:
//
//   active — ModsConfig.xml IS the answer, so its modification date is an exact
//            stamp. A mod activated elsewhere shows up on the next request.
//   all    — nothing cheap says whether the Workshop folder changed, so this one
//            expires on time alone. Sixty seconds: long enough that a session of
//            sorting never waits, short enough that a mod installed mid-session
//            appears without restarting anything. The refresh button on a mod
//            sheet is the escape hatch when that is not fast enough.
type Held = { at: number; stamp: string; mods: ModRow[] };
const held = new Map<string, Held>();
const TTL = 60_000;

async function stampOf(scope: "active" | "all"): Promise<string> {
  if (scope === "all") return "";
  try {
    const f = path.join(process.env.USERPROFILE ?? "", "AppData", "LocalLow", "Ludeon Studios",
      "RimWorld by Ludeon Studios", "Config", "ModsConfig.xml");
    return String((await fs.stat(f)).mtimeMs);
  } catch {
    return "";
  }
}

export async function listMods(scope: "active" | "all"): Promise<ModRow[]> {
  const stamp = await stampOf(scope);
  const deja = held.get(scope);
  if (deja && deja.stamp === stamp && Date.now() - deja.at < TTL) return deja.mods;

  const args = ["list", "--json"];
  if (scope === "all") args.push("--all");
  const { stdout } = await run(DOTNET, [DLL, ...args], { maxBuffer: MAX, windowsHide: true });
  const mods = JSON.parse(stdout) as ModRow[];
  held.set(scope, { at: Date.now(), stamp, mods });
  return mods;
}

// A mod's inventory is cached on disk and revalidated against the folder's
// modification date: rescanning on every display would be pointless, and scanning
// a big mod takes several seconds.
const CACHE = path.join(os.tmpdir(), "cherrypick-scans");

export async function scanMod(id: string, modPath: string, refresh = false): Promise<unknown> {
  await fs.mkdir(CACHE, { recursive: true });
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(CACHE, `${safe}.json`);

  // The cache is revalidated against the mod FOLDER's date, but changing a file in
  // a subfolder does not always change it. Hence the forced rescan: it is the only
  // sure way to start again from the files.
  if (!refresh) {
    try {
      const [cached, dir] = await Promise.all([fs.stat(file), fs.stat(modPath)]);
      if (cached.mtimeMs >= dir.mtimeMs) return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      // no cache, or mod not found: scan it
    }
  }

  const { stdout } = await run(DOTNET, [DLL, "scan", modPath], { maxBuffer: MAX, windowsHide: true });
  await fs.writeFile(file, stdout, "utf8");
  return JSON.parse(stdout);
}

// Extends a selection to everything it pulls in.
//
// The keys go through a file, never through the command line: a selection of
// several thousand defs would blow past Windows' argument length limit, and the
// failure mode would be unreadable.
export async function closeMod(
  modPath: string,
  picked: string[],
  excluded: string[],
): Promise<unknown> {
  await fs.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, `pick-${process.pid}-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify({ picked, excluded }), "utf8");
  try {
    const { stdout } = await run(DOTNET, [DLL, "close", modPath, "--pick-file", file, "--json"], {
      maxBuffer: MAX,
      windowsHide: true,
    });
    return JSON.parse(stdout);
  } finally {
    await fs.rm(file, { force: true });
  }
}
