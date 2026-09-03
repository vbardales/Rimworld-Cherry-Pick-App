namespace CherryPick;

// Pourquoi une def s'est retrouvee dans la selection.
public sealed class ClosureItem
{
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string DefType { get; set; } = "";
    public string Reason { get; set; } = "";     // parent, reference, recherche prealable
    public string Via { get; set; } = "";        // la def qui l'a tiree
    public int Depth { get; set; }               // 0 = coche a la main
}

public sealed class DependencyVerdict
{
    public string PackageId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool StillNeeded { get; set; }
    public List<string> Because { get; set; } = new();   // les classes qui la justifient
}

// Une def gardee reclame une def qu'on a explicitement ecartee.
public sealed class Conflict
{
    public string Needed { get; set; } = "";        // la def ecartee
    public string NeededBy { get; set; } = "";      // celle qui la reclame
    public string Reason { get; set; } = "";        // parent, reference, recherche prealable
}

public sealed class ClosureResult
{
    // Trois etats par def :
    //   indetermine  — non decide, donc embarque : c'est le defaut
    //   embarque     — garde explicitement, avec tout ce qu'il entraine
    //   non-embarque — ecarte explicitement
    public int Kept { get; set; }
    public int Excluded { get; set; }
    public int Undetermined { get; set; }

    // Une def gardee reclame une def ecartee. Chaque ligne est une erreur au
    // chargement si on n'y touche pas.
    public List<Conflict> Conflicts { get; set; } = new();

    public List<ClosureItem> Items { get; set; } = new();      // embarque + entraine
    public List<string> Classes { get; set; } = new();         // classes C# requises
    public List<string> Textures { get; set; } = new();
    public List<string> Sounds { get; set; } = new();

    // References qui ne resolvent ni dans le mod, ni dans le jeu : dependance
    // manquante, ou coquille. C'est la liste a lire en premier.
    public List<string> Unresolved { get; set; } = new();

    // Patchs dont plus aucune cible n'est retenue. Les garder produirait
    // exactement l'echec de chargement rencontre sur Medieval Homestead.
    public List<PatchEntry> OrphanPatches { get; set; } = new();
    public List<PatchEntry> KeptPatches { get; set; } = new();

    public List<DependencyVerdict> Dependencies { get; set; } = new();
}

// Etend une selection a tout ce dont elle a besoin pour fonctionner.
//
// Les regles viennent chacune d'un raté reel, pas d'une liste theorique :
//
//   ParentName            l'auto-mortier d'Ancients, les sols de Rabbie
//   references de defs    Marro : une arme tire le BioForge, qui tire la marroflesh
//   recherches            Rabbie : 26 projets enchaines
//   patchs orphelins      Medieval Homestead : deux operations sans cible
//   dependances inutiles  Rabbie Gear a perdu HAR, Burn Barrel a perdu VEF
public static class Closure
{
    public static ClosureResult Compute(
        Inventory inv,
        IEnumerable<string> pickedKeys,
        HashSet<string> vanillaDefNames,
        Dictionary<string, (string name, HashSet<string> namespaces)>? dependencyNamespaces = null,
        IEnumerable<string>? excludedKeys = null)
    {
        // Non decide vaut embarque : on part de tout, et on retire ce qui a ete
        // explicitement ecarte. C'est le sens du travail — on taille dans un mod
        // existant, on ne le reconstruit pas piece par piece.
        var excluded = new HashSet<string>(excludedKeys ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
        var byKey = inv.Defs.ToDictionary(d => d.Key, StringComparer.Ordinal);

        // Un meme nom peut designer une def concrete ou une base abstraite, et
        // le XML ne dit pas laquelle : on indexe les deux.
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

            // Les references de cette def dont on accepte de dire qu'elles sont
            // « non resolues » si elles ne mènent nulle part.
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

                // Ni dans le mod : soit le jeu la fournit, soit personne.
                //
                // On ne signale que les references issues de balises qui portent
                // vraiment une def. Sur la liste permissive, ce rapport se noyait
                // sous les libelles, les enums et les booleens — « true », « Item »,
                // « barrel » — et devenait inutilisable.
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

        // Ce qui part reellement : tout, sauf ce qui a ete ecarte. Les defs
        // « embarque » et leur fermeture y sont forcement, puisqu'on ne peut pas
        // a la fois cocher et decocher la meme def.
        var kept = inv.Defs.Where(d => !excluded.Contains(d.Key)).ToList();
        result.Kept = kept.Count;
        result.Excluded = excluded.Count;
        result.Undetermined = kept.Count - chosen.Count;

        // Une def gardee reclame une def ecartee : au chargement, la def gardee
        // echouerait. C'est le seul endroit ou les trois etats se contredisent.
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

        // Un patch survit si au moins une de ses cibles est retenue, ou s'il ne
        // vise aucune def nommee — auquel cas on ne peut pas trancher, et le
        // garder est le choix sur.
        var keptNames = new HashSet<string>(
            kept.SelectMany(d => new[] { d.DefName, d.AbstractName }).Where(s => s is { Length: > 0 })!,
            StringComparer.Ordinal);

        foreach (var p in inv.Patches)
        {
            var relevant = p.TargetDefs.Count == 0
                           || p.TargetDefs.Any(t => keptNames.Contains(t) || vanillaDefNames.Contains(t));
            if (relevant) result.KeptPatches.Add(p); else result.OrphanPatches.Add(p);
        }

        // Une dependance declaree n'est encore utile que si une classe retenue
        // lui appartient.
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
