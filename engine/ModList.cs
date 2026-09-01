using System.Xml.Linq;

namespace CherryPick;

// Resout la modlist ACTIVE de RimWorld en dossiers sur disque.
//
// C'est le seul point d'entree du picker : on ne parcourt jamais les milliers de
// mods du Workshop. On part de ModsConfig.xml, on ne resout que ce qui y figure,
// et le contenu d'un mod n'est lu que lorsqu'on l'ouvre.
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

    // Les trois emplacements ou RimWorld cherche un mod, dans l'ordre ou il les
    // consulte. Le dossier Mods du jeu contient aussi nos jonctions NTFS.
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

    // Construit l'index packageId -> dossier en ne lisant que les About.xml, ce
    // qui reste rapide meme avec beaucoup de mods installes : un fichier par
    // dossier, aucune def parcourue.
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

    // Tous les mods installes, actifs ou non. Meme index que Resolve : ce dernier
    // n'en est qu'un filtre sur ModsConfig.xml. Le picker doit pouvoir inspecter
    // un mod qui n'est pas charge — c'est meme le cas courant quand on cherche
    // quoi extraire.
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
