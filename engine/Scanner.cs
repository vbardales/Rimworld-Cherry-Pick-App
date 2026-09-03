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

    // Les trois listes qui suivent ne servent PAS a la fermeture — celle-ci reste
    // volontairement permissive, mieux vaut tirer une def de trop qu'en oublier
    // une. Elles servent au rapport « references non resolues », qui sans elles
    // se noyait sous les libelles, les enums et les booleens.

    // Prose et libelles. Un outil porte des libelles d'un seul mot — « barrel »,
    // « stock » — qui ressemblent a s'y meprendre a des defName.
    static readonly HashSet<string> FreeTextTags = new(StringComparer.Ordinal)
    {
        "label", "labelShort", "labelNoun", "labelPlural", "labelFemale", "labelMale",
        "description", "descriptionShort", "baseDescription",
        "title", "titleShort", "titleFemale", "titleShortFemale",
        "jobString", "reportString", "verb", "gerund", "gerundLabel", "customLabel",
        "spectatorsLabel", "spectatorGerund", "fuelLabel", "fuelGizmoLabel",
        "outOfFuelMessage", "ingestCommandString", "ingestReportString",
        "letterText", "letterLabel", "letterInfoText", "summary", "text",
        "structureLabel", "GizmoLabel", "GizmoDescription", "beginLetterLabel", "beginLetter",
    };

    // Enumerations C# : « Item », « PassThroughOnly », « Adulthood »...
    static readonly HashSet<string> EnumTags = new(StringComparer.Ordinal)
    {
        "category", "passability", "altitudeLayer", "drawerType", "tickerType",
        "surfaceType", "techLevel", "slot", "impact", "drugCategory", "foodType",
        "intelligence", "fleshType", "petness", "trainability", "shaderType",
        "developmentalStageFilter", "linkType", "linkFlags", "toolCapacity",
        "damageCategory", "graphicClass", "workType", "priorityInType",
        "tradeability", "defaultPlacingRot", "snowCategory", "minQuality", "quality",
        "name", "listOrder", "displayPriority", "pathCost", "defaultProjectile",
    };

    // Listes dont les entrees sont des etiquettes libres ou des noms courts de
    // classes, jamais des defs.
    static readonly HashSet<string> NonDefListParents = new(StringComparer.Ordinal)
    {
        "tags", "weaponTags", "tradeTags", "buildingTags", "thingSetMakerTags",
        "spawnCategories", "exclusionTags", "defaultOutfitTags", "apparelTags",
        "rulesStrings", "placeWorkers", "inspectorTabs", "specialDesignatorClasses",
        "workTags", "disabledWorkTags", "requiredCapacities", "capacities",
        "backstoryCategories", "alienbodytypes", "styleTags", "modExtensions",
        "categories", "workDisables", "requiredWorkTags", "colorChannels", "bodyAddons",
        "descriptionHyperlinks", "recipeUsers", "hiddenWhileUndiscovered",
    };

    static bool IsReportableDefRef(string tag, string? parentTag, string value)
    {
        if (FreeTextTags.Contains(tag) || EnumTags.Contains(tag)) return false;
        if (parentTag is not null && NonDefListParents.Contains(parentTag)) return false;
        if (value is "true" or "false" or "True" or "False") return false;
        return true;
    }

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
        mod.ContentRoots = ContentRoots(path, mod.ConditionalRoots);
        return mod;
    }

    // Ou vit le contenu du mod.
    //
    // LoadFolders.xml FAIT AUTORITE quand il existe : un mod peut y nommer
    // n'importe quel dossier, et beaucoup le font — « Content », « Common »,
    // « 1.6/CE »... Deviner « la racine plus le dossier de version » suffit pour
    // les mods simples et rate tout le reste, en silence : sans ce fichier,
    // « more dozer » perdait toutes ses textures, rangees dans Content/Textures.
    //
    // Les dossiers conditionnels (IfModActive / IfModNotActive) sont RETENUS pour
    // l'inventaire : on veut voir tout ce que le mod peut apporter. La condition
    // est conservee a part, pour pouvoir l'afficher.
    static List<string> ContentRoots(string path, List<string>? conditional = null)
    {
        if (!Directory.Exists(path)) return new List<string> { "." };

        var fromFile = ReadLoadFolders(path, conditional);
        if (fromFile.Count > 0) return fromFile;

        // Pas de LoadFolders : la regle par defaut du jeu depuis la 1.5 — la
        // racine, plus le dossier de version le plus eleve qui soit <= 1.6.
        var roots = new List<string> { "." };
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

    static List<string> ReadLoadFolders(string modPath, List<string>? conditional)
    {
        var file = Directory.EnumerateFiles(modPath, "*.xml", SearchOption.TopDirectoryOnly)
            .FirstOrDefault(f => string.Equals(Path.GetFileName(f), "LoadFolders.xml",
                                              StringComparison.OrdinalIgnoreCase));
        if (file is null) return new List<string>();

        XDocument doc;
        try { doc = XDocument.Load(file); }
        catch { return new List<string>(); }
        if (doc.Root is null) return new List<string>();

        // Le bloc de version le plus eleve qui ne depasse pas 1.6.
        var block = doc.Root.Elements()
            .Select(e => (el: e, m: Regex.Match(e.Name.LocalName, @"^v?(\d+)\.(\d+)$")))
            .Where(t => t.m.Success)
            .Select(t => (t.el, major: int.Parse(t.m.Groups[1].Value), minor: int.Parse(t.m.Groups[2].Value)))
            .Where(t => t.major < 1 || (t.major == 1 && t.minor <= 6))
            .OrderByDescending(t => t.major).ThenByDescending(t => t.minor)
            .Select(t => t.el)
            .FirstOrDefault();
        if (block is null) return new List<string>();

        var roots = new List<string>();
        foreach (var li in block.Elements("li"))
        {
            var v = li.Value.Trim();
            if (v.Length == 0) continue;
            var rel = v is "/" or "\\" ? "." : v.Replace('/', Path.DirectorySeparatorChar);
            if (!Directory.Exists(Path.Combine(modPath, rel))) continue;
            roots.Add(rel);

            var cond = (string?)li.Attribute("IfModActive") ?? (string?)li.Attribute("IfModNotActive");
            if (cond is not null) conditional?.Add($"{rel} ({li.Attributes().First().Name.LocalName} {cond})");
        }
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

        // Liens de rattachement, lus nommement : la moisson generique ne dit pas
        // de quelle balise vient une reference, et c'est justement la balise qui
        // distingue « fabrique ceci » de « consomme cela ».
        entry.Race = ((string?)el.Element("race"))?.Trim();
        entry.AddsHediff = ((string?)el.Element("addsHediff"))?.Trim();
        var products = el.Element("products");
        if (products is not null)
            entry.Products = products.Elements()
                .Select(p => p.Name.LocalName == "li" ? p.Value.Trim() : p.Name.LocalName)
                .Where(s => s.Length > 0).ToList();


        // Ce que cette def semble posseder en propre. Balises lues nommement :
        // la moisson generique ne dit pas de quelle balise vient une reference,
        // et c'est la balise qui distingue « procure ce hediff » de « soigne ce
        // hediff ».
        foreach (var tag in new[] { "hediffDef", "thought", "tasteThought",
                                    "specialThoughtDirect", "specialThoughtAsIngredient",
                                    "memoryThought", "hediff" })
            foreach (var n in el.Descendants(tag))
            {
                var v = n.Value.Trim();
                if (v.Length > 0 && !n.HasElements) entry.Owns.Add(v);
            }
        entry.Owns = entry.Owns.Distinct(StringComparer.Ordinal).ToList();
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

            var parentTag = node.Parent?.Name.LocalName;
            if (tag == "li" && parentTag == "researchPrerequisites") { refs.Research.Add(v); continue; }

            if (!LooksLikeDefName(v)) continue;

            // La fermeture prend tout : rater une reference livre un mod casse,
            // en tirer une de trop ne coute qu'une def inutile.
            refs.Defs.Add(v);

            // Le rapport, lui, ne retient que ce qui peut vraiment etre une def.
            if (IsReportableDefRef(tag, parentTag, v)) refs.StrictDefs.Add(v);
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
        r.StrictDefs = r.StrictDefs.Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal).ToList();
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
