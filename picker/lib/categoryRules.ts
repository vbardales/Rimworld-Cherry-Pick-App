import type { CategoryId } from "./labels";

// What a mod is FOR, guessed from its scanned inventory. Pure — no disk, no
// engine — so it can be measured against the real triage in
// data/mod-labels.json before it ever reaches the list.
//
// Every signal here was chosen by that measurement, not by reading RimWorld's
// XML and reasoning about it: the first version did the reasoning, and half its
// rules either never matched (PlantDef and VehicleDef are not XML tags) or
// matched the wrong thing (a bare HediffDef is medical in 42% of mods). The
// inherited base (ParentName) turned out to be the strongest signal by far —
// AnimalThingBase is animals 94% of the time — and a mod's FILES outside Defs/
// are the only signal at all for most retextures, music packs and C# mods,
// which have no defs.
//
// Bump ANALYSIS_RULE_VERSION in techLevels.ts whenever a rule here changes.

export type DefSignals = {
  DefType?: string;
  DefName?: string | null;
  Label?: string | null;
  IsAbstract?: boolean;
  AbstractName?: string | null;
  ParentName?: string | null;
  // Every base up to the root, as the engine resolved it. The direct parent is
  // not enough: a mod routes its plants through its own VG_PlantDef, its guns
  // through its own BaseGunEveCo — and every one of those still ends at
  // PlantBase or BaseGun.
  ParentChain?: { Name: string }[];
  ArchitectCategory?: string | null;
  ThingCategories?: string[];
  ApparelLayers?: string[];
  Race?: string | null;
  RaceIntelligence?: string | null;
};

export type AssetSignals = {
  Assemblies?: number;
  Textures?: number;
  Sounds?: number;
  Languages?: number;
  AssetBundles?: number;
};

export type ModSignals = {
  defs: DefSignals[];
  assets?: AssetSignals;
  dependencies?: string[];
  // The mod's display name and packageId, read for a handful of words only.
  name?: string;
  packageId?: string;
  // How many patch files the mod carries, and the categories of the mods it
  // declares as dependencies — what a person confirmed for them, else what the
  // scan suggested. Read only for a mod made of patches and nothing else.
  patchCount?: number;
  dependencyCategories?: CategoryId[];
  // The vanilla defs its patches target, for a mod made of patches only.
  patchTargets?: DefSignals[];
};

// A retexture or a music pack says so in its name. Measured on 1,960 labelled
// mods: 0.91 precision, and 42% of "textures" caught — most of them mods that
// have no def at all to read.
// Childhood said in words. No def type or base marks it — a relationship, a
// thought, a backstory is about children only by what it is called. Read in the
// mod's name, or in at least 30% of its concrete defs' names and labels.
// Measured: precision 0.68, recall 0.52, where nothing found it before; the
// misses left in the triage are mostly pregnancy and contraception mods.
const CHILDHOOD_WORDS = /adopt|pregnan|orphan|\bchild|children|childhood|infant|toddler|newborn|nursery|daycare|\bcrib|growth ?moment|breastfe|lactat/i;

// The last resort: words in the mod's own name, read only when nothing in its
// content spoke — a compatibility patch aimed at other mods' items has nothing
// else. Measured: 7 more mods with a right suggestion, precision unchanged.
const NAME_WORDS: [RegExp, CategoryId][] = [
  [/apparel|cloth|outfit|hat\b|hair/i, "apparel"],
  [/\brace|xenotype|alien/i, "races"],
  [/animal|pet\b|beast|creature/i, "animals"],
  [/weapon|\bgun|armou?r|melee/i, "armor"],
  [/furniture|storage|shelf/i, "furniture"],
  [/\bfood|meal|cook|drink/i, "food"],
  [/medic|surgery|health/i, "medical"],
  [/\bplant|crop|farm|garden/i, "plants"],
  [/faction|raider|pirate/i, "factions"],
];

