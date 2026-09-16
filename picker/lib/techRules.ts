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
  Key?: string;
  Label?: string | null;
  TechLevel?: string | null;
  // Set when TechLevel was inherited from a base rather than written on the
  // def itself — see Inherited.cs in the engine.
  TechLevelFrom?: string | null;
  ArchitectCategory?: string | null;
  ParentName?: string | null;
  ParentChain?: { Name: string }[];
  Craftable?: boolean;
  RecipeMakerRemoved?: boolean;
  Sowable?: boolean;
  Refs?: { Research?: string[] };
  // Research named in the def's own <recipeMaker>, and what its recipe inherits
  // from its base: see Inherited.cs.
  RecipeResearch?: string[];
  InheritedRecipeResearch?: string[];
  // RecipeDef -> the defNames it makes.
  Products?: string[];
  CostList?: string[];
  ConsumesPower?: boolean;
  // The same, merged in from the parent chain: see Inherited.cs.
  ResearchPrerequisites?: string[];
  InheritedResearchPrerequisites?: string[];
  InheritedCostList?: string[];
  InheritedConsumesPower?: boolean;
  InheritedRecipeResearchFrom?: string | null;
};

const rank = (s: TechStep) => TECH_LEVELS.indexOf(s);
const isLevel = (s: string | null | undefined): s is TechLevel => !!s && TECH_LEVELS.includes(s as TechLevel);

// Content a player can build, craft or sow. A def that is only found, spawned
// or drawn says nothing about what the mod demands.
function obtainable(d: TechDef): boolean {
  if (d.IsAbstract || d.DefType === "ResearchProjectDef") return false;
  // A recipe carries no techLevel — none of the 277 in Core and the DLC does —
  // so one without research says nothing of its own: an "install bionic eye"
  // surgery is only as early as the bionic eye it consumes, which the mod places
  // elsewhere. Counted as day-one content, such recipes dragged every surgery mod down.
  if (d.DefType === "RecipeDef") return gatesOf(d).length > 0;
  if ((d.DefType === "ThingDef" || d.DefType === "TerrainDef") && d.ArchitectCategory) return true;
  if (d.Craftable || d.Sowable) return true;
  // recipeMaker is usually inherited from a vanilla base named that way —
  // unless the def removes it.
  if (!d.RecipeMakerRemoved && [d.ParentName, ...(d.ParentChain ?? []).map((p) => p.Name)].some((b) => b && /Makeable/.test(b))) return true;
  return gatesOf(d).length > 0;
}

function gatesOf(d: TechDef): { name: string; from: string | null }[] {
  // A building placed from the Architect tab is gated by its own
  // researchPrerequisites only. A recipeMaker on it gates a SECOND way to get
  // it, at a bench — and a colony takes the earlier of the two, so the recipe's
  // research never delays the building. A Blahaj plush with no construction
  // research but a recipe asking for Complex Furniture is buildable on day one.
  const building = (d.DefType === "ThingDef" || d.DefType === "TerrainDef") && !!d.ArchitectCategory;
  if (building) {
    const recipe = new Set(d.RecipeResearch ?? []);
    const own = (d.Refs?.Research ?? []).filter((name) => !recipe.has(name)).map((name) => ({ name, from: null }));
    const seen = new Set(own.map((g) => g.name));
    const inherited = (d.InheritedResearchPrerequisites ?? [])
      .filter((name) => !seen.has(name))
      .map((name) => ({ name, from: d.ParentName ?? null }));
    return [...own, ...inherited];
  }
  const own = (d.Refs?.Research ?? []).map((name) => ({ name, from: null }));
  const seen = new Set(own.map((g) => g.name));
  const inherited = (d.InheritedRecipeResearch ?? [])
    .filter((name) => !seen.has(name))
    .map((name) => ({ name, from: d.InheritedRecipeResearchFrom ?? null }));
  return [...own, ...inherited];
}

function howObtained(d: TechDef): TechItem["how"] {
  if (d.DefType === "RecipeDef") return "recipe";
  if (d.Sowable) return "sow";
  if (d.ArchitectCategory && (d.DefType === "ThingDef" || d.DefType === "TerrainDef")) return "build";
  if (d.Craftable || (!d.RecipeMakerRemoved && [d.ParentName, ...(d.ParentChain ?? []).map((p) => p.Name)].some((b) => b && /Makeable/.test(b)))) return "craft";
  return "unlock";
}

// What an item needs to be built or to work, as a floor on its level. A 1.3 mod
// with no research at all still made its electric stove cost industrial
// components and draw 300 W: buildable on day one by the letter, useless until
// electricity. Kept out of gatesOf, so a requirement never makes a def count as
// obtainable on its own.
const COST_FLOOR: Record<string, TechLevel> = {
  ComponentIndustrial: "Industrial",
  ComponentSpacer: "Spacer",
};

function requirementsOf(d: TechDef): { name: string; level: TechLevel; from: null }[] {
  const out: { name: string; level: TechLevel; from: null }[] = [];
  if (d.ConsumesPower || d.InheritedConsumesPower) out.push({ name: "consomme du courant", level: "Industrial", from: null });
  for (const c of new Set([...(d.CostList ?? []), ...(d.InheritedCostList ?? [])])) {
    const level = COST_FLOOR[c];
    if (level) out.push({ name: `coute ${c}`, level, from: null });
  }
  return out;
}

