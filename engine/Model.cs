namespace CherryPick;

// A scanned source mod. Several of them can end up in one extraction: some merge
// (Animal Ark aggregates sixteen). But the scan itself stays mod by mod, on
// demand.
public sealed class ModInfo
{
    public string Id { get; set; } = "";            // folder name: Workshop id, or local name
    public string Name { get; set; } = "";
    public string Author { get; set; } = "";
    public string PackageId { get; set; } = "";
    public string Path { get; set; } = "";
    public List<string> SupportedVersions { get; set; } = new();

    // The <description> of About.xml, as written by the mod's author. Shown on
    // hover in the list: it is the one piece of context that answers "what does
    // this actually do" without opening the mod's own page.
    public string Description { get; set; } = "";

    // Dependencies declared in About.xml. The picker has to be able to say which
    // ones become useless once the selection is made.
    public List<string> DeclaredDependencies { get; set; } = new();

    // Content roots kept, read from LoadFolders.xml when there is one.
    public List<string> ContentRoots { get; set; } = new();

    // The ones that only load under a condition (IfModActive / IfModNotActive).
    // They are inventoried all the same: we want to see everything the mod can
    // bring, even if that means flagging it as conditional.
    public List<string> ConditionalRoots { get; set; } = new();

    // True when no supported version reaches 1.6: the mod is dead, hence a
    // candidate for a public port rather than a private extraction.
    public bool DeadBefore16 { get; set; }
}

// What a def references. Each list feeds the dependency closure.
public sealed class DefRefs
{
    // Tokens shaped like a defName. Deliberately permissive: better to pull one
    // def too many into the closure than to miss one and ship a broken mod.
    public List<string> Defs { get; set; } = new();

    // The subset coming from tags that REALLY carry a def reference. Feeds the
    // "unresolved references" report: on the permissive list that report drowned
    // under labels, enums and booleans — `true`, `Item`, `barrel`, `stock` — and
    // became unreadable, therefore useless.
    public List<string> StrictDefs { get; set; } = new();

    // Qualified C# classes: Class=, thingClass, compClass, workerClass, and the
    // custom tags of the <ItemProcessor.CombinationDef> kind.
    public List<string> Classes { get; set; } = new();

    public List<string> Textures { get; set; } = new();
    public List<string> Sounds { get; set; } = new();
    public List<string> Research { get; set; } = new();
}

// One link in a def's inheritance chain.
public sealed class ParentStep
{
    public string Name { get; set; } = "";

    // Where this parent comes from: "mod" (declared here), "game" (a Core or DLC
    // base), or "missing" — a parent that is named but that nobody provides. That
    // last case is not cosmetic: it comes from a dependency we did not scan, and
    // it is what explains an empty tech level or Architect category.
    public string Origin { get; set; } = "";
}

public sealed class DefEntry
{
    public string Key { get; set; } = "";           // "ThingDef/BioForge" or "ThingDef/Name=BuildingBase"
    public string DefType { get; set; } = "";
    public string? DefName { get; set; }
    public string? AbstractName { get; set; }       // Name= attribute
    public bool IsAbstract { get; set; }
    public string? Label { get; set; }
    public string? ParentName { get; set; }

    // Progression level shown in the picker: Neolithic, Medieval, Industrial,
    // Spacer... Often absent from the def itself and inherited from the parent,
    // hence the separately resolved field.
    public string? TechLevel { get; set; }
    public string? TechLevelFrom { get; set; }        // def it is inherited from, if inherited

    // For a building: where it shows up in the Architect menu. Like the tech
    // level, almost always inherited from the parent.
    public string? ArchitectCategory { get; set; }
    public string? ArchitectCategoryFrom { get; set; }

    // The parent chain, climbed to its root. A mod def says almost nothing about
    // itself: cost, size, stats and category all come from successive bases.
    // Without the chain, a value that is genuinely absent cannot be told apart
    // from one inherited higher up.
    public List<ParentStep> ParentChain { get; set; } = new();

    public string Mod { get; set; } = "";
    public string File { get; set; } = "";
    public int Line { get; set; }

