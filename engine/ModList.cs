using System.Xml.Linq;

namespace CherryPick;

// Resolves RimWorld's ACTIVE modlist into folders on disk.
//
// This is the picker's only entry point: the thousands of Workshop mods are never
// walked. We start from ModsConfig.xml, resolve only what is listed there, and a
// mod's content is read only when it is opened.
public static class ModList
{
    static readonly string[] ConfigCandidates =
    {
        @"AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Config\ModsConfig.xml",
        @"AppData\LocalLow\Ludeon Studios\RimWorld\Config\ModsConfig.xml",
    };

    public static string? FindModsConfig()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var rel in ConfigCandidates)
        {
            var p = Path.Combine(home, rel);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    public static List<string> ReadActivePackageIds(string modsConfigPath)
    {
        var doc = XDocument.Load(modsConfigPath);
        var active = doc.Root?.Element("activeMods");
        if (active is null) return new List<string>();
        return active.Elements("li").Select(e => e.Value.Trim()).Where(s => s.Length > 0).ToList();
    }

    // The three places RimWorld looks for a mod, in the order it consults them.
    // The game's Mods folder also holds our NTFS junctions.
    public static List<string> ModRoots(string gameDir) => new()
    {
        Path.Combine(gameDir, "Data"),
        Path.Combine(gameDir, "Mods"),
        WorkshopDir(gameDir),
    };

    static string WorkshopDir(string gameDir)
    {
        // ...\steamapps\common\RimWorld  ->  ...\steamapps\workshop\content\294100
        var common = Directory.GetParent(gameDir);
        var steamapps = common?.Parent;
        return steamapps is null
            ? ""
            : Path.Combine(steamapps.FullName, "workshop", "content", "294100");
    }

    // Builds the packageId -> folder index by reading About.xml files only, which
    // stays fast even with many mods installed: one file per folder, not a single
    // def walked.
    public static Dictionary<string, ModInfo> IndexInstalled(IEnumerable<string> roots, bool refresh = false)
        => InstalledIndex.Build(roots, refresh);

    public static List<ActiveMod> Resolve(string gameDir, string modsConfigPath)
    {
        var index = IndexInstalled(ModRoots(gameDir));
        var result = new List<ActiveMod>();
        foreach (var pid in ReadActivePackageIds(modsConfigPath))
        {
            if (index.TryGetValue(pid, out var info))
            {
                result.Add(new ActiveMod
                {
                    PackageId = pid,
                    Name = info.Name,
                    Path = info.Path,
                    Source = SourceOf(gameDir, info.Path),
                    Found = true,
                    Active = true,
                    SupportedVersions = info.SupportedVersions,
                    DeadBefore16 = info.DeadBefore16,
                });
            }
            else
            {
                result.Add(new ActiveMod { PackageId = pid, Name = "(introuvable)", Found = false });
            }
        }
        return result;
    }

    // Every installed mod, active or not. Same index as Resolve, which is only a
    // filter of it against ModsConfig.xml. The picker must be able to inspect a
    // mod that is not loaded — that is even the common case when looking for
    // something to extract.
    public static List<ActiveMod> All(string gameDir, string modsConfigPath)
    {
        var active = new HashSet<string>(ReadActivePackageIds(modsConfigPath), StringComparer.OrdinalIgnoreCase);
        return IndexInstalled(ModRoots(gameDir)).Values
            .Select(info => new ActiveMod
            {
                PackageId = info.PackageId,
                Name = info.Name,
                Path = info.Path,
                Source = SourceOf(gameDir, info.Path),
                Found = true,
                Active = active.Contains(info.PackageId),
                SupportedVersions = info.SupportedVersions,
                DeadBefore16 = info.DeadBefore16,
            })
            .OrderBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    static string SourceOf(string gameDir, string path)
    {
        if (path.StartsWith(Path.Combine(gameDir, "Data"), StringComparison.OrdinalIgnoreCase)) return "officiel";
        if (path.StartsWith(Path.Combine(gameDir, "Mods"), StringComparison.OrdinalIgnoreCase)) return "local";
        return "workshop";
    }
}
