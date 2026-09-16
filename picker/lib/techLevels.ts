import type { CategoryId } from "./labels";

// Split out of modAnalysis.ts on purpose: that module imports cherrypick.ts,
// which spawns dotnet through node:child_process, and page.tsx (a client
// component) needs TECH_LEVELS as a real runtime array for its filter <select>.
// Bundling anything that reaches child_process into client code is not just
// wasted bytes — Turbopack refuses outright ("does not support external
// modules"), and the whole page 500s. Keeping this file free of server-only
// imports is what lets both sides read from the same list.

// RimWorld's own TechLevel enum, in order. "Undefined" is deliberately absent:
// it is what a def has when nobody set anything, which for this purpose is the
// same as not knowing — not a level below Animal.
export const TECH_LEVELS = [
  "Animal", "Neolithic", "Medieval", "Industrial", "Spacer", "Ultra", "Archotech",
] as const;
export type TechLevel = (typeof TECH_LEVELS)[number];

export type ModAnalysis = {
  // null means "scanned, and genuinely nothing declares a tech level" — not the
  // same thing as "not scanned yet", which is simply the absence of a key.
  minTechLevel: TechLevel | null;

  // A guess, never a classification: see labels.ts's ModLabel.suggested for why
  // it is kept structurally apart from the categories a person actually ticked.
  suggested: CategoryId[];

  scannedAt: string;

  // The mod folder's mtime at the moment of this analysis — the same
  // invalidation InstalledIndex.cs uses for About.xml. A folder touched since
  // means the analysis is stale, not merely old.
  folderStamp: number;
};
