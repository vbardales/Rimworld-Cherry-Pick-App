import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const run = promisify(execFile);

// Le moteur reste le binaire C# : il porte toute l'analyse XML, deja eprouvee.
// Next n'est que l'interface et l'orchestration.
// picker/ et engine/ sont voisins a la racine du depot.
const ROOT = path.resolve(process.cwd(), "..");

// On invoque `dotnet cherrypick.dll`, jamais un exe.
//
// Un apphost fraichement compile n'est pas signe, et Smart App Control le bloque.
// dotnet.exe, lui, est signe par Microsoft. Le csproj met donc UseAppHost a false :
// aucun exe n'est produit.
//
// Ne jamais desactiver Smart App Control pour contourner ce genre de blocage :
// sous Windows 11 on ne peut plus le reactiver sans reinstaller le systeme.
export const DLL = path.join(ROOT, "engine", "bin", "Release", "net8.0", "cherrypick.dll");
export const DOTNET = process.env.DOTNET_PATH ?? "dotnet";

export const GAME_DIR =
  process.env.RIMWORLD_DIR ?? "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld";

// Les seules racines dont on acceptera de servir un fichier. Sans cette liste,
// la route des textures serait une lecture arbitraire de disque offerte a tout
// ce qui parle a localhost.
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

// Le tampon de sortie par defaut d'execFile est trop petit : l'inventaire d'un
// gros mod depasse largement le megaoctet.
const MAX = 256 * 1024 * 1024;

export async function listMods(scope: "active" | "all"): Promise<ModRow[]> {
  const args = ["list", "--json"];
  if (scope === "all") args.push("--all");
  const { stdout } = await run(DOTNET, [DLL, ...args], { maxBuffer: MAX, windowsHide: true });
  return JSON.parse(stdout);
}

// L'inventaire d'un mod est mis en cache sur disque et revalide par la date de
// modification du dossier : rescanner a chaque affichage serait inutile, et le
// scan d'un gros mod prend plusieurs secondes.
const CACHE = path.join(os.tmpdir(), "cherrypick-scans");

export async function scanMod(id: string, modPath: string, refresh = false): Promise<unknown> {
  await fs.mkdir(CACHE, { recursive: true });
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(CACHE, `${safe}.json`);

  // Le cache est revalide par la date du DOSSIER du mod, or modifier un fichier
  // dans un sous-dossier ne la change pas toujours. D'ou le rescan force : c'est
  // le seul moyen sur de repartir des fichiers.
  if (!refresh) {
    try {
      const [cached, dir] = await Promise.all([fs.stat(file), fs.stat(modPath)]);
      if (cached.mtimeMs >= dir.mtimeMs) return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      // pas de cache, ou mod introuvable : on scanne
    }
  }

  const { stdout } = await run(DOTNET, [DLL, "scan", modPath], { maxBuffer: MAX, windowsHide: true });
  await fs.writeFile(file, stdout, "utf8");
  return JSON.parse(stdout);
}

// Etend une selection a tout ce qu'elle entraine.
//
// Les cles passent par un fichier, jamais par la ligne de commande : une
// selection de plusieurs milliers de defs depasserait la limite de longueur
// d'argument de Windows, et le mode de defaillance serait illisible.
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
