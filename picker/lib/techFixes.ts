// Nelim's Tech Level Fixes: a generated mod that rewrites <techLevel> on the
// items whose declared level contradicts the research that gates them.
//
// The game reads techLevel for more than a label — trader stock, faction gear,
// and mods such as World Tech Level or Tech Level Enforcement filter on it. So a
// wrong level is not cosmetic, and correcting it is a patch, decided item by
// item on the mod sheet.
//
// Built like NelimCherryPick (see prepatch.ts): one file per source mod under
// Patches/, named after its packageId, so revisiting one mod never touches the
// decisions made on another, and deleting a file undoes that mod.
import path from "node:path";
import fs from "node:fs/promises";
import { TECH_LEVELS, type TechLevel } from "./techLevels";

export const MOD_DIR = "NelimTechLevelFixes";
export const PACKAGE_ID = "nelim.techlevelfixes";
export const MOD_NAME = "Nelim's Tech Level Fixes";

export type TechFix = { defType: string; defName: string; from: TechLevel | null; to: TechLevel };

// Anything written into an xpath comes from a file we did not write: refuse
// rather than guess, exactly as prepatch.ts does.
const SAFE = /^[A-Za-z0-9_.\-+]+$/;

export function sort(fixes: TechFix[]): { kept: TechFix[]; refused: TechFix[] } {
  const kept: TechFix[] = [];
  const refused: TechFix[] = [];
  for (const f of fixes) {
    if (SAFE.test(f.defType) && SAFE.test(f.defName) && TECH_LEVELS.includes(f.to)) kept.push(f);
    else refused.push(f);
  }
  return { kept, refused };
}

// Three layers, each for a reason.
//
// The outer conditional checks the def exists: the source mod may be inactive,
// and a bare Add on a missing def would log an error at every launch.
// The inner one replaces the element when the def writes its own <techLevel>
// and adds it when the level is inherited — Replace alone would silently miss
// every inherited case, which is most of them.
function operation(f: TechFix): string {
  const def = `/Defs/${f.defType}[defName="${f.defName}"]`;
  return `  <!-- ${f.defName} : ${f.from ?? "(aucun)"} -> ${f.to} -->
  <Operation Class="PatchOperationConditional">
    <xpath>${def}</xpath>
    <success>Always</success>
    <match Class="PatchOperationConditional">
      <xpath>${def}/techLevel</xpath>
      <match Class="PatchOperationReplace">
        <xpath>${def}/techLevel</xpath>
        <value><techLevel>${f.to}</techLevel></value>
      </match>
      <nomatch Class="PatchOperationAdd">
        <xpath>${def}</xpath>
        <value><techLevel>${f.to}</techLevel></value>
      </nomatch>
    </match>
  </Operation>`;
}

export function render(source: { packageId: string; name: string }, fixes: TechFix[]): string {
  const { kept } = sort(fixes);
  const ops = [...kept].sort((a, b) => a.defName.localeCompare(b.defName)).map(operation);
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Genere par cherrypick. Ne pas modifier a la main : une nouvelle passe sur
     ${source.name} reecrit ce fichier en entier.

     Source : ${source.name} (${source.packageId})
     Corrections : ${kept.length} -->
<Patch>

${ops.join("\n\n")}

</Patch>
`;
}

export function fileOf(packageId: string): string {
  return `${packageId.replace(/[^A-Za-z0-9_.\-]/g, "_")}.xml`;
}

export function about(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ModMetaData>
  <name>${MOD_NAME}</name>
  <packageId>${PACKAGE_ID}</packageId>
  <author>Nelim</author>
  <supportedVersions>
    <li>1.6</li>
  </supportedVersions>
  <description>Rewrites the tech level of items whose declared level contradicts the research that gates them, for mods reviewed one by one with the cherrypick tool.

Every file under Patches/ is generated: one per source mod, named after its packageId. Deleting a file undoes that mod's corrections; deleting the folder undoes everything.

Load this after the mods it corrects, so their own patches have already run.</description>
</ModMetaData>
`;
}

export function folderOf(rimworld: string): string {
  return path.join(rimworld, "Mods", MOD_DIR);
}

// The corrections already written for one mod, read back from its file so the
// sheet shows what is in place rather than the defaults.
export async function readFixes(rimworld: string, packageId: string): Promise<{ defName: string; to: string }[] | null> {
  try {
    const xml = await fs.readFile(path.join(folderOf(rimworld), "Patches", fileOf(packageId)), "utf8");
    return [...xml.matchAll(/<!-- (\S+) : \S+ -> (\S+) -->/g)].map((m) => ({ defName: m[1], to: m[2] }));
  } catch {
    return null;
  }
}

export async function write(
  rimworld: string,
  source: { packageId: string; name: string },
  fixes: TechFix[],
): Promise<{ folder: string; file: string; written: number; refused: TechFix[] }> {
  const folder = folderOf(rimworld);
  const file = path.join(folder, "Patches", fileOf(source.packageId));
  const { kept, refused } = sort(fixes);

  await fs.mkdir(path.join(folder, "About"), { recursive: true });
  await fs.mkdir(path.join(folder, "Patches"), { recursive: true });
  await fs.writeFile(path.join(folder, "About", "About.xml"), about(), "utf8");

  // Nothing left for this mod: remove its file, and the mod with its last file
  // — a mod with only an About.xml loads nothing and the game says so at every
  // launch (see prepatch.ts).
  if (kept.length === 0) {
    await fs.rm(file, { force: true });
    const left = await fs.readdir(path.join(folder, "Patches")).catch(() => []);
    if (left.length === 0) await fs.rm(folder, { recursive: true, force: true });
    return { folder, file, written: 0, refused };
  }

  await fs.writeFile(file, render(source, fixes), "utf8");
  return { folder, file, written: kept.length, refused };
}