    // Links tying this def to another. A PawnKindDef without its race is nothing,
    // and neither is a recipe without its product: showing them separately would
    // let one be ticked while the other is dropped.
    public string? Race { get; set; }            // PawnKindDef -> ThingDef
    public List<string> Products { get; set; } = new();   // RecipeDef -> what it makes
    public string? AddsHediff { get; set; }      // RecipeDef -> hediff it applies

    // <thingCategories> and, for an apparel, <apparel><layers>. Neither feeds the
    // dependency closure -- they exist only to guess what a mod is FOR, in the
    // pickers background category suggestion. Read as declared on THIS def only:
    // many mods put them on an abstract base instead and let concrete items
    // inherit through ParentName, so the picker side counts every def, abstract
    // included, rather than resolving the chain here the way TechLevel and
    // ArchitectCategory do.
    public List<string> ThingCategories { get; set; } = new();
    public List<string> ApparelLayers { get; set; } = new();

    // <race><intelligence>: Animal, ToolUser, or Humanlike. Distinguishes a new
    // animal species (a ThingDef with its own <race>, still just an animal)
    // from a new playable people (same shape, but Humanlike) -- the picker
    // guessed every ThingDef+race as "races" at first, and a rabbit mod ended
    // up suggesting it alongside actual elf/dwarf mods.
    public string? RaceIntelligence { get; set; }

    // Whether a colony can actually obtain this def: made at a bench
    // (<recipeMaker> declared on the def itself) or sown (<plant><sowTags>).
    // Read by the picker's tech-level range, which only counts content a player
    // can build, craft or grow — loot, animals and motes say nothing about what
    // a mod asks of a colony's research.
    public bool Craftable { get; set; }

    // <recipeMaker IsNull="True"/>: the def deliberately removes the recipe its
    // base would give it — loot or trader stock only. Without this, the element's
    // mere presence read as "craftable", and an inherited *Makeable* base would
    // too.
    public bool RecipeMakerRemoved { get; set; }

    // The research a recipeMaker asks for, and where it came from. A child's
    // <recipeMaker> MERGES with its parent's, so a gun that only states its skill
    // requirement still needs the Gunsmithing its base asks for. Own values are
    // read in Scanner.ReadDef; the inherited ones are resolved in Inherited.cs
    // and kept apart from Refs.Research, which the dependency closure reads.
    public List<string> RecipeResearch { get; set; } = new();
    public bool RecipeMakerNoInherit { get; set; }
    public List<string> InheritedRecipeResearch { get; set; } = new();

    // What the def costs (<costList> element names, as declared on the def) and
    // whether it draws power. Read by the picker's tech reading: a stove with no
    // research is still not a day-one building if it runs on electricity and
    // costs industrial components.
    public List<string> CostList { get; set; } = new();
    public bool ConsumesPower { get; set; }

    // <researchPrerequisites> as written on the def — what gates building it
    // from the Architect tab, unlike the recipe's research above.
    public List<string> ResearchPrerequisites { get; set; } = new();

    // The same three, gathered up the parent chain. XML inheritance merges a
    // child's lists and comps into its parent's, so a cannon whose abstract base
    // names Mortars, a costList and a power comp needs all three. Kept apart
    // from the def's own values so the sheet can say where each comes from.
    public List<string> InheritedResearchPrerequisites { get; set; } = new();
    public List<string> InheritedCostList { get; set; } = new();
    public bool InheritedConsumesPower { get; set; }
    public string? InheritedRecipeResearchFrom { get; set; }
    public bool Sowable { get; set; }

    // Defs this one appears to own: the hediff a food grants, the thought it
    // leaves. The tie is only made if NOBODY ELSE claims them — a hediff shared by
    // five items belongs to all five, therefore to none, and merging them would
    // build an absurd group.
    public List<string> Owns { get; set; } = new();

    // True when this defName already exists in the game: the def creates nothing,
    // it REPLACES the game's own. A retexture mod is made of these and nothing
    // else. Without this flag the tool presents them as new content, when in fact
    // they do not extract — they fight over the def with every other mod that
    // touches it, and the last one loaded wins.
    public bool OverridesVanilla { get; set; }