const TEXTURE_NAME = /textur|retex|music|song|soundtrack|(?:^|[^a-z])ost(?:[^a-z]|$)/i;

// A strong signal suggests its category on its own. A weak one (a bare
// HediffDef, a JobDef) is right often enough to back a category something else
// already pointed at, never enough to raise one alone.
type Hit = { cat: CategoryId; strong: boolean };

// Measured: 17 false positives -> 5 for 4 real plant mods lost, all of them
// packs with 2 plants in 60 things — indistinguishable from a food mod's crop.
const PLANT_SHARE = 0.2;

const ANIMAL_BASES = new Set(["AnimalThingBase", "AnimalKindBase", "EggFertBase", "EggUnfertBase"]);
const WEAPON_BASE = /^Base(Bullet|Weapon|MeleeWeapon|HumanMakeableGun|MakeableGun|Gun|Projectile|Grenade)/;
const APPAREL_BASE = /^(Apparel|Hat|ArmorHelmet|NobleHat|ArmorSmithable|ArmorMachineable).*Base$/;
const MEDICAL_BASES = new Set([
  "MedicineBase", "AddictionBase", "DrugToleranceBase", "DrugAddictionNeedBase", "SurgeryFlesh",
  "ImplantHediffBase", "BodyPartBionicBase", "BodyPartProstheticBase",
  "BodyPartProstheticMakeableBase", "BodyPartArchotechBase",
]);
const FACTION_BASES = new Set([
  "FactionBase", "OutlanderBase", "PlayerFactionBase", "BasePlayerPawnKind",
  "TribeBase", "OutlanderFactionBase", "PirateBandBase",
]);
const RACE_GENE_BASE = /^Gene(Ears|Tail|Horns|Hair|Beard|Body|Head|Face|Skin)/;

// Case-insensitive packageId prefixes. A dependency on these frameworks says
// what the mod is for more reliably than anything in its defs — and for lewd
// and vehicles it is the only usable signal: too few mods in the triage to
// learn a rule from.
const DEPENDENCY_HINTS: [string, CategoryId][] = [
  ["erdelf.humanoidalienraces", "races"],
  ["smashphil.vehicleframework", "vehicles"],
  ["rim.job.world", "lewd"],
];

