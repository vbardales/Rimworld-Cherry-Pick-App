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

// A step on the range is a tech level. Content a colony has from day one —
// nothing to research, nothing written, nothing required — sits at Animal, the
// lowest level RimWorld has; a separate "start" only duplicated it.
export type TechStep = TechLevel;

export type TechRange = {
  floor: TechStep;
  ceiling: TechStep;
  // "research": read from what the mod's content is gated behind — the reliable
  // reading. "declared": the mod has nothing to build, craft or sow, so this is
  // the <techLevel> its defs carry, mostly inherited defaults. See techRules.ts.
  source: "research" | "declared";
};

// Bumped whenever categoryRules.ts or techRules.ts
// changes in a way that would give a DIFFERENT answer for defs already on
// disk. A folder's mtime cannot catch that — the mod has not moved, the rule
// has — so an entry whose ruleVersion is behind is treated as stale and
// requeued, the same as a folder that changed. Bump this on every heuristic
// fix from now on.
export const ANALYSIS_RULE_VERSION = 22;

export type ModAnalysis = {
  // null means scanned, and the mod has no tech level to speak of — nothing
  // to obtain and nothing declared. Not the same as "not scanned yet", which is
  // simply the absence of a key.
  tech: TechRange | null;

  // A guess, never a classification: see labels.ts's ModLabel.suggested for why
  // it is kept structurally apart from the categories a person actually ticked.
  suggested: CategoryId[];

  scannedAt: string;

  // The mod folder's mtime at the moment of this analysis — the same
  // invalidation InstalledIndex.cs uses for About.xml. A folder touched since
  // means the analysis is stale, not merely old.
  folderStamp: number;

  // The ANALYSIS_RULE_VERSION the guess was computed under.
  ruleVersion: number;
};
