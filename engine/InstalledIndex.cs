using System.Text.Json;

namespace CherryPick;

// Index packageId -> dossier, avec cache sur disque.
//
// Construire cet index demande de lire un About.xml par mod installe. Avec un
// Workshop bien garni cela prend une vingtaine de secondes, ce qui est
// inacceptable pour une commande qu'on lance a chaque fois. Le resultat est donc
// mis en cache et revalide par la date de modification de chaque About.xml :
// seuls les dossiers apparus ou modifies depuis sont relus.
//
// Le cache ne remplace pas la regle « on ne scanne pas le Workshop » : il ne
// contient que les metadonnees d'About, jamais les defs. Le contenu d'un mod
// n'est lu que lorsqu'on l'ouvre.
public static class InstalledIndex
{
    sealed class Entry
    {
        public string Path { get; set; } = "";
        public long Stamp { get; set; }              // date de modification de About.xml
        public string PackageId { get; set; } = "";
        public string Name { get; set; } = "";
        public List<string> SupportedVersions { get; set; } = new();
    }

    sealed class Cache
    {
        public int Version { get; set; } = 1;
        public List<Entry> Entries { get; set; } = new();
    }

    static string CachePath =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "cherrypick", "installed-index.json");

    public static Dictionary<string, ModInfo> Build(IEnumerable<string> roots, bool refresh = false)
    {
        var old = refresh ? new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase)
                          : LoadCache();
        var fresh = new List<Entry>();
        var index = new Dictionary<string, ModInfo>(StringComparer.OrdinalIgnoreCase);

        foreach (var root in roots)
        {
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                var about = Path.Combine(dir, "About", "About.xml");
                if (!File.Exists(about)) continue;

                var stamp = File.GetLastWriteTimeUtc(about).Ticks;
                Entry entry;

                if (old.TryGetValue(dir, out var cached) && cached.Stamp == stamp)
                {
                    entry = cached;
                }
                else
                {
                    ModInfo info;
                    try { info = Scanner.ReadAbout(dir); }
                    catch { continue; }
                    if (info.PackageId.Length == 0) continue;
                    entry = new Entry
                    {
                        Path = dir,
                        Stamp = stamp,
                        PackageId = info.PackageId,
                        Name = info.Name,
                        SupportedVersions = info.SupportedVersions,
                    };
                }

                fresh.Add(entry);

                // Premier trouve gagne : Data, puis Mods, puis Workshop — l'ordre
                // dans lequel RimWorld lui-meme resout un packageId.
                if (!index.ContainsKey(entry.PackageId))
                {
                    index[entry.PackageId] = new ModInfo
                    {
                        Id = new DirectoryInfo(entry.Path).Name,
                        Path = entry.Path,
                        PackageId = entry.PackageId,
                        Name = entry.Name,
                        SupportedVersions = entry.SupportedVersions,
                        // Une liste vide n'est pas un mod mort : les DLC officiels
                        // ne declarent aucune version. Sans cette garde, Core et
                        // Royalty seraient signales comme perimes.
                        DeadBefore16 = entry.SupportedVersions.Count > 0
                                       && !entry.SupportedVersions.Contains("1.6"),
                    };
                }
            }
        }

        SaveCache(fresh);
        return index;
    }

    static Dictionary<string, Entry> LoadCache()
    {
        var map = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (!File.Exists(CachePath)) return map;
            var cache = JsonSerializer.Deserialize<Cache>(File.ReadAllText(CachePath));
            if (cache is null || cache.Version != 1) return map;
            foreach (var e in cache.Entries) map[e.Path] = e;
        }
        catch { /* cache illisible : on rebatit, sans bruit */ }
        return map;
    }

    static void SaveCache(List<Entry> entries)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CachePath)!);
            File.WriteAllText(CachePath, JsonSerializer.Serialize(new Cache { Entries = entries }));
        }
        catch { /* pas de cache : on perdra du temps, rien de plus */ }
    }
}