function defHits(d: DefSignals): Hit[] {
  const hits: Hit[] = [];
  const s = (cat: CategoryId) => hits.push({ cat, strong: true });
  const w = (cat: CategoryId) => hits.push({ cat, strong: false });

  const type = d.DefType ?? "";
  const parent = d.ParentName ?? "";
  const bases = [parent, ...(d.ParentChain ?? []).map((p) => p.Name)].filter(Boolean);
  const inherits = (test: (b: string) => boolean) => bases.some(test);
  const inheritsFrom = (set: Set<string>) => inherits((b) => set.has(b));
  const arch = d.ArchitectCategory ?? "";
  const cats = d.ThingCategories ?? [];
  const cat = (re: RegExp) => cats.some((c) => re.test(c));

  // animals
  if (inheritsFrom(ANIMAL_BASES)) s("animals");
  else if (type === "ThingDef" && d.Race && d.RaceIntelligence !== "Humanlike") s("animals");

  // races — genes are handled at mod level, see modHits
  if (type === "HeadTypeDef" || type === "XenotypeDef" || type.includes("AlienRace")) s("races");
  if (inherits((b) => RACE_GENE_BASE.test(b))) s("races");
  if (type === "ThingDef" && d.Race && d.RaceIntelligence === "Humanlike") s("races");

  // weapons & armour
  if (inherits((b) => WEAPON_BASE.test(b) || /Armou?r.*Base$/.test(b))) s("armor");
  // Also how an animal's bite or a race's claws are described: backs a
  // weapons mod, never makes one.
  if (type === "DamageDef" || type === "ToolCapacityDef" || type === "ManeuverDef") w("armor");
  if (cat(/weapon|armor/i)) s("armor");

  // apparel & hair
  if (inherits((b) => APPAREL_BASE.test(b)) || (d.ApparelLayers ?? []).length > 0) s("apparel");
  if (type === "HairDef" || type === "BeardDef") s("apparel");

  // medical
  if (inheritsFrom(MEDICAL_BASES) || type === "ChemicalDef") s("medical");
  if (type === "HediffDef") w("medical");

  // joy
  if (type === "JoyGiverDef" || type === "JoyKindDef" || arch === "Joy" || cat(/^Buildings(Joy|Art)$/)) s("joy");

  // factions
  if (inheritsFrom(FACTION_BASES) || type === "FactionDef" || type === "ScenarioDef" || type === "CultureDef") s("factions");

  // ideology
  if (/^(HistoryEvent|Issue|Meme|Precept|StyleCategory|StyleItemCategory|PrisonerInteractionMode)Def$/.test(type)) s("ideology");
  if (type.startsWith("Ritual")) s("ideology");

  // furniture, floors & walls
  if (arch === "Furniture" || cat(/furniture/i)) s("furniture");
  if (arch === "Structure" || arch === "Floors" || inherits((b) => b === "RockBase" || b === "TileStoneBase")) s("structure");

  // plants & food
  // A crop is how a food mod gets its ingredient, and how an animal mod feeds
  // its creature: a plant base backs a plants mod, it does not make one.
  // The growing thing itself, not its harvest: PlantFoodRawBase is the vegetable
  // in the stockpile, which a food mod has too.
  if (inherits((b) => b === "PlantBase" || b === "PlantBaseNonEdible" || b === "TreeBase" || b === "BushBase")) s("plants");
  else if (cat(/^PlantMatter$/)) w("plants");
  if (cat(/^(Foods|FoodMeals|FoodRaw|MeatRaw)/)) s("food");
  // A meal or a drink says so in its base: MealBase, MealCooked... Measured: food
  // 0.76/0.33 -> 0.67/0.42.
  if (type === "ThingDef" && inherits((b) => /^Meal/.test(b) || b === "DrinkBase" || b === "PastryBase")) s("food");

  // retextures & music
  if (type === "SongDef") s("textures");

  // childhood itself
  // Every animal and every custom race defines its own life stages too — not
  // once was this right on its own in the triage.
  if (type === "LifeStageDef") w("children");

  // gameplay is the catch-all: common everywhere, decisive nowhere
  if (/^(Job|Thought|WorkGiver|ResearchProject|Incident)Def$/.test(type)) w("gameplay");

  return hits;
}

