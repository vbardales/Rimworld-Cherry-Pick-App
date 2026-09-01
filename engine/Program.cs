using System.Text.Json;
using System.Text.Json.Serialization;
using CherryPick;

// cherrypick — inventaire et extraction selective de mods RimWorld.
//
//   cherrypick list                       la modlist active, resolue en dossiers
//   cherrypick scan <packageId|chemin>    l'inventaire d'UN mod, en JSON
//
// Rien ne parcourt le Workshop en entier : « list » ne lit que les About.xml, et
// « scan » ne lit que le mod demande.

const string GameDirDefault = @"C:\Program Files (x86)\Steam\steamapps\common\RimWorld";

var json = new JsonSerializerOptions
{
    WriteIndented = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
};

var verb = args.Length > 0 ? args[0] : "help";
var gameDir = Environment.GetEnvironmentVariable("RIMWORLD_DIR") ?? GameDirDefault;

switch (verb)
{
    case "list":
        return CmdList();
    case "scan":
        return CmdScan(false);
    case "view":
        return CmdScan(true);
    case "close":
        return CmdClose();
    default:
        Console.WriteLine("cherrypick list [--all] [--json]    - la modlist active, ou tous les mods installes");
        Console.WriteLine("cherrypick scan <packageId|chemin>  - l'inventaire d'un mod, en JSON");
        Console.WriteLine("cherrypick view <packageId|chemin>  - la meme chose, en page HTML a parcourir");
        Console.WriteLine();
        Console.WriteLine("Variables : RIMWORLD_DIR pour un jeu installe ailleurs.");
        return verb == "help" ? 0 : 2;
}

int CmdList()
{
    var cfg = ModList.FindModsConfig();
    if (cfg is null) { Console.Error.WriteLine("ModsConfig.xml introuvable."); return 1; }

    // Par defaut la modlist active. Avec --all, tout ce qui est installe : c'est
    // le meme index, l'un n'est qu'un filtre de l'autre.
    var mods = args.Contains("--all")
        ? ModList.All(gameDir, cfg)
        : ModList.Resolve(gameDir, cfg);
    var wantJson = args.Contains("--json");

    if (wantJson) { Console.WriteLine(JsonSerializer.Serialize(mods, json)); return 0; }

    Console.WriteLine($"{mods.Count} mods actifs — {cfg}");
    Console.WriteLine();
    foreach (var m in mods)
    {
        var versions = m.SupportedVersions.Count > 0 ? string.Join(" ", m.SupportedVersions) : "";
        var flag = !m.Found ? "  INTROUVABLE" : m.DeadBefore16 ? "  mort avant 1.6" : "";
        Console.WriteLine($"  {m.PackageId,-46} {m.Source,-9} {versions,-24}{flag}");
        Console.WriteLine($"    {m.Name}");
    }
    return 0;
}

int CmdScan(bool asHtml)
{
    if (args.Length < 2) { Console.Error.WriteLine("Usage : cherrypick scan <packageId|chemin>"); return 2; }
    var target = args[1];

    string? path = Directory.Exists(target) ? target : null;
    if (path is null)
    {
        var index = ModList.IndexInstalled(ModList.ModRoots(gameDir));
        if (index.TryGetValue(target, out var info)) path = info.Path;
    }
    if (path is null) { Console.Error.WriteLine($"Mod introuvable : {target}"); return 1; }

    var inv = Scanner.ScanOne(path);
    inv.Mods[0].DeadBefore16 = !inv.Mods[0].SupportedVersions.Contains("1.6");
    // Les bases abstraites du jeu : sans elles, techLevel et categorie Architecte
    // resteraient vides sur presque tout, puisque les mods en heritent.
    Inherited.Resolve(inv, Path.Combine(gameDir, "Data"));

    TextureResolver.Resolve(inv);

    var outPath = OptionValue("--out");
    var text = asHtml ? Viewer.Render(inv, json) : JsonSerializer.Serialize(inv, json);
    if (asHtml) outPath ??= Path.Combine(Path.GetTempPath(), "cherrypick-" + inv.Mods[0].Id + ".html");
    if (outPath is not null) { File.WriteAllText(outPath, text); Console.Error.WriteLine($"{inv.Defs.Count} defs -> {outPath}"); }
    else Console.WriteLine(text);
    return 0;
}