export type TechItem = {
  key: string;
  label: string;
  defType: string;
  defName: string | null;
  // The level the game currently sees on the def, written or inherited.
  current: TechLevel | null;
  how: "build" | "craft" | "sow" | "recipe" | "unlock";
  // null: every prerequisite is unknown (another mod's, or Anomaly's), so the
  // item is listed but does not count toward the range.
  step: TechStep | null;
  // What placed the item: its prerequisites with their levels (`from` names
  // the base a prerequisite was inherited from), and whether the item's own
  // techLevel was the later of the two.
  gates: { name: string; level: TechLevel | null; from: string | null }[];
  objectWins: boolean;
};

// `vanillaResearch` maps every Core and DLC research project to its level;
// the mod's own projects are added on top. A prerequisite that neither knows —
// a project from another mod, or an Anomaly one, which has no level — is
// skipped rather than guessed.
export function techItems(defs: TechDef[], vanillaResearch: Record<string, string | null>): TechItem[] {
  const research: Record<string, string | null> = { ...vanillaResearch };
  for (const d of defs) if (d.DefType === "ResearchProjectDef" && d.DefName) research[d.DefName] = d.TechLevel ?? null;

  // What a research-gated recipe makes is obtainable too, and only as early as
  // that recipe: a brain fragment grown at a machine behind spacer research is
  // not loot. Recipes without research are ignored for the same reason they
  // are not counted themselves.
  const madeBy = new Map<string, { name: string; from: string | null }[]>();
  for (const r of defs) {
    if (r.DefType !== "RecipeDef" || r.IsAbstract) continue;
    const g = gatesOf(r);
    if (g.length === 0) continue;
    for (const p of r.Products ?? []) if (!madeBy.has(p)) madeBy.set(p, g);
  }

  const items: TechItem[] = [];
  for (const d of defs) {
    const product = !obtainable(d) && !d.IsAbstract && d.DefType === "ThingDef" && d.DefName ? madeBy.get(d.DefName) : undefined;
    if (!obtainable(d) && !product) continue;
    const base = {
      key: d.Key ?? d.DefName ?? "",
      label: d.Label || d.DefName || d.Key || "",
      how: product ? "craft" as const : howObtained(d),
      defType: d.DefType ?? "",
      defName: d.DefName ?? null,
      current: isLevel(d.TechLevel) ? d.TechLevel : null,
    };
    const gates = [
      ...(product ?? gatesOf(d)).map((g) => {
        const level = research[g.name];
        return { ...g, level: isLevel(level) ? level : null };
      }),
      ...requirementsOf(d),
    ];
    // The later of two readings: the research that gates the item, and the
    // techLevel the item carries. Research alone missed what the author said —
    // a tribal headband marked Neolithic; the level alone missed what the
    // recipe demands — a bandana marked Neolithic that needs Complex Clothing.
    const known = gates.map((g) => g.level).filter((l): l is TechLevel => l !== null);
    const byResearch = known.length === 0 ? null : known.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    const own = base.current;
    const objectWins = own !== null && (byResearch === null || rank(own) > rank(byResearch));
    // Prerequisites nobody can place, and no level on the item: listed, not counted.
    const step: TechStep | null = objectWins ? own : byResearch ?? (gates.length > 0 ? null : "Animal");
    items.push({ ...base, step, gates, objectWins });
  }
  return items.sort((a, b) => (a.step === null ? 1 : 0) - (b.step === null ? 1 : 0) || rank(a.step ?? "Animal") - rank(b.step ?? "Animal"));
}

// The correction an item calls for: its research places it later than the
// techLevel the game sees. Under the "later of the two" rule a correction can
// only raise a level. Only ThingDefs carry a techLevel the game reads; a
// recipe or a floor has none to fix.
export function proposedFix(i: TechItem): { from: TechLevel | null; to: TechLevel } | null {
  if (i.defType !== "ThingDef" || !i.defName || i.step === null) return null;
  // Day-one content with no level written proposes nothing: writing Animal on
  // every stool and fence would only add lines to review.
  if (i.step === "Animal" && i.current === null) return null;
  // A crop's techLevel is read by nothing a player sees: no trader stocks it, no
  // faction carries it. Proposing one would only add lines to review.
  if (i.how === "sow") return null;
  return i.step === i.current ? null : { from: i.current, to: i.step };
}

// Concrete defs that carry a tech level but that no colony can obtain — loot,
// trader stock, a recipe removed on purpose. They do not place the mod unless
// nothing else does, and then they are the only thing the range is made of, so
// the sheet lists them rather than show a bare "declared".
export type UnobtainableItem = { key: string; label: string; level: TechLevel; recipeRemoved: boolean };

export function unobtainableItems(defs: TechDef[]): UnobtainableItem[] {
  const products = new Set(
    defs.filter((r) => r.DefType === "RecipeDef" && !r.IsAbstract && gatesOf(r).length > 0).flatMap((r) => r.Products ?? []),
  );
  return defs
    .filter((d) => !obtainable(d) && !d.IsAbstract && d.DefType === "ThingDef" && isLevel(d.TechLevel) && !products.has(d.DefName ?? ""))
    .map((d) => ({
      key: d.Key ?? d.DefName ?? "",
      label: d.Label || d.DefName || d.Key || "",
      level: d.TechLevel as TechLevel,
      recipeRemoved: !!d.RecipeMakerRemoved,
    }))
    .sort((a, b) => rank(a.level) - rank(b.level));
}

export function techRange(defs: TechDef[], vanillaResearch: Record<string, string | null>): TechRange | null {
  const steps = techItems(defs, vanillaResearch).map((i) => i.step).filter((s): s is TechStep => s !== null);
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