    // The part of the defName before the first underscore, and whether it differs
    // from the mod's own. A def named after somebody else is almost never the
    // author's content — see Prefixes.
    public string? DefNamePrefix { get; set; }
    public bool ForeignPrefix { get; set; }

    // Key of the group this def belongs to. One decision per group.
    public string? GroupKey { get; set; }

    // Set when the def is kept behind a MayRequire / MayRequireAnyOf.
    public List<string> MayRequire { get; set; } = new();

    public DefRefs Refs { get; set; } = new();

    // Texture files actually found on disk, and paths that resolve nowhere — the
    // latter flag a missing drawing.
    public List<string> TextureFiles { get; set; } = new();
    public List<string> MissingTextures { get; set; } = new();

    // Display convenience: the label if there is one, else the defName.
    public string Display => string.IsNullOrWhiteSpace(Label) ? (DefName ?? AbstractName ?? Key) : Label!;
}

// A patch file. It declares no def but targets some, and a patch whose target is
// not kept is an orphan: that is the defect that made two Medieval Homestead
// operations fail at load.
public sealed class PatchEntry
{
    public string Mod { get; set; } = "";
    public string File { get; set; } = "";
    public List<string> TargetDefs { get; set; } = new();     // defName= read from the xpaths
    public List<string> Classes { get; set; } = new();
    public List<string> GuardedByMods { get; set; } = new();  // PatchOperationFindMod

    // True when the file protects itself some other way than by naming a mod.
    //
    // The older idiom is a PatchOperationSequence opening with a
    // PatchOperationTest: the sequence STOPS at the first operation that fails,
    // so a failed test cancels everything after it, and <success>Always</success>
    // keeps the failure out of the log. It guards as well as FindMod does, and it
    // is what mods written before 1.3 use.
    //
    // Without this, the tool called Dalmatians' A Dog Said patch unguarded, and a
    // porting session had to be told not to "fix" something that was intact.
    public bool GuardedByTest { get; set; }
}

public sealed class Inventory
{
    public List<ModInfo> Mods { get; set; } = new();
    public List<DefEntry> Defs { get; set; } = new();
    public List<PatchEntry> Patches { get; set; } = new();

    // Unreadable XML, missing About... Reported to the interface rather than
    // written to stderr, so that nothing gets lost.
    public List<string> Problems { get; set; } = new();

    // How many of the mod's defs replace a game def. A retexture mod has almost
    // all of them; a content mod, none.
    public int OverrideCount { get; set; }

    // The naming prefix this mod uses for its own defs, and how many defs do not
    // follow it.
    public string? OwnPrefix { get; set; }
    public int ForeignPrefixCount { get; set; }

    // Files the mod ships outside Defs/ and Patches/, counted in its content
    // roots only. A retexture, a music pack, a translation or a pure C# mod
    // often has no def at all, so without these counts the mod is invisible to
    // anything that tries to say what it is for.
    public AssetCounts Assets { get; set; } = new();
}

public sealed class AssetCounts
{
    public int Assemblies { get; set; }     // Assemblies/*.dll
    public int Textures { get; set; }       // Textures/ images
    public int Sounds { get; set; }         // Sounds/ audio
    public int Languages { get; set; }      // any file under Languages/
    public int AssetBundles { get; set; }   // AssetBundles/ — textures packed for Unity
}

// One entry of RimWorld's active modlist.
public sealed class ActiveMod
{
    public string PackageId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Author { get; set; } = "";
    public string Path { get; set; } = "";
    public string Source { get; set; } = "";        // workshop, local, or official
    public bool Found { get; set; }
    public bool Active { get; set; }        // present in ModsConfig.xml
    public List<string> SupportedVersions { get; set; } = new();
    public bool DeadBefore16 { get; set; }

    public string Description { get; set; } = "";

    // Declared in About.xml, and which of those are not installed at all — not
    // "not active", installed: a declared dependency that is merely inactive is
    // the modlist's business, not the mod's. An installed-but-inactive one is
    // therefore absent from this list on purpose.
    public List<string> DeclaredDependencies { get; set; } = new();
    public List<string> MissingDependencies { get; set; } = new();
}
