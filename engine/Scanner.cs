using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace CherryPick;

// Lit UN mod de RimWorld et en dresse l'inventaire : les defs, ce que chacune
// reference, et les fichiers de patch avec leurs cibles.
//
// Le scan est toujours a la demande, mod par mod. On ne parcourt jamais le
// dossier Workshop en entier : plusieurs milliers de mods y dorment, et seuls
// ceux de la modlist active nous interessent.
//
// L'analyse passe par System.Xml.Linq et jamais par des expressions regulieres :
// il faut lire des attributs (ParentName, Name, Class, MayRequire) autant que des
// balises, et distinguer une def abstraite d'une def concrete. Un parsing textuel
// se casse precisement sur ces cas-la.
public static class Scanner
{
    // Balises dont la valeur designe une classe C#.
    static readonly HashSet<string> ClassTags = new(StringComparer.Ordinal)
    {
        "thingClass", "workerClass", "compClass", "driverClass", "giverClass",
        "verbClass", "projectileClass", "scenPartClass", "needClass", "thinkClass",
        "workerCounterClass", "ritualBehaviorClass", "ritualOutcomeEffectClass",
        "questNodeClass", "damageWorkerClass", "modClass", "gameConditionClass",
        "hediffClass", "jobClass", "lordJobClass", "graphicClass",
    };

    static readonly HashSet<string> TextureTags = new(StringComparer.Ordinal)
    {
        "texPath", "wornGraphicPath", "iconPath", "uiIconPath", "expandingIconTexture",
        "siteTexture", "symbol", "fuelIconPath", "resultSpecialIcon", "buildingOnGraphic",
        "buildingOffGraphic", "GizmoIcon", "modIconPath",
    };

    static readonly HashSet<string> SoundTags = new(StringComparer.Ordinal)
    {
        "clipPath", "clipFolderPath",
    };

    static readonly HashSet<string> ResearchTags = new(StringComparer.Ordinal)
    {
        "researchPrerequisite",
    };

    public static Inventory ScanOne(string modPath)
    {
        var inv = new Inventory();
        var mod = ReadAbout(modPath);
        inv.Mods.Add(mod);
        foreach (var root in mod.ContentRoots)
        {
            ScanDefs(inv, mod, Path.Combine(modPath, root, "Defs"));
            ScanPatches(inv, mod, Path.Combine(modPath, root, "Patches"));
        }
        return inv;
    }

    // About.xml : nom, packageId, versions, dependances declarees.
    public static ModInfo ReadAbout(string path)
    {
        var mod = new ModInfo { Path = path, Id = new DirectoryInfo(path).Name };
        var aboutPath = Path.Combine(path, "About", "About.xml");
        if (File.Exists(aboutPath))
        {
            try
            {
                var meta = XDocument.Load(aboutPath).Root;
                if (meta != null)
                {
                    mod.Name = ((string?)meta.Element("name") ?? mod.Id).Trim();
                    mod.PackageId = ((string?)meta.Element("packageId") ?? "").Trim();
                    var sv = meta.Element("supportedVersions");
                    if (sv != null)
                        mod.SupportedVersions = sv.Elements("li").Select(e => e.Value.Trim()).ToList();
                    var deps = meta.Element("modDependencies");
                    if (deps != null)
                        mod.DeclaredDependencies = deps.Elements("li")
                            .Select(li => ((string?)li.Element("packageId") ?? "").Trim())
                            .Where(s => s.Length > 0).ToList();
                }
            }
            catch (Exception e) { Console.Error.WriteLine($"About illisible : {aboutPath} — {e.Message}"); }
        }
        mod.ContentRoots = ContentRoots(path);
        return mod;
    }

    // Un mod range son contenu a la racine, ou dans des dossiers de version, ou
    // les deux. On retient la racine plus le dossier de version le plus eleve qui
    // soit <= 1.6, ce que fait le jeu depuis la 1.5.
    static List<string> ContentRoots(string path)
    {
        var roots = new List<string> { "." };
        if (!Directory.Exists(path)) return roots;

        var best = Directory.EnumerateDirectories(path)
            .Select(d => new DirectoryInfo(d).Name)
            .Where(n => Regex.IsMatch(n, @"^1\.\d+$"))
            .Select(n => (name: n, minor: int.Parse(n.Substring(2))))
            .Where(t => t.minor <= 6)
            .OrderByDescending(t => t.minor)
            .FirstOrDefault();

        if (best.name is not null) roots.Add(best.name);
        return roots;
    }

    static void ScanDefs(Inventory inv, ModInfo mod, string defsDir)
    {
        if (!Directory.Exists(defsDir)) return;
        foreach (var file in Directory.EnumerateFiles(defsDir, "*.xml", SearchOption.AllDirectories))
        {
            XDocument doc;
            try { doc = XDocument.Load(file, LoadOptions.SetLineInfo); }
            catch (Exception e) { inv.Problems.Add($"XML invalide : {Rel(mod.Path, file)} — {e.Message}"); continue; }
            if (doc.Root is null || doc.Root.Name.LocalName != "Defs") continue;

            foreach (var el in doc.Root.Elements())
            {
                var entry = ReadDef(el, mod, Rel(mod.Path, file));
                if (entry is not null) inv.Defs.Add(entry);
            }
        }
    }

