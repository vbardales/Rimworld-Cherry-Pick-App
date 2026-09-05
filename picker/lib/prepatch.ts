// Retirer une def AVANT que le jeu ne la construise.
//
// Cherry Picker retire du DefDatabase une def deja batie : elle a recu son short
// hash, ses references ont ete resolues, d'autres defs la pointent. Il faut ensuite
// courir apres tout ce qui la designe encore.
//
// Ici on la retire du XML, donc elle n'existe jamais. L'ordre de
// `LoadedModManager.LoadAllActiveMods`, verifie par decompilation en 1.6 :
//
//   InitializeMods -> LoadModContent -> CreateModClasses -> LoadModXML
//   -> CombineIntoUnifiedXML -> ApplyPatches -> ParseAndProcessXML
//
// `ApplyPatches` parcourt `runningMods.SelectMany(rm => rm.Patches)`, donc dans
// l'ordre de la modlist, et `PatchOperationRemove` fait litteralement
// `xmlNode.ParentNode.RemoveChild(xmlNode)`. Quand `ParseAndProcessXML` arrive, le
// noeud n'est plus la : aucun objet Def n'est construit.
//
// DEUX CONSEQUENCES A NE PAS OUBLIER.
//
// Ce mod doit charger EN DERNIER. Ses patchs passent apres ceux des autres, donc
// les ajouts qu'un mod tiers faisait a une def ont deja reussi — et meurent avec
// elle, ce qui est bien ce qu'on veut. Charge trop tot, ce sont les patchs des
// autres qui echoueraient, bruyamment, sur une cible disparue.
//
// Et cela ne rend pas un octet de memoire. `LoadModContent` charge les textures,
// les sons, les asset bundles et les assemblies AVANT tout ceci, pour chaque mod
// actif, sans regarder une seule def : `ModContentHolder.ReloadAll` appelle
// `ModContentLoader.LoadAllForMod`, qui construit chaque Texture2D. Retirer des
// defs ne fait pas maigrir un mod charge — seul le desabonnement le fait.
import path from "node:path";
import fs from "node:fs/promises";

export const MOD_DIR = "NelimCherryPick";
export const PACKAGE_ID = "nelim.cherrypick";
export const MOD_NAME = "Nelim's Cherry Pick";

export type Removal = { defType: string; defName: string };

// Ce qu'on accepte d'ecrire dans un xpath.
//
// Un defName sort d'un fichier qu'on n'a pas ecrit. Le jeu, lui, accepte a peu
// pres n'importe quoi : un guillemet dans un defName casserait le predicat en
// silence, et le patch retirerait autre chose que ce qu'on croit — ou tout. On
// refuse plutot que de deviner, et l'appelant apprend lesquels ont ete ecartes.
const SUR = /^[A-Za-z0-9_.\-+]+$/;

export function trier(removals: Removal[]): { gardes: Removal[]; refuses: Removal[] } {
  const gardes: Removal[] = [];
  const refuses: Removal[] = [];
  for (const r of removals) {
    if (SUR.test(r.defType) && SUR.test(r.defName)) gardes.push(r);
    else refuses.push(r);
  }
  return { gardes, refuses };
}

// Une operation par type de def, pas une par def.
//
// `PatchOperationRemove.ApplyWorker` fait `xml.SelectNodes(xpath)` sur le document
// unifie — plusieurs centaines de milliers de noeuds une fois tous les mods
// combines. Deux cents operations, c'est deux cents balayages complets ; un
// predicat en « or » n'en fait qu'un par type.
function xpathDe(defType: string, defNames: string[]): string {
  const pred = defNames.map((n) => `defName="${n}"`).join(" or ");
  return `/Defs/${defType}[${pred}]`;
}

