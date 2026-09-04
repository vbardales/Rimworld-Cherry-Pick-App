namespace CherryPick;

// Resolves a def's texture path into real files on disk.
//
// RimWorld never points at a file: it points at a prefix, and composes the final
// name case by case. One same <texPath> can therefore yield
//
//   Thing.png                                  simple item
//   Thing_north.png, _south.png, _east.png     Graphic_Multi
//   Thing_Thin_south.png, _Male_south.png...   worn apparel, per body type
//   Thing/ThingA.png, ThingB.png...            Graphic_Random, folder of variants
//
// The picker must show a thumbnail, and above all be able to say "this texture
// does not exist": that is how we would have seen at once that the Rabbie outfits
// only existed in _Thin and _Child, hence invisible on most colonists.
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
            // A folder named exactly that: all of its images count.
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
                // stem* would catch "Bed" for "BedDouble". Only the exact name, or
                // the name followed by an underscore, is accepted.
                var name = Path.GetFileNameWithoutExtension(f);
                if (name.Length == stem.Length || name[stem.Length] == '_') found.Add(f);
            }
        }

        return found;
    }

    // The thumbnail to show: front view if that orientation exists, else the first.
    public static string? Thumb(DefEntry d)
    {
        if (d.TextureFiles.Count == 0) return null;
        return d.TextureFiles.FirstOrDefault(f => f.EndsWith("_south.png", StringComparison.OrdinalIgnoreCase))
            ?? d.TextureFiles.FirstOrDefault(f => !f.Contains('_'))
            ?? d.TextureFiles[0];
    }
}
