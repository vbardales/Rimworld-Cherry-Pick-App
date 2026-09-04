// Les etiquettes qu'on pose sur un mod, et l'etat « trie ».
//
// Elles ne decrivent pas ce qu'on extrait d'un mod — ca, c'est la selection def
// par def. Elles decrivent A QUOI SERT le mod, pour retrouver dans une modlist
// de plusieurs dizaines d'entrees ceux qui touchent aux animaux ou a la
// nourriture, et surtout ceux qu'on n'a pas encore regardes.
//
// Un mod en porte souvent plusieurs : un mod de creatures apporte des animaux et
// leurs textures, un overhaul touche au gameplay et aux factions. Le choix est
// donc multiple, jamais exclusif.
//
// Les couleurs vivent dans globals.css, indexees par cet identifiant : une seule
// definition, et elle sait s'adapter au theme sombre.
export type CategoryId =
  | "engine" | "gameplay" | "animals" | "joy" | "textures"
  | "food" | "plants" | "factions" | "races" | "medical";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "engine",   label: "moteur/UI" },
  { id: "gameplay", label: "gameplay" },
  { id: "animals",  label: "animaux" },
  { id: "joy",      label: "loisirs" },
  { id: "textures", label: "textures" },
  { id: "food",     label: "nourriture" },
  { id: "plants",   label: "plantes" },
  { id: "factions", label: "factions" },
  { id: "races",    label: "races" },
  { id: "medical",  label: "medical" },
];

export type ModLabel = {
  categories: CategoryId[];
  // « Valide » ne veut pas dire « garde » : ca veut dire « regarde, et je sais
  // maintenant ce qu'il fait ». C'est le tri qui fait avancer le travail, pas la
  // decision d'extraire.
  reviewed: boolean;
  updated: string;
};

export type LabelStore = { version: 1; mods: Record<string, ModLabel> };

export const EMPTY: ModLabel = { categories: [], reviewed: false, updated: "" };

export function labelOf(store: Record<string, ModLabel>, packageId: string): ModLabel {
  return store[packageId] ?? EMPTY;
}
