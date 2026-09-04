namespace CherryPick;

// Why a def ended up in the selection.
public sealed class ClosureItem
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string DefType { get; set; } = "";
    public string Reason { get; set; } = "";     // parent, reference, research prerequisite
    public string Via { get; set; } = "";        // the def that pulled it in
    public int Depth { get; set; }               // 0 = ticked by hand
}

public sealed class DependencyVerdict
{
    public string PackageId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool StillNeeded { get; set; }
    public List<string> Because { get; set; } = new();   // the classes that justify it
}

// A kept def requires a def that was explicitly dropped.
public sealed class Conflict
{
    public string Needed { get; set; } = "";        // the dropped def
    public string NeededBy { get; set; } = "";      // the one requiring it
    public string Reason { get; set; } = "";        // parent, reference, research prerequisite
}

public sealed class ClosureResult
{
    // Three states per def:
    //   undetermined — undecided, therefore taken along: this is the default
    //   taken        — explicitly kept, with everything it pulls in
    //   dropped      — explicitly left out
    public int Kept { get; set; }
    public int Excluded { get; set; }
    public int Undetermined { get; set; }

    // A kept def requires a dropped def. Every line here is a load error if
    // nothing is done about it.
    public List<Conflict> Conflicts { get; set; } = new();

    public List<ClosureItem> Items { get; set; } = new();      // taken + pulled in
    public List<string> Classes { get; set; } = new();         // required C# classes
    public List<string> Textures { get; set; } = new();
    public List<string> Sounds { get; set; } = new();

    // References resolving neither in the mod nor in the game: a missing
    // dependency, or a typo. This is the list to read first.
    public List<string> Unresolved { get; set; } = new();

    // Patches none of whose targets are kept any more. Keeping them would produce
    // exactly the load failure met on Medieval Homestead.
    public List<PatchEntry> OrphanPatches { get; set; } = new();
    public List<PatchEntry> KeptPatches { get; set; } = new();

    public List<DependencyVerdict> Dependencies { get; set; } = new();
}

