using System.Xml.Linq;

namespace CherryPick;

// Resolves the fields a def gets from its parents.
//
// Two of them matter to the picker and are almost never declared on the def
// itself:
//
//   techLevel            — the progression level (Neolithic, Medieval,
//                          Industrial, Spacer...) shown next to every object
//   designationCategory  — for a building, the Architect menu tab it shows up in
//
// Both usually come down from an abstract base: a piece of furniture does not say
// "Furniture", BuildingBase or FurnitureBase says it. Reading the def alone would
// therefore leave both columns empty on virtually all content, which would amount
// to not showing them at all.
//
// The parent chain crosses mod boundaries: most defs inherit from bases of the
// game. So the abstract defs of Core are indexed too, without which everything
// deriving from BuildingBase would stay unanswered.
public static class Inherited
{
    public static void Resolve(Inventory inv, string? gameDataDir = null)
    {
        // Index of the available abstract defs, by Name attribute.
        var byName = new Dictionary<string, DefEntry>(StringComparer.Ordinal);
        foreach (var d in inv.Defs)
            if (d.AbstractName is { Length: > 0 } n) byName[n] = d;

        // The bases of the game, if we have them at hand.
        var core = gameDataDir is null ? new Dictionary<string, CoreBase>(StringComparer.Ordinal)
                                       : LoadCoreBases(gameDataDir);

        foreach (var d in inv.Defs)
        {
            var (tech, techFrom) = Climb(d, byName, core, e => e.TechLevel, c => c.TechLevel);
            d.TechLevel = tech;
            d.TechLevelFrom = techFrom;

            var (cat, catFrom) = Climb(d, byName, core, e => e.ArchitectCategory, c => c.DesignationCategory);
            d.ArchitectCategory = cat;
            d.ArchitectCategoryFrom = catFrom;

            d.ParentChain = Chain(d, byName, core);
        }
    }

    // The full chain, for display. Same walk as Climb, but we do not stop at the
    // first value: we go to the root, noting on the way who provides each link.
    //
    // A "missing" link is the most useful piece of information in the list: it
    // says the def inherits from a base we do not have at hand, hence that
    // everything shown about it may be incomplete.
    static List<ParentStep> Chain(
        DefEntry start,
        Dictionary<string, DefEntry> byName,
        Dictionary<string, CoreBase> core)
    {
        var steps = new List<ParentStep>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var parent = start.ParentName;

        // An inheritance loop is possible in a badly written mod: seen stops it.
        while (!string.IsNullOrWhiteSpace(parent) && seen.Add(parent))
        {
            if (byName.TryGetValue(parent, out var p))
            {
                steps.Add(new ParentStep { Name = parent, Origin = "mod" });
                parent = p.ParentName;
            }
            else if (core.TryGetValue(parent, out var cb))
            {
                steps.Add(new ParentStep { Name = parent, Origin = "game" });
                parent = cb.ParentName;
            }
            else
            {
                steps.Add(new ParentStep { Name = parent, Origin = "missing" });
                break;
            }
        }
        return steps;
    }

    // Climbs the ParentName chain until a value is found. Also returns the name of
    // the def that provided it, so the interface can say "inherited from
    // BuildingBase" rather than let a value pass for the def's own.
    static (string? value, string? from) Climb(
        DefEntry start,
        Dictionary<string, DefEntry> byName,
        Dictionary<string, CoreBase> core,
        Func<DefEntry, string?> ownValue,
        Func<CoreBase, string?> coreValue)
    {
        var own = ownValue(start);
        if (!string.IsNullOrWhiteSpace(own)) return (own, null);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var parent = start.ParentName;
        while (!string.IsNullOrWhiteSpace(parent) && seen.Add(parent))
        {
            if (byName.TryGetValue(parent, out var p))
            {
                var v = ownValue(p);
                if (!string.IsNullOrWhiteSpace(v)) return (v, parent);
                parent = p.ParentName;
                continue;
            }
            if (core.TryGetValue(parent, out var cb))
            {
                var v = coreValue(cb);
                if (!string.IsNullOrWhiteSpace(v)) return (v, parent);
                parent = cb.ParentName;
                continue;
            }
            break;      // parent out of reach: stop rather than invent
        }
        return (null, null);
    }

    sealed class CoreBase
    {
        public string? ParentName;
        public string? TechLevel;
        public string? DesignationCategory;
    }

    // Reads only the ABSTRACT defs of the game — the ones carrying a Name
    // attribute and serving as a base. Concrete Core defs teach us nothing about a
    // mod's inheritance, and ignoring them keeps this load light.
    static Dictionary<string, CoreBase> LoadCoreBases(string gameDataDir)
    {
        var map = new Dictionary<string, CoreBase>(StringComparer.Ordinal);
        if (!Directory.Exists(gameDataDir)) return map;

        foreach (var file in Directory.EnumerateFiles(gameDataDir, "*.xml", SearchOption.AllDirectories))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); }
            catch { continue; }
            if (doc.Root is null || doc.Root.Name.LocalName != "Defs") continue;

            foreach (var el in doc.Root.Elements())
            {
                var name = (string?)el.Attribute("Name");
                if (string.IsNullOrWhiteSpace(name)) continue;
                map[name] = new CoreBase
                {
                    ParentName = ((string?)el.Attribute("ParentName"))?.Trim(),
                    TechLevel = ((string?)el.Element("techLevel"))?.Trim(),
                    DesignationCategory = ((string?)el.Element("designationCategory"))?.Trim(),
                };
            }
        }
        return map;
    }
}
