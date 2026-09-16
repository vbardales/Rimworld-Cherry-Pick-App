import { TECH_LEVELS, type TechLevel, type TechRange, type TechStep } from "./techLevels";

// What a mod asks of a colony's research, as a range: the most accessible
// content it brings, and the most advanced.
//
// Read from research prerequisites, not from the defs' own <techLevel>. The
// declared level is mostly an inherited default — every melee weapon picks up
// one from its base, every apparel another — so the old "lowest declared level"
// put a spacer weapons pack at neolithic because it also carried a knife. A
// research project, on the other hand, always states its level, and what it
// gates is exactly what a colony cannot have before reaching it.
//
// Pure, like categoryRules.ts: no disk, no engine.

export type TechDef = {
  DefType?: string;
  DefName?: string | null;
  IsAbstract?: boolean;
  TechLevel?: string | null;
  // Set when TechLevel was inherited from a base rather than written on the
  // def itself — see Inherited.cs in the engine.
  TechLevelFrom?: string | null;
  ArchitectCategory?: string | null;
  ParentName?: string | null;
  ParentChain?: { Name: string }[];
  Craftable?: boolean;
  Sowable?: boolean;
  Refs?: { Research?: string[] };
};

const rank = (s: TechStep) => (s === "start" ? -1 : TECH_LEVELS.indexOf(s));
const isLevel = (s: string | null | undefined): s is TechLevel => !!s && TECH_LEVELS.includes(s as TechLevel);

// Content a player can build, craft or sow. A def that is only found, spawned
// or drawn says nothing about what the mod demands.
function obtainable(d: TechDef): boolean {
  if (d.IsAbstract || d.DefType === "ResearchProjectDef") return false;
  if (d.DefType === "RecipeDef") return true;
  if ((d.DefType === "ThingDef" || d.DefType === "TerrainDef") && d.ArchitectCategory) return true;
  if (d.Craftable || d.Sowable) return true;
  // recipeMaker is usually inherited from a vanilla base named that way.
  if ([d.ParentName, ...(d.ParentChain ?? []).map((p) => p.Name)].some((b) => b && /Makeable/.test(b))) return true;
  return (d.Refs?.Research ?? []).length > 0;
}

// `vanillaResearch` maps every Core and DLC research project to its level;
// the mod's own projects are added on top. A prerequisite that neither knows —
// a project from another mod, or an Anomaly one, which has no level — is
// skipped rather than guessed.
export function techRange(defs: TechDef[], vanillaResearch: Record<string, string | null>): TechRange | null {
  const research: Record<string, string | null> = { ...vanillaResearch };
  for (const d of defs) if (d.DefType === "ResearchProjectDef" && d.DefName) research[d.DefName] = d.TechLevel ?? null;

  const steps: TechStep[] = [];
  for (const d of defs) {
    if (!obtainable(d)) continue;
    const gates = d.Refs?.Research ?? [];
    // Nothing to research. A level the author wrote on the def itself still
    // places it — a tribal headband marked Neolithic reads as neolithic — but
    // an inherited one is the generic default this reading exists to avoid.
    if (gates.length === 0) {
      steps.push(isLevel(d.TechLevel) && !d.TechLevelFrom ? d.TechLevel : "start");
      continue;
    }
    const levels = gates.map((g) => research[g]).filter(isLevel);
    if (levels.length === 0) continue;
    steps.push(levels.reduce((a, b) => (rank(b) > rank(a) ? b : a)));
  }
  if (steps.length > 0) return range(steps, "research");

  // Nothing obtainable: fall back on what the concrete defs declare, flagged as
  // such, since that is exactly the inherited default the research reading
  // exists to avoid.
  const declared = defs.filter((d) => !d.IsAbstract).map((d) => d.TechLevel).filter(isLevel);
  return declared.length > 0 ? range(declared, "declared") : null;
}

function range(steps: TechStep[], source: TechRange["source"]): TechRange {
  const sorted = [...steps].sort((a, b) => rank(a) - rank(b));
  return { floor: sorted[0], ceiling: sorted[sorted.length - 1], source };
}