// Extends a selection to everything it needs in order to work.
//
// Every rule comes from a real miss, not from a theoretical list:
//
//   ParentName            the Ancients auto-mortar, the Rabbie floors
//   def references        Marro: a weapon pulls the BioForge, which pulls marroflesh
//   research              Rabbie: 26 projects chained together
//   orphan patches        Medieval Homestead: two operations with no target
//   useless dependencies  Rabbie Gear lost HAR, Burn Barrel lost VEF
public static class Closure
{
    public static ClosureResult Compute(
        Inventory inv,
        IEnumerable<string> pickedKeys,
        HashSet<string> vanillaDefNames,
        Dictionary<string, (string name, HashSet<string> namespaces)>? dependencyNamespaces = null,
        IEnumerable<string>? excludedKeys = null)
    {
        // Undecided counts as taken: we start from everything and remove what was
        // explicitly dropped. That is the meaning of the work — we carve into an
        // existing mod, we do not rebuild it piece by piece.
        var excluded = new HashSet<string>(excludedKeys ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
        var byKey = inv.Defs.ToDictionary(d => d.Key, StringComparer.Ordinal);

        // One same name can designate a concrete def or an abstract base, and the
        // XML does not say which: both are indexed.
        var byName = new Dictionary<string, DefEntry>(StringComparer.Ordinal);
        foreach (var d in inv.Defs)
        {
            if (d.DefName is { Length: > 0 } dn) byName.TryAdd(dn, d);
            if (d.AbstractName is { Length: > 0 } an) byName.TryAdd(an, d);
        }

        var result = new ClosureResult();
        var chosen = new Dictionary<string, ClosureItem>(StringComparer.Ordinal);
        var queue = new Queue<(DefEntry def, int depth)>();

        foreach (var key in pickedKeys.Distinct(StringComparer.Ordinal))
        {
            if (!byKey.TryGetValue(key, out var d)) continue;
            chosen[key] = new ClosureItem
            {
                Key = key, Label = d.Display, DefType = d.DefType,
                Reason = "coche", Via = "", Depth = 0,
            };
            queue.Enqueue((d, 0));
        }

        var unresolved = new HashSet<string>(StringComparer.Ordinal);

        while (queue.Count > 0)
        {
            var (def, depth) = queue.Dequeue();

            // The references of this def that we accept to call "unresolved" when
            // they lead nowhere.
            var strict = new HashSet<string>(def.Refs.StrictDefs, StringComparer.Ordinal);
            strict.UnionWith(def.Refs.Research);
            if (def.ParentName is { Length: > 0 } parentName) strict.Add(parentName);

            void Pull(string name, string reason)
            {
                if (string.IsNullOrWhiteSpace(name)) return;

                if (byName.TryGetValue(name, out var target))
                {
                    if (chosen.ContainsKey(target.Key)) return;
                    chosen[target.Key] = new ClosureItem
                    {
                        Key = target.Key, Label = target.Display, DefType = target.DefType,
                        Reason = reason, Via = def.Display, Depth = depth + 1,
                    };
                    queue.Enqueue((target, depth + 1));
                    return;
                }

                // Not in the mod either: the game provides it, or nobody does.
                //
                // Only references coming from tags that really carry a def are
                // reported. On the permissive list this report drowned under
                // labels, enums and booleans — "true", "Item", "barrel" — and
                // became unusable.
                if (!vanillaDefNames.Contains(name) && strict.Contains(name)) unresolved.Add(name);
            }

            Pull(def.ParentName ?? "", "parent");
            foreach (var r in def.Refs.Research) Pull(r, "recherche prealable");
            foreach (var r in def.Refs.Defs) Pull(r, "reference");
        }

        result.Items = chosen.Values
            .OrderBy(i => i.Depth)
            .ThenBy(i => i.DefType, StringComparer.Ordinal)
            .ThenBy(i => i.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // What actually ships: everything except what was dropped. The "taken"
        // defs and their closure are necessarily in it, since one cannot both tick
        // and untick the same def.
        var kept = inv.Defs.Where(d => !excluded.Contains(d.Key)).ToList();
        result.Kept = kept.Count;
        result.Excluded = excluded.Count;
        result.Undetermined = kept.Count - chosen.Count;

        // A kept def requires a dropped def: at load, the kept def would fail.
        // This is the only place where the three states contradict each other.
        var excludedByName = new Dictionary<string, DefEntry>(StringComparer.Ordinal);
        foreach (var key in excluded)
            if (byKey.TryGetValue(key, out var d))
            {
                if (d.DefName is { Length: > 0 } dn) excludedByName[dn] = d;
                if (d.AbstractName is { Length: > 0 } an) excludedByName[an] = d;
            }

        foreach (var d in kept)
        {
            void Check(string? name, string reason)
            {
                if (name is { Length: > 0 } && excludedByName.TryGetValue(name, out var victim))
                    result.Conflicts.Add(new Conflict
                    {
                        Needed = victim.Display, NeededBy = d.Display, Reason = reason,
                    });
            }
            Check(d.ParentName, "parent");
            foreach (var r in d.Refs.Research) Check(r, "recherche prealable");
            foreach (var r in d.Refs.StrictDefs) Check(r, "reference");
        }
        result.Conflicts = result.Conflicts
            .GroupBy(c => (c.Needed, c.NeededBy, c.Reason)).Select(g => g.First())
            .OrderBy(c => c.Needed, StringComparer.OrdinalIgnoreCase).ToList();

        result.Classes = kept.SelectMany(d => d.Refs.Classes).Distinct(StringComparer.Ordinal)
                             .OrderBy(s => s, StringComparer.Ordinal).ToList();
        result.Textures = kept.SelectMany(d => d.Refs.Textures).Distinct(StringComparer.Ordinal)
                              .OrderBy(s => s, StringComparer.Ordinal).ToList();
        result.Sounds = kept.SelectMany(d => d.Refs.Sounds).Distinct(StringComparer.Ordinal)
                            .OrderBy(s => s, StringComparer.Ordinal).ToList();
        result.Unresolved = unresolved.OrderBy(s => s, StringComparer.Ordinal).ToList();

        // A patch survives if at least one of its targets is kept, or if it names
        // no def at all — in which case we cannot decide, and keeping it is the
        // safe choice.
        var keptNames = new HashSet<string>(
            kept.SelectMany(d => new[] { d.DefName, d.AbstractName }).Where(s => s is { Length: > 0 })!,
            StringComparer.Ordinal);

        foreach (var p in inv.Patches)
        {
            var relevant = p.TargetDefs.Count == 0
                           || p.TargetDefs.Any(t => keptNames.Contains(t) || vanillaDefNames.Contains(t));
            if (relevant) result.KeptPatches.Add(p); else result.OrphanPatches.Add(p);
        }

        // A declared dependency is still useful only if a kept class belongs
        // to it.
        if (dependencyNamespaces is not null)
        {
            foreach (var (pid, (name, namespaces)) in dependencyNamespaces)
            {
                var because = result.Classes
                    .Where(c => { var (root, ns) = AssemblyNamespaces.Split(c);
                                  return namespaces.Contains(ns) || namespaces.Contains(root); })
                    .ToList();
                result.Dependencies.Add(new DependencyVerdict
                {
                    PackageId = pid, Name = name,
                    StillNeeded = because.Count > 0,
                    Because = because,
                });
            }
        }

        return result;
    }
}
