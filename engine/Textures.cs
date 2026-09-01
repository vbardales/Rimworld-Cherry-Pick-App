namespace CherryPick;

// Resout un chemin de texture de def en fichiers reels sur disque.
//
// RimWorld ne pointe jamais un fichier : il pointe un prefixe, et compose le nom
// final selon le cas. Un meme <texPath> peut donc donner
//
//   Chose.png                                  objet simple
//   Chose_north.png, _south.png, _east.png     Graphic_Multi
//   Chose_Thin_south.png, _Male_south.png...   vetement porte, par morphologie
//   Chose/ChoseA.png, ChoseB.png...            Graphic_Random, dossier de variantes
//
// Le picker doit montrer une vignette, et surtout savoir dire « cette texture
// n'existe pas » : c'est ainsi qu'on aurait vu tout de suite que les tenues de
// Rabbie n'existaient qu'en _Thin et _Child, donc invisibles sur la plupart des
// colons.
public static class TextureResolver
{
    public static void Resolve(Inventory inv)
    {
        foreach (var mod in inv.Mods)
        {
            var roots = mod.ContentRoots
                .Select(r => Path.GetFullPath(Path.Combine(mod.Path, r, "Textures")))
                .Where(Directory.Exists)
                .ToList();
            if (roots.Count == 0) continue;

            foreach (var d in inv.Defs.Where(d => d.Mod == mod.Id))
            {
                foreach (var texPath in d.Refs.Textures)
                {
                    var files = Find(roots, texPath);
                    if (files.Count == 0) d.MissingTextures.Add(texPath);
                    else d.TextureFiles.AddRange(files);
                }
                d.TextureFiles = d.TextureFiles.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            }
        }
    }

    static List<string> Find(List<string> roots, string texPath)
    {
        var rel = texPath.Replace('/', Path.DirectorySeparatorChar);
        var found = new List<string>();

        foreach (var root in roots)
        {
            // Un dossier portant exactement ce nom : toutes ses images comptent.
            var asDir = Path.Combine(root, rel);
            if (Directory.Exists(asDir))
            {
                found.AddRange(Directory.EnumerateFiles(asDir, "*.png", SearchOption.TopDirectoryOnly));
                continue;
            }

            var dir = Path.GetDirectoryName(asDir);
            var stem = Path.GetFileName(asDir);
            if (dir is null || stem.Length == 0 || !Directory.Exists(dir)) continue;

            foreach (var f in Directory.EnumerateFiles(dir, stem + "*.png", SearchOption.TopDirectoryOnly))
            {
                // stem* attraperait « Bed » pour « BedDouble ». On n'accepte que
                // le nom exact ou le nom suivi d'un souligne.
                var name = Path.GetFileNameWithoutExtension(f);
                if (name.Length == stem.Length || name[stem.Length] == '_') found.Add(f);
            }
        }

        return found;
    }

    // La vignette a montrer : de face si l'orientation existe, sinon la premiere.
    public static string? Thumb(DefEntry d)
    {
        if (d.TextureFiles.Count == 0) return null;
        return d.TextureFiles.FirstOrDefault(f => f.EndsWith("_south.png", StringComparison.OrdinalIgnoreCase))
            ?? d.TextureFiles.FirstOrDefault(f => !f.Contains('_'))
            ?? d.TextureFiles[0];
    }
}
