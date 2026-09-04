namespace CherryPick;

// Reconciles into a single entry the defs that describe one and the same thing.
//
// A mod almost never declares an object in a single def. A creature is a race
// plus its spawn recipe; an implant is an item, the hediff it applies, the recipe
// that installs it and the one that removes it. Showing them separately produces
// apparent duplicates — in Marro, "berserker mind worm" comes out twice, and so
// does "fungal growth" — and above all it allows ticking one while dropping the
// other, which yields an incoherent mod.
//
// Three links only, all of them certain. We do not guess:
//
//   same defName on several types   FungalGrowth is both a HediffDef and a ThingDef
//   PawnKindDef -> its race         a PawnKind without its race represents nothing
//   RecipeDef -> what it produces   or the hediff it applies
//
// Deliberately NO grouping by name prefix or by ingredient: a recipe that
// consumes steel does not belong to steel's group.
public static class Grouping
{
    public static void Resolve(Inventory inv)
    {
        // Union-find: the links arrive out of order and chain together.
        var parent = new Dictionary<string, string>(StringComparer.Ordinal);

        string Find(string k)
        {
            if (!parent.TryGetValue(k, out var p) || p == k) return parent[k] = k;
            return parent[k] = Find(p);
        }

        void Union(string a, string b)
        {
            var ra = Find(a);
            var rb = Find(b);
            if (ra != rb) parent[ra] = rb;
        }

        foreach (var d in inv.Defs) Find(d.Key);

        // A def is found by its name, whatever its type.
        //
        // CASE-INSENSITIVE comparison, unlike the rest of the tool: RimWorld is
        // case-sensitive when resolving a reference, but authors are inconsistent.
        // In Marro the hediff is called BerserkerMindWorm and the item
        // BerserkerMindworm — two different defNames to the game, one single thing
        // to whoever reads the list.
        var byName = new Dictionary<string, List<DefEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in inv.Defs)
        {
            var n = d.DefName ?? d.AbstractName;
            if (n is not { Length: > 0 }) continue;
            if (!byName.TryGetValue(n, out var list)) byName[n] = list = new List<DefEntry>();
            list.Add(d);
        }

        // 1. Same defName, different types.
        foreach (var list in byName.Values)
            for (var i = 1; i < list.Count; i++)
                Union(list[0].Key, list[i].Key);

        // 2. and 3. Explicit ties.
        foreach (var d in inv.Defs)
        {
            void LinkTo(string? name)
            {
                if (name is not { Length: > 0 }) return;
                if (byName.TryGetValue(name, out var targets) && targets.Count > 0)
                    Union(d.Key, targets[0].Key);
            }

            if (d.DefType.EndsWith("PawnKindDef", StringComparison.Ordinal)) LinkTo(d.Race);
            if (d.DefType.EndsWith("RecipeDef", StringComparison.Ordinal))
            {
                foreach (var p in d.Products) LinkTo(p);
                LinkTo(d.AddsHediff);
            }
        }

        // 4. Exclusive ownership.
        //
        // A food declares the hediff it grants and the thought it leaves. In
        // "axolotleggmilktea", four defs describe a single drink: the item, its
        // recipe, its hediff and its thought.
        //
        // But we only tie what is claimed BY ONE def alone. A hediff shared by
        // five items belongs to all five, therefore to none: uniting them would
        // build an absurd group gathering five distinct things.
        var claims = new Dictionary<string, List<DefEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in inv.Defs)
            foreach (var owned in d.Owns)
            {
                if (!claims.TryGetValue(owned, out var list)) claims[owned] = list = new List<DefEntry>();
                list.Add(d);
            }

        foreach (var (name, claimants) in claims)
        {
            if (claimants.Count != 1) continue;                  // shared: leave it alone
            if (!byName.TryGetValue(name, out var targets)) continue;
            var target = targets[0];
            if (target.Key == claimants[0].Key) continue;        // a def does not own itself
            Union(claimants[0].Key, target.Key);
        }

        // The group key is that of its most telling representative: a ThingDef is
        // preferred, then the def that carries a label.
        var members = inv.Defs.GroupBy(d => Find(d.Key), StringComparer.Ordinal);
        foreach (var g in members)
        {
            var anchor = g.FirstOrDefault(d => d.DefType == "ThingDef")
                         ?? g.FirstOrDefault(d => d.DefType.EndsWith("ThingDef", StringComparison.Ordinal))
                         ?? g.FirstOrDefault(d => !string.IsNullOrWhiteSpace(d.Label))
                         ?? g.First();
            foreach (var d in g) d.GroupKey = anchor.Key;
        }
    }
}