export function render(source: { packageId: string; name: string }, removals: Removal[]): string {
  const { gardes } = trier(removals);
  const parType = new Map<string, string[]>();
  for (const r of gardes) {
    const l = parType.get(r.defType) ?? [];
    l.push(r.defName);
    parType.set(r.defType, l);
  }

  const ops = [...parType.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([defType, noms]) => {
      const tries = [...new Set(noms)].sort();
      return `  <!-- ${defType} : ${tries.length} -->
  <Operation Class="PatchOperationRemove">
    <xpath>${xpathDe(defType, tries)}</xpath>
    <!-- Le mod source peut etre desactive : sans ceci, le jeu signalerait a
         chaque lancement un patch qui n'a jamais rien trouve. -->
    <success>Always</success>
  </Operation>`;
    });

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Genere par cherrypick. Ne pas modifier a la main : une nouvelle passe sur
     ${source.name} reecrit ce fichier en entier.

     Source : ${source.name} (${source.packageId})
     Defs retirees : ${gardes.length}

     Ces operations passent entre ApplyPatches et ParseAndProcessXML, donc les
     defs listees ici ne sont jamais construites. Ce mod doit charger EN DERNIER
     dans la modlist. -->
<Patch>

${ops.join("\n\n")}

</Patch>
`;
}

// Le nom de fichier porte le packageId du mod source : un fichier par mod trie,
// donc reprendre un mod ne touche pas au tri des autres, et supprimer son fichier
// suffit a tout annuler. Le fichier commun de Cherry Picker imposait une fusion.
export function fichierDe(packageId: string): string {
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
  <description>Removes, before they are ever built, the defs picked out with the cherrypick tool.

Every file under Patches/ is generated: one per source mod, named after its packageId. Deleting a file undoes that mod's picks; deleting the folder undoes everything.

LOAD THIS LAST. Patches are applied in modlist order, so loading last means every other mod's patches have already succeeded on the defs about to be removed. Loaded early, it is their patches that would fail on a target that no longer exists.

This frees no memory. Textures, sounds, asset bundles and assemblies are all loaded in LoadModContent, before a single def is read.</description>
</ModMetaData>
`;
}

// Ou le mod vit, et pourquoi la.
//
// Mods/ a cote du jeu, pas dans le dossier Workshop : celui-ci est reecrit par
// Steam a chaque synchronisation, et un mod genere n'y survivrait pas.
export function dossierDe(rimworld: string): string {
  return path.join(rimworld, "Mods", MOD_DIR);
}

export async function ecrire(
  rimworld: string,
  source: { packageId: string; name: string },
  removals: Removal[],
): Promise<{ dossier: string; fichier: string; ecrites: number; refuses: Removal[] }> {
  const dossier = dossierDe(rimworld);
  const fichier = path.join(dossier, "Patches", fichierDe(source.packageId));
  const { gardes, refuses } = trier(removals);

  await fs.mkdir(path.join(dossier, "About"), { recursive: true });
  await fs.mkdir(path.join(dossier, "Patches"), { recursive: true });
  await fs.writeFile(path.join(dossier, "About", "About.xml"), about(), "utf8");

  // Plus rien a retirer pour ce mod : on efface son fichier au lieu d'en laisser
  // un vide. Un <Patch> sans operation se charge sans rien faire, mais il ferait
  // croire, la prochaine fois qu'on regarde le dossier, qu'il reste un tri pose.
  //
  // Et si c'etait le dernier, le mod s'en va avec lui. `AnyNonTranslationContentLoaded`
  // compte `loadedAnyPatches` — donc un mod qui n'a plus qu'un About.xml ne charge
  // rien, et le jeu ecrit « did not load any content » a chaque lancement. Un
  // dossier vide se supprime mieux qu'il ne s'explique.
  if (gardes.length === 0) {
    await fs.rm(fichier, { force: true });
    const reste = await fs.readdir(path.join(dossier, "Patches")).catch(() => []);
    if (reste.length === 0) await fs.rm(dossier, { recursive: true, force: true });
    return { dossier, fichier, ecrites: 0, refuses };
  }

  await fs.writeFile(fichier, render(source, removals), "utf8");
  return { dossier, fichier, ecrites: gardes.length, refuses };
}
