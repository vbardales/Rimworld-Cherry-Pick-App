namespace CherryPick;

// Flags the defs that create nothing but replace a def of the game.
//
// The distinction changes everything about what can be done with a mod:
//
//   a CONTENT mod adds new defs           -> part of it can be extracted
//   a RETEXTURE mod redefines game defs   -> there is nothing to extract, and it
//                                            fights over every def with the other
//                                            mods that touch it, the last one
//                                            loaded winning
//
// Without this flag the two look alike. The "Maidnoid" mod declares fifteen
// ordinary-looking ThingDefs, but every one of them carries a defName of the
// game — Mech_Lancer, Mech_Scyther, Mech_Pikeman... All it really replaces are
// PNG files, which also explains why none of its defs declares a texture.
public static class Overrides
{
    public static void Mark(Inventory inv, HashSet<string> vanillaDefNames)
    {
        var count = 0;
        foreach (var d in inv.Defs)
        {
            // Abstract bases count: two mods declaring the same Name= fight over
            // inheritance just as surely as two defNames do.
            var name = d.DefName ?? d.AbstractName;
            if (name is not { Length: > 0 }) continue;
            if (!vanillaDefNames.Contains(name)) continue;
            d.OverridesVanilla = true;
            count++;
        }
        inv.OverrideCount = count;
    }
}