string? OptionValue(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

// Etend une selection a tout ce dont elle a besoin, et dit pourquoi.
int CmdClose()
{
    if (args.Length < 2) { Console.Error.WriteLine("Usage : cherrypick close <packageId|chemin> --pick a,b,c | --pick-file f.json"); return 2; }
    var target = args[1];

    string? path = Directory.Exists(target) ? target : null;
    if (path is null)
    {
        var index = ModList.IndexInstalled(ModList.ModRoots(gameDir));
        if (index.TryGetValue(target, out var found)) path = found.Path;
    }
    if (path is null) { Console.Error.WriteLine($"Mod introuvable : {target}"); return 1; }

    var picks = new List<string>();
    if (OptionValue("--pick") is { } inline)
        picks.AddRange(inline.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    if (OptionValue("--pick-file") is { } pf && File.Exists(pf))
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(pf));
        if (doc.RootElement.TryGetProperty("picked", out var arr))
            picks.AddRange(arr.EnumerateArray().Select(e => e.GetString() ?? "").Where(s => s.Length > 0));
    }
    if (picks.Count == 0) { Console.Error.WriteLine("Aucune def cochee."); return 2; }

    var inv = Scanner.ScanOne(path);
    Inherited.Resolve(inv, Path.Combine(gameDir, "Data"));
    TextureResolver.Resolve(inv);

    var vanilla = VanillaIndex.Load(gameDir);

    // Les espaces de noms de chaque dependance declaree, pour savoir laquelle
    // reste utile une fois la selection faite.
    var deps = new Dictionary<string, (string, HashSet<string>)>(StringComparer.OrdinalIgnoreCase);
    var installed = ModList.IndexInstalled(ModList.ModRoots(gameDir));
    foreach (var pid in inv.Mods[0].DeclaredDependencies)
        if (installed.TryGetValue(pid, out var dep))
            deps[pid] = (dep.Name, AssemblyNamespaces.Of(dep.Path));

    var closure = Closure.Compute(inv, picks, vanilla, deps);

    var outPath = OptionValue("--out");
    var text = JsonSerializer.Serialize(closure, json);
    if (outPath is not null) { File.WriteAllText(outPath, text); Console.Error.WriteLine($"{closure.Items.Count} defs -> {outPath}"); }
    else if (args.Contains("--json")) Console.WriteLine(text);
    else PrintClosure(closure, picks.Count);
    return 0;
}

void PrintClosure(ClosureResult c, int pickedCount)
{
    Console.WriteLine($"{pickedCount} defs cochees  ->  {c.Items.Count} defs au total");
    Console.WriteLine();
    foreach (var g in c.Items.Where(i => i.Depth > 0).GroupBy(i => i.Reason))
    {
        Console.WriteLine($"  entrainees comme « {g.Key} » ({g.Count()}) :");
        foreach (var i in g.Take(12)) Console.WriteLine($"    {i.Label,-38} <- {i.Via}");
        if (g.Count() > 12) Console.WriteLine($"    ... et {g.Count() - 12} autres");
        Console.WriteLine();
    }
    if (c.Classes.Count > 0)
    {
        Console.WriteLine($"  classes C# requises ({c.Classes.Count}) :");
        foreach (var x in c.Classes) Console.WriteLine($"    {x}");
        Console.WriteLine();
    }
    if (c.Unresolved.Count > 0)
    {
        Console.WriteLine($"  references non resolues ({c.Unresolved.Count}) — ni dans le mod, ni dans le jeu :");
        foreach (var x in c.Unresolved.Take(20)) Console.WriteLine($"    {x}");
        Console.WriteLine();
    }
    if (c.OrphanPatches.Count > 0)
    {
        Console.WriteLine($"  patchs devenus orphelins ({c.OrphanPatches.Count}) — a ne pas reprendre :");
        foreach (var p in c.OrphanPatches) Console.WriteLine($"    {p.File}  (visait {string.Join(", ", p.TargetDefs)})");
        Console.WriteLine();
    }
    foreach (var d in c.Dependencies)
        Console.WriteLine(d.StillNeeded
            ? $"  dependance CONSERVEE  {d.PackageId}  ({d.Because.Count} classe(s))"
            : $"  dependance INUTILE    {d.PackageId}  — plus aucune classe retenue ne lui appartient");
    Console.WriteLine($"\n  {c.Textures.Count} textures, {c.Sounds.Count} sons.");
}
