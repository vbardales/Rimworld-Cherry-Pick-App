using System.Text.Json;
using System.Xml.Linq;

namespace CherryPick;

// Tous les defName livres par le jeu — Core et DLC officiels.
//
// Sans cet index, la fermeture ne saurait pas distinguer trois cas qui se
// ressemblent dans le XML :
//
//   « Steel »        -> def du jeu, rien a embarquer
//   « BioForge »     -> def du mod, a tirer dans la selection
//   « VFEP_Rum »     -> ne resout nulle part : dependance manquante, ou coquille
//
// C'est le troisieme cas qui compte : c'est lui qui produit les erreurs au
// chargement, et il est invisible tant qu'on n'a pas les deux autres listes.
public static class VanillaIndex
{
    sealed class Cache
    {
        public int Version { get; set; } = 1;
        public string GameDir { get; set; } = "";
        public long Stamp { get; set; }
        public List<string> DefNames { get; set; } = new();
    }

    static string CachePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "cherrypick", "vanilla-index.json");

    public static HashSet<string> Load(string gameDir)
    {
        var dataDir = Path.Combine(gameDir, "Data");
        var stamp = Directory.Exists(dataDir) ? Directory.GetLastWriteTimeUtc(dataDir).Ticks : 0;

        try
        {
            if (File.Exists(CachePath))
            {
                var cached = JsonSerializer.Deserialize<Cache>(File.ReadAllText(CachePath));
                if (cached is { Version: 1 } && cached.GameDir == dataDir && cached.Stamp == stamp)
                    return new HashSet<string>(cached.DefNames, StringComparer.Ordinal);
            }
        }
        catch { /* cache illisible : on rebatit */ }

        var names = Build(dataDir);

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CachePath)!);
            File.WriteAllText(CachePath, JsonSerializer.Serialize(new Cache
            {
                GameDir = dataDir,
                Stamp = stamp,
                DefNames = names.OrderBy(s => s, StringComparer.Ordinal).ToList(),
            }));
        }
        catch { /* tant pis, on recalculera */ }

        return names;
    }

    static HashSet<string> Build(string dataDir)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        if (!Directory.Exists(dataDir)) return names;

        foreach (var file in Directory.EnumerateFiles(dataDir, "*.xml", SearchOption.AllDirectories))
        {
            // Les traductions officielles contiennent des DefInjected, pas des defs.
            if (file.Contains($"{Path.DirectorySeparatorChar}Languages{Path.DirectorySeparatorChar}",
                              StringComparison.OrdinalIgnoreCase)) continue;

            XDocument doc;
            try { doc = XDocument.Load(file); }
            catch { continue; }
            if (doc.Root is null || doc.Root.Name.LocalName != "Defs") continue;

            foreach (var el in doc.Root.Elements())
            {
                var defName = (string?)el.Element("defName");
                if (!string.IsNullOrWhiteSpace(defName)) names.Add(defName.Trim());
                var nameAttr = (string?)el.Attribute("Name");
                if (!string.IsNullOrWhiteSpace(nameAttr)) names.Add(nameAttr.Trim());
            }
        }
        return names;
    }
}
