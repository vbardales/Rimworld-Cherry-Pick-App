namespace CherryPick;

// Reconcilie en une seule entree les defs qui decrivent une meme chose.
//
// Un mod ne declare presque jamais un objet en une seule def. Une creature, c'est
// une race et sa recette d'apparition ; un implant, c'est un objet, le hediff
// qu'il pose, la recette qui l'installe et celle qui le retire. Les afficher
// separement donne des doublons apparents — chez Marro, « berserker mind worm »
// sort deux fois, « fungal growth » aussi — et laisse surtout cocher l'un en
// ecartant l'autre, ce qui produit un mod incoherent.
//
// Trois liens seulement, tous surs. On ne devine pas :
//
//   meme defName sur plusieurs types   FungalGrowth est a la fois HediffDef et ThingDef
//   PawnKindDef -> sa race             un PawnKind sans sa race ne represente rien
//   RecipeDef -> ce qu'elle produit    ou le hediff qu'elle pose
//
// Volontairement PAS de regroupement par prefixe de nom ni par ingredient : une
// recette qui consomme de l'acier n'appartient pas au groupe de l'acier.
public static class Grouping
{
    public static void Resolve(Inventory inv)
    {
        // Union-find : les liens arrivent dans le desordre et se chainent.
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

        // Une def se retrouve par son nom, quel que soit son type.
        //
        // Comparaison INSENSIBLE A LA CASSE, contrairement au reste de l'outil :
        // RimWorld distingue la casse pour resoudre une reference, mais les auteurs
        // sont inconstants. Chez Marro, le hediff s'appelle BerserkerMindWorm et
        // l'objet BerserkerMindworm — deux defName differents pour le jeu, une seule
        // chose pour qui regarde la liste.
        var byName = new Dictionary<string, List<DefEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in inv.Defs)
        {
            var n = d.DefName ?? d.AbstractName;
            if (n is not { Length: > 0 }) continue;
            if (!byName.TryGetValue(n, out var list)) byName[n] = list = new List<DefEntry>();
            list.Add(d);
        }

        // 1. Meme defName, types differents.
        foreach (var list in byName.Values)
            for (var i = 1; i < list.Count; i++)
                Union(list[0].Key, list[i].Key);

        // 2. et 3. Rattachements explicites.
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

        // 4. Possession exclusive.
        //
        // Un aliment declare le hediff qu'il procure et la pensee qu'il laisse.
        // Chez « axolotleggmilktea », quatre defs decrivent une seule boisson :
        // l'objet, sa recette, son hediff et sa pensee.
        //
        // Mais on ne rattache que ce qui n'est reclame QUE PAR UNE def. Un hediff
        // partage par cinq objets appartient aux cinq, donc a aucun : les unir
        // fabriquerait un groupe absurde reunissant cinq choses distinctes.
        var claims = new Dictionary<string, List<DefEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in inv.Defs)
            foreach (var owned in d.Owns)
            {
                if (!claims.TryGetValue(owned, out var list)) claims[owned] = list = new List<DefEntry>();
                list.Add(d);
            }

        foreach (var (name, claimants) in claims)
        {
            if (claimants.Count != 1) continue;                  // partage : on ne touche pas
            if (!byName.TryGetValue(name, out var targets)) continue;
            var target = targets[0];
            if (target.Key == claimants[0].Key) continue;        // une def ne se possede pas
            Union(claimants[0].Key, target.Key);
        }

        // La cle du groupe est celle de son representant le plus parlant : on
        // prefere un ThingDef, puis la def qui porte un libelle.
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
