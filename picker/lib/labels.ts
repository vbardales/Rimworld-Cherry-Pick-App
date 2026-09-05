// The labels put on a mod, and the "sorted" state.
//
// They do not describe what gets extracted from a mod — that is the def-by-def
// selection. They describe WHAT THE MOD IS FOR, so that in a modlist of a couple
// of hundred entries one can find those touching animals or food, and above all
// those not looked at yet.
//
// A mod often carries several: a creature mod brings animals and their textures,
// an overhaul touches gameplay and factions. The choice is multiple, never
// exclusive.
//
// The colours live in globals.css, indexed by this identifier: one definition
// only, and it knows how to adapt to the dark theme.
export type CategoryId =
  | "engine" | "gameplay" | "animals" | "joy" | "textures"
  | "food" | "plants" | "factions" | "races" | "medical" | "furniture" | "apparel" | "ideology" | "armor" | "structure" | "vehicles" | "props";

// A category's borders are decided once, on the first mod that straddles them,
// and forgotten by the next. Those decisions live here, and the interface shows
// them on the chip: the moment one hesitates is the moment one hovers it.
export const CATEGORIES: { id: CategoryId; label: string; hint?: string }[] = [
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
  { id: "furniture", label: "furniture", hint: "les meubles de rangement en font partie" },
  { id: "structure", label: "sols/murs", hint: "les portes aussi" },
  { id: "apparel",  label: "vetements/cheveux" },
  { id: "ideology", label: "ideologie" },
  { id: "armor",    label: "armes/armures" },
  { id: "vehicles", label: "vehicules" },
  { id: "props",    label: "props" },
];

export type ModLabel = {
  categories: CategoryId[];

  // The mod does not declare 1.6, but it runs there — observed in game.
  //
  // RimWorld refuses to load what About.xml does not announce, but most content
  // mods carry over from one version to the next unchanged. This flag keeps the
  // record of the test: without it, an already verified mod reads as dead again
  // on every pass through the list, and gets tested twice.
  works16?: boolean;

  updated: string;
};

// "Sorted" does not mean "kept": it means "looked at, and I now know what it
// does". That is what moves the work forward, not the decision to extract.
//
// It is not a field but a reading: one label is enough to say it, and a separate
// flag could contradict it. Removing the last label therefore puts the mod back
// in the queue, with nothing else to undo.
export function isSorted(l: ModLabel): boolean {
  return l.categories.length > 0;
}

export type LabelStore = { version: 1; mods: Record<string, ModLabel> };

export const EMPTY: ModLabel = { categories: [], works16: false, updated: "" };

// Le packageId, ramene a une forme unique.
//
// RimWorld ne distingue pas la casse d'un packageId, et les deux vues de l'outil
// ne donnent pas la meme : la modlist rend ce que ModsConfig contient, la liste
// complete rend ce que chaque About.xml declare. Le meme mod arrivait donc sous
// deux noms — etiquete dans une vue, il apparaissait vierge dans l'autre, et un
// deuxieme clic creait une deuxieme entree.
export function key(packageId: string): string {
  return packageId.trim().toLowerCase();
}

export function labelOf(store: Record<string, ModLabel>, packageId: string): ModLabel {
  return store[key(packageId)] ?? store[packageId] ?? EMPTY;
}
