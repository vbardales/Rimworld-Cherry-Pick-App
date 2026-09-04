using System.Xml.Linq;

namespace CherryPick;

// Resout les champs qu'une def tient de ses parents.
//
// Deux d'entre eux comptent pour le picker et ne sont presque jamais declares sur
// la def elle-meme :
//
//   techLevel            — le niveau de progression (Neolithic, Medieval,
//                          Industrial, Spacer...) affiche a cote de chaque objet
//   designationCategory  — pour un batiment, l'onglet du menu Architecte ou il
//                          apparait
//
// Les deux descendent en general d'une base abstraite : un meuble ne dit pas
// « Furniture », c'est BuildingBase ou FurnitureBase qui le dit. Lire seulement la
// def laisserait donc les deux colonnes vides sur la quasi-totalite du contenu,
// ce qui reviendrait a ne pas les afficher.
//
// La chaine de parents traverse les frontieres de mods : la plupart des defs
// heritent de bases du jeu. On indexe donc aussi les defs abstraites du Core, sans
// quoi tout ce qui derive de BuildingBase resterait sans reponse.
public static class Inherited
{
    public static void Resolve(Inventory inv, string? gameDataDir = null)
    {
        // Index des defs abstraites disponibles, par attribut Name.
        var byName = new Dictionary<string, DefEntry>(StringComparer.Ordinal);
        foreach (var d in inv.Defs)
            if (d.AbstractName is { Length: > 0 } n) byName[n] = d;

        // Les bases du jeu, si on les a sous la main.
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

    // La chaine complete, pour affichage. Meme parcours que Climb, mais on ne
    // s'arrete pas a la premiere valeur : on va jusqu'a la racine, et on note au
    // passage qui fournit chaque maillon.
    //
    // Un maillon "absent" est le renseignement le plus utile de la liste : il dit
    // que la def herite d'une base qu'on n'a pas sous la main, donc que tout ce
    // qu'on affiche d'elle est possiblement incomplet.
    static List<ParentStep> Chain(
        DefEntry start,
        Dictionary<string, DefEntry> byName,
        Dictionary<string, CoreBase> core)
    {
        var steps = new List<ParentStep>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var parent = start.ParentName;

        // Une boucle d'heritage est possible dans un mod mal ecrit : seen l'arrete.
        while (!string.IsNullOrWhiteSpace(parent) && seen.Add(parent))
        {
            if (byName.TryGetValue(parent, out var p))
            {
                steps.Add(new ParentStep { Name = parent, Origin = "mod" });
                parent = p.ParentName;
            }
            else if (core.TryGetValue(parent, out var cb))
            {
                steps.Add(new ParentStep { Name = parent, Origin = "jeu" });
                parent = cb.ParentName;
            }
            else
            {
                steps.Add(new ParentStep { Name = parent, Origin = "absent" });
                break;
            }
        }
        return steps;
    }

    // Remonte la chaine ParentName jusqu'a trouver une valeur. Retourne aussi le
    // nom de la def qui l'a fournie, pour que l'interface puisse dire « herite de
    // BuildingBase » plutot que de laisser croire a une valeur propre.
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
            break;      // parent hors de portee : on s'arrete sans inventer
        }
        return (null, null);
    }

    sealed class CoreBase
    {
        public string? ParentName;
        public string? TechLevel;
        public string? DesignationCategory;
    }

    // Ne lit que les defs ABSTRAITES du jeu — celles qui portent un attribut Name
    // et servent de socle. Les defs concretes du Core ne nous apprennent rien sur
    // l'heritage d'un mod, et les ignorer garde ce chargement leger.
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
