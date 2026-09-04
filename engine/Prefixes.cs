namespace CherryPick;

// Flags the defs whose name does not belong to this mod.
//
// Modders prefix their defNames, and they are consistent about it: a mod is
// thirty defs called Lavas_something. So the handful that break the pattern are
// worth a second look — they are almost never the author's own content.
//
// On the Halloween mod, thirty-four of thirty-nine defs started with Lavas, and
// the five that did not all started with DankPyon_. Those five were exactly the
// content that did not belong to it: a JobDef copied verbatim from Medieval
// Overhaul, and four ItemAcceptedDefs left over from 1.5 whose class no longer
// exists anywhere. Nothing else in the tool pointed at them.
//
// Costs nothing: it reads only the mod already open, and asks no question of the
// disk.
public static class Prefixes
{
    // How much of a mod has to follow one prefix before the rest counts as odd.
    //
    // Set from two mods that must NOT be flagged. The Vanilla Expanded Framework
    // is five subsystems in one folder — VEF, VFE, KCSG, PS — and its biggest
    // family covers 58% of it; at half, seventy-four of its defs came back as
    // foreign, which is noise, not signal. The Halloween mod sits at 87%, and its
    // five outsiders were all real. Seventy separates the two cases.
    const double DominanceNeeded = 0.7;

    public static void Resolve(Inventory inv)
    {
        var prefixed = new List<DefEntry>();
        foreach (var d in inv.Defs)
        {
            d.DefNamePrefix = PrefixOf(d.DefName);
            if (d.DefNamePrefix is not null) prefixed.Add(d);
        }
        if (prefixed.Count == 0) return;

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in prefixed)
            counts[d.DefNamePrefix!] = counts.GetValueOrDefault(d.DefNamePrefix!) + 1;

        // Prefixes that extend one another belong to the same author, and counting
        // them apart invents an outsider. Lava_TwilightRaidLootMaker sat among
        // thirty-three Lavas_ defs and came back flagged over one letter.
        var best = counts.OrderByDescending(kv => kv.Value).First().Key;
        var family = counts.Keys.Where(k => SameFamily(k, best)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var held = family.Sum(k => counts[k]);
        if (held < prefixed.Count * DominanceNeeded) return;

        inv.OwnPrefix = best;
        foreach (var d in prefixed)
        {
            // A def that replaces a def of the game carries the GAME's name, so of
            // course the prefix does not match. That case has its own flag, and
            // saying it twice would drown a retexture mod in warnings about every
            // def it holds.
            if (d.OverridesVanilla) continue;
            if (family.Contains(d.DefNamePrefix!)) continue;
            d.ForeignPrefix = true;
            inv.ForeignPrefixCount++;
        }
    }

    // One name extends the other: VFE and VFEA, Lava and Lavas. Comparing whole
    // prefixes would split one author into several.
    static bool SameFamily(string a, string b) =>
        a.StartsWith(b, StringComparison.OrdinalIgnoreCase) ||
        b.StartsWith(a, StringComparison.OrdinalIgnoreCase);

    // The part before the first underscore, when there is one.
    //
    // Only the underscore convention is read. Guessing where a prefix ends inside
    // CamelCase would flag half of every mod that does not use underscores at all
    // — RuneWaterShallow and RuneFertileWater are one mod's whole output, and it
    // has nothing to say about itself.
    static string? PrefixOf(string? defName)
    {
        if (defName is null) return null;
        var i = defName.IndexOf('_');
        return i >= 2 ? defName[..i] : null;
    }
}