export function suggestCategories(mod: ModSignals): CategoryId[] {
  const strong = new Map<CategoryId, number>();
  const weak = new Map<CategoryId, number>();
  const add = (m: Map<CategoryId, number>, c: CategoryId, n = 1) => m.set(c, (m.get(c) ?? 0) + n);

  // An abstract base speaks for the concrete defs that inherit it — often the
  // only place a mod writes its category. One that nothing in the mod inherits
  // is a template for something else to fill in: a framework's base, or the
  // shape a C# tool stamps onto buildings chosen in its settings.
  const inheritedInMod = new Set(
    mod.defs.filter((d) => !d.IsAbstract).flatMap((d) => [d.ParentName, ...(d.ParentChain ?? []).map((p) => p.Name)]),
  );
  const counted = mod.defs.filter((d) => !d.IsAbstract || (d.AbstractName && inheritedInMod.has(d.AbstractName)));
  for (const d of counted) for (const h of defHits(d)) add(h.strong ? strong : weak, h.cat);

  // Styles are a retexture when they are a large part of what the mod is: a
  // style pack. In a race or faction mod they are that people's look, one
  // feature among many. Measured: textures 0.76/0.77 -> 0.82/0.73.
  const styles = counted.filter((d) => d.DefType === "ThingStyleDef").length;
  const concrete = counted.filter((d) => !d.IsAbstract).length;
  if (styles > 0 && styles >= 0.3 * concrete) add(strong, "textures", styles);

  // Nearly every content mod grows something — the crop behind a food mod's
  // meal, the forage behind an animal mod's creature. A plants mod is one whose
  // things are MOSTLY plants: below this share of its concrete ThingDefs, the
  // plants only back the category, they do not raise it.
  const things = mod.defs.filter((d) => d.DefType === "ThingDef" && !d.IsAbstract).length;
  const plantDefs = strong.get("plants") ?? 0;
  if (plantDefs > 0 && plantDefs < PLANT_SHARE * things) {
    strong.delete("plants");
    add(weak, "plants", plantDefs);
  }

  // A gene next to a xenotype or a head type is part of a new people; a gene on
  // its own is the biotech mechanic. Measured: genes sit in "races" in the
  // triage, but a mod of loose genes is exactly what "biotech" is meant for.
  const genes = mod.defs.filter((d) => d.DefType === "GeneDef").length;
  const traits = mod.defs.filter((d) => d.DefType === "TraitDef").length;
  const peopleSignals = mod.defs.some((d) => d.DefType === "XenotypeDef" || d.DefType === "HeadTypeDef");
  if (genes > 0) add(strong, peopleSignals ? "races" : "biotech", genes);
  if (traits > 0) add(strong, "biotech", traits);

  const concreteDefs = counted.filter((d) => !d.IsAbstract);
  const childish = concreteDefs.filter((d) => CHILDHOOD_WORDS.test(`${d.DefName ?? ""} ${d.Label ?? ""}`)).length;
  if (CHILDHOOD_WORDS.test(`${mod.name ?? ""} ${mod.packageId ?? ""}`) || (childish > 0 && childish >= 0.3 * concreteDefs.length))
    add(strong, "children", Math.max(childish, 1));

  if (TEXTURE_NAME.test(`${mod.name ?? ""} ${mod.packageId ?? ""}`)) add(strong, "textures", 1000);

  for (const dep of mod.dependencies ?? []) {
    const id = dep.toLowerCase();
    for (const [prefix, c] of DEPENDENCY_HINTS) if (id.startsWith(prefix)) add(strong, c, 1000);
  }

  // Files outside Defs/. No defs, no C#, only media: a retexture or a music
  // pack (measured 0.78 and 1.00). Many images next to few defs: a style or
  // variant pack whose defs only exist to hang the art on.
  const a = mod.assets;
  const defCount = mod.defs.length;
  if (a) {
    const media = (a.Textures ?? 0) + (a.AssetBundles ?? 0) + (a.Sounds ?? 0);
    const dll = a.Assemblies ?? 0;
    if (dll === 0 && media > 0 && defCount === 0) add(strong, "textures", 1000);
    // Only when the defs said nothing else: a creature with seventy coat
    // variants is an animal mod, not a retexture.
    else if (dll === 0 && strong.size === 0 && (a.Textures ?? 0) >= 8 * Math.max(defCount, 1)) add(strong, "textures", media);
  }

  // Only now can weak signals speak: to back a category already found, or —
  // for gameplay — when nothing else was found at all.
  for (const [c, n] of weak) {
    if (strong.has(c)) add(strong, c, n);
  }
  // Buildings and nothing else to go on: furniture. BuildingBase alone is
  // furniture only 39% of the time — a workbench mod is gameplay, an arcade
  // cabinet joy — so it never competes with a real signal, and a JobDef or a
  // WorkGiverDef next to the building says the building is a means, not the
  // point. Measured: furniture 0.84/0.39 -> 0.78/0.46, gameplay unchanged.
  const buildings = mod.defs.filter((d) =>
    d.DefType === "ThingDef" && !d.IsAbstract &&
    [d.ParentName, ...(d.ParentChain ?? []).map((p) => p.Name)].includes("BuildingBase")).length;
  if (strong.size === 0 && buildings > 0 && !weak.has("gameplay")) add(strong, "furniture", buildings);
  if (strong.size === 0 && weak.has("gameplay")) add(strong, "gameplay", weak.get("gameplay")!);

  // A race mod ships its own faction to spawn the race in — and is still filed
  // as a race, not a faction.
  if (strong.has("races")) strong.delete("factions");

  // A DLL and nothing else to go on: most likely C# behaviour or UI. Right
  // less than half the time (0.43), so it never outranks a real signal.
  // Its own def types only — settings lists, framework tables — say nothing a
  // player would build or meet: still behaviour or UI.
  // Counted on the defs that weigh: an unused template base is no content.
  // Vanilla def types that only shape the interface — a hotkey, a menu button,
  // a column of the work tab — say nothing a pawn meets either.
  const UI_TYPES = new Set(["KeyBindingDef", "KeyBindingCategoryDef", "MainButtonDef", "PawnTableDef", "PawnColumnDef"]);
  const onlyOwnTypes = counted.length > 0
    && counted.every((d) => (d.DefType ?? "").includes(".") || UI_TYPES.has(d.DefType ?? ""));
  if (strong.size === 0 && a && (a.Assemblies ?? 0) > 0 && (counted.length === 0 || onlyOwnTypes)) add(strong, "engine");
  // A translation: languages and nothing else — engine and UI, by direct
  // instruction; no such mod in the triage to measure it on.
  if (strong.size === 0 && a && counted.length === 0 && (a.Assemblies ?? 0) === 0 && (a.Languages ?? 0) > 0
      && (a.Textures ?? 0) + (a.Sounds ?? 0) + (a.AssetBundles ?? 0) === 0) add(strong, "engine");

  // A DLL next to a few vanilla defs no rule recognises — two hediffs, a thought —
  // is C# behaviour hung on them: a gameplay mechanic. Measured: 18 more mods
  // with a right suggestion, gameplay 0.74/0.21 -> 0.69/0.28.
  if (strong.size === 0 && a && (a.Assemblies ?? 0) > 0 && counted.length > 0) add(strong, "gameplay");

  // Nothing of its own to go on and no C#: patches, recipes for another mod's
  // materials, balance tweaks. Such a mod is about the mod it depends on.
  // Measured: patches-only mods 12 right in 15; widened to every mod left with no
  // signal, 10 more mods with a right suggestion and no loss of precision.
  if (strong.size === 0 && (a?.Assemblies ?? 0) === 0) for (const c of mod.dependencyCategories ?? []) add(strong, c);

  // Patches on vanilla defs and nothing else: the mod is about what it patches,
  // and it is almost always a tweak of it. Measured on the 54 such mods of the
  // triage: the targets' categories plus gameplay put at least one right in 44,
  // precision 0.52, recall 0.67 — targets alone were right in 24.
  const onlyPatches = counted.length === 0 && (a?.Assemblies ?? 0) === 0 && (mod.patchCount ?? 0) > 0;
  if (strong.size === 0 && onlyPatches && (mod.patchTargets ?? []).length > 0) {
    for (const d of mod.patchTargets!) for (const h of defHits(d)) if (h.strong) add(strong, h.cat);
    add(strong, "gameplay");
  }

  // Nothing but recipes, and nothing else said what they serve: a production
  // tweak — synthread and hyperweave made another way. Not measured: five such
  // mods in the triage, too few to learn from; surgeries already read as medical
  // through their base, dependency-bound recipes take their dependency's category.
  const concreteCounted = counted.filter((d) => !d.IsAbstract);
  if (strong.size === 0 && concreteCounted.length > 0 && concreteCounted.every((d) => d.DefType === "RecipeDef")) add(strong, "gameplay");

  // Last resort, the mod's name: nothing in its content spoke.
  if (strong.size === 0) {
    const text = `${mod.name ?? ""} ${mod.packageId ?? ""}`;
    for (const [re, c] of NAME_WORDS) if (re.test(text)) add(strong, c);
  }

  return [...strong.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([c]) => c);
}