    static DefEntry? ReadDef(XElement el, ModInfo mod, string file)
    {
        var nameAttr = (string?)el.Attribute("Name");
        var defName = (string?)el.Element("defName");
        if (defName is null && nameAttr is null) return null;

        var defType = el.Name.LocalName;
        var entry = new DefEntry
        {
            DefType = defType,
            DefName = defName?.Trim(),
            AbstractName = nameAttr?.Trim(),
            IsAbstract = string.Equals((string?)el.Attribute("Abstract"), "True", StringComparison.OrdinalIgnoreCase),
            Label = ((string?)el.Element("label"))?.Trim(),
            ParentName = ((string?)el.Attribute("ParentName"))?.Trim(),
            Mod = mod.Id,
            File = file,
            Line = el is System.Xml.IXmlLineInfo li && li.HasLineInfo() ? li.LineNumber : 0,
        };
        entry.Key = defName is not null ? $"{defType}/{defName.Trim()}" : $"{defType}/Name={nameAttr!.Trim()}";

        var may = (string?)el.Attribute("MayRequire") ?? (string?)el.Attribute("MayRequireAnyOf");
        if (may is not null)
            entry.MayRequire = may.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

        entry.TechLevel = ((string?)el.Element("techLevel"))?.Trim();
        entry.ArchitectCategory = ((string?)el.Element("designationCategory"))?.Trim();

        Harvest(el, entry.Refs);
        return entry;
    }

    // Parcourt le sous-arbre d'une def et classe tout ce qui ressemble a une
    // reference. Les valeurs sont gardees telles quelles : c'est la fermeture qui
    // decidera si « Steel » designe une def du jeu, du mod, ou rien du tout.
    static void Harvest(XElement el, DefRefs refs)
    {
        foreach (var node in el.DescendantsAndSelf())
        {
            var tag = node.Name.LocalName;

            var cls = (string?)node.Attribute("Class");
            if (!string.IsNullOrWhiteSpace(cls) && cls.Contains('.')) refs.Classes.Add(cls.Trim());

            // Une balise du type <ItemProcessor.CombinationDef> porte elle aussi
            // un espace de noms, et designe donc une classe.
            if (tag.Contains('.') && node != el) refs.Classes.Add(tag);

            if (node.HasElements) continue;

            var v = node.Value.Trim();
            if (v.Length == 0) continue;

            if (ClassTags.Contains(tag)) { if (v.Contains('.')) refs.Classes.Add(v); continue; }
            if (TextureTags.Contains(tag)) { refs.Textures.Add(v); continue; }
            if (SoundTags.Contains(tag)) { refs.Sounds.Add(v); continue; }
            if (ResearchTags.Contains(tag)) { refs.Research.Add(v); continue; }

            if (tag == "li" && node.Parent?.Name.LocalName == "researchPrerequisites") { refs.Research.Add(v); continue; }

            if (LooksLikeDefName(v)) refs.Defs.Add(v);
        }
        Dedupe(refs);
    }

    static bool LooksLikeDefName(string v) =>
        v.Length is > 1 and < 80 &&
        (char.IsLetter(v[0]) || v[0] == '_') &&
        v.All(c => char.IsLetterOrDigit(c) || c == '_');

    static void Dedupe(DefRefs r)
    {
        r.Defs = r.Defs.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
        r.Classes = r.Classes.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
        r.Textures = r.Textures.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
        r.Sounds = r.Sounds.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
        r.Research = r.Research.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
    }

    // Les patchs ne declarent rien mais visent des defs. Un patch dont la cible
    // n'est pas retenue par la selection est un orphelin — le defaut exact qui a
    // fait echouer deux operations de Medieval Homestead au chargement.
    static void ScanPatches(Inventory inv, ModInfo mod, string patchDir)
    {
        if (!Directory.Exists(patchDir)) return;
        foreach (var file in Directory.EnumerateFiles(patchDir, "*.xml", SearchOption.AllDirectories))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); }
            catch (Exception e) { inv.Problems.Add($"XML invalide : {Rel(mod.Path, file)} — {e.Message}"); continue; }
            if (doc.Root is null || doc.Root.Name.LocalName != "Patch") continue;

            var p = new PatchEntry { Mod = mod.Id, File = Rel(mod.Path, file) };

            foreach (var xp in doc.Descendants("xpath"))
                foreach (Match m in Regex.Matches(xp.Value, "defName\\s*=\\s*\"([A-Za-z0-9_]+)\""))
                    p.TargetDefs.Add(m.Groups[1].Value);

            foreach (var op in doc.Descendants())
            {
                var cls = (string?)op.Attribute("Class");
                if (cls is null) continue;
                if (cls.Contains('.') && !cls.StartsWith("PatchOperation", StringComparison.Ordinal))
                    p.Classes.Add(cls);
                if (cls == "PatchOperationFindMod")
                {
                    var mods = op.Element("mods");
                    if (mods is not null) p.GuardedByMods.AddRange(mods.Elements("li").Select(e => e.Value.Trim()));
                }
            }

            p.TargetDefs = p.TargetDefs.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
            p.Classes = p.Classes.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
            p.GuardedByMods = p.GuardedByMods.Distinct(StringComparer.Ordinal).ToList();
            inv.Patches.Add(p);
        }
    }

    static string Rel(string root, string full) =>
        Path.GetRelativePath(root, full).Replace('\\', '/');
}
