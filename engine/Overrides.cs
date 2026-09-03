namespace CherryPick;

// Marque les defs qui ne creent rien mais remplacent une def du jeu.
//
// La distinction change tout pour ce qu'on peut faire d'un mod :
//
//   un mod de CONTENU ajoute des defs nouvelles     -> on peut en extraire une partie
//   un mod de RETEXTURE redefinit des defs du jeu   -> il n'y a rien a extraire, et il
//                                                      se dispute chaque def avec les
//                                                      autres mods qui y touchent, le
//                                                      dernier charge l'emportant
//
// Sans ce drapeau les deux se ressemblent. Le mod « Maidnoid » declare quinze
// ThingDef d'apparence ordinaire, mais tous portent les defName du jeu —
// Mech_Lancer, Mech_Scyther, Mech_Pikeman... Il ne remplace en realite que des
// fichiers PNG, ce qui explique aussi qu'aucune de ses defs ne declare de texture.
public static class Overrides
{
    public static void Mark(Inventory inv, HashSet<string> vanillaDefNames)
    {
        var count = 0;
        foreach (var d in inv.Defs)
        {
            // Les bases abstraites comptent : deux mods qui declarent le meme
            // Name= se disputent l'heritage aussi surement que deux defName.
            var name = d.DefName ?? d.AbstractName;
            if (name is not { Length: > 0 }) continue;
            if (!vanillaDefNames.Contains(name)) continue;
            d.OverridesVanilla = true;
            count++;
        }
        inv.OverrideCount = count;
    }
}
