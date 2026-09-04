using System.Text.Json;

namespace CherryPick;

// packageId -> folder index, with an on-disk cache.
//
// Building this index means reading one About.xml per installed mod. With a
// well-stocked Workshop that takes some twenty seconds, which is unacceptable for
// a command run every time. The result is therefore cached and revalidated
// against each About.xml's modification date: only folders that appeared or
// changed since are read again.
//
// The cache does not replace the "we do not scan the Workshop" rule: it holds
// About metadata only, never defs. A mod's content is read only when it is
// opened.
public static class InstalledIndex
{
    sealed class Entry
    {
        public string Path { get; set; } = "";
        public long Stamp { get; set; }              // About.xml modification date
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

                // First found wins: Data, then Mods, then Workshop — the order in
                // which RimWorld itself resolves a packageId.
                if (!index.ContainsKey(entry.PackageId))
                {
                    index[entry.PackageId] = new ModInfo
                    {
                        Id = new DirectoryInfo(entry.Path).Name,
                        Path = entry.Path,
                        PackageId = entry.PackageId,
                        Name = entry.Name,
                        SupportedVersions = entry.SupportedVersions,
                        // An empty list is not a dead mod: the official DLC
                        // declare no version at all. Without this guard, Core and
                        // Royalty would be reported as outdated.
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
        catch { /* unreadable cache: rebuild it, quietly */ }
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
