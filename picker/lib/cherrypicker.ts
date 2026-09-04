import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// Le mod Cherry Picker d'Owlchemist, et le fichier ou il range sa liste.
//
// C'est LUI la sortie de l'outil, pas un mod genere. On laisse le mod source
// charge tel quel, et on demande a Cherry Picker de retirer ce qu'on n'a pas
// voulu : rien a recopier, rien a re-porter quand l'amont bouge, et les credits
// restent a leur auteur.
//
// Consequence a garder en tete : la liste porte donc les defs ECARTEES, pas les
// gardees. Une conf de cherry-pick et une generation de mod sont exactement
// inverses l'une de l'autre.

// Une seule liste pour tous les mods : le fichier est global. Une conf par mod
// s'y FUSIONNE, elle ne l'ecrase pas — sans quoi trier un deuxieme mod effacerait
// le premier.
const CONFIG_DIR = path.join(
  os.homedir(),
  "AppData", "LocalLow", "Ludeon Studios", "RimWorld by Ludeon Studios", "Config",
);

// Le nom du fichier porte l'identifiant Workshop du mod, qui change le jour ou
// l'on passe a une reprise. On cherche donc par motif plutot que par nom.
export async function settingsFile(): Promise<string | null> {
  try {
    const files = await fs.readdir(CONFIG_DIR);
    const f = files.find((x) => /CherryPicker.*\.xml$/i.test(x));
    return f ? path.join(CONFIG_DIR, f) : null;
  } catch {
    return null;
  }
}

// Les cles deja posees, quel que soit le mod qui les a mises.
export async function readKeys(file: string): Promise<string[]> {
  const xml = await fs.readFile(file, "utf8");
  return [...xml.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].trim()).filter(Boolean);
}

// On reecrit le fichier en entier plutot que d'editer le XML en place : il ne
// contient qu'une liste, et Scribe le regenere de toute facon a chaque
// enregistrement du jeu.
export function render(keys: string[]): string {
  const li = keys.length
    ? keys.map((k) => `\t\t\t<li>${k}</li>`).join("\n")
    : null;
  return `<?xml version="1.0" encoding="utf-8"?>
<SettingsBlock>
\t<ModSettings Class="CherryPicker.ModSettings_CherryPicker">
${li === null ? "\t\t<keys />" : `\t\t<keys>\n${li}\n\t\t</keys>`}
\t</ModSettings>
</SettingsBlock>`;
}
