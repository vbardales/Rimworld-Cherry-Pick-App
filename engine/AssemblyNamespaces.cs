using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

namespace CherryPick;

// Which C# namespaces each mod brings.
//
// It answers one precise question: "once the selection is made, is this declared
// dependency still good for anything?" Without this map we could only guess. With
// it the answer is factual: if no kept class belongs to a namespace of that mod,
// it is no longer needed.
//
// That is what happened three times in one week without being noticed straight
// away — Rabbie Gear lost Humanoid Alien Races, Burn Barrel lost Harmony and the
// Vanilla Expanded Framework.
//
// Reading goes through System.Reflection.Metadata: the PE metadata is read
// without loading the assembly. Loading a DLL compiled against RimWorld into this
// process would fail anyway, its references being nowhere to be found.
public static class AssemblyNamespaces
{
    public static HashSet<string> Of(string modPath)
    {
        var namespaces = new HashSet<string>(StringComparer.Ordinal);
        if (!Directory.Exists(modPath)) return namespaces;

        foreach (var dll in Directory.EnumerateFiles(modPath, "*.dll", SearchOption.AllDirectories))
        {
            try
            {
                using var stream = File.OpenRead(dll);
                using var pe = new PEReader(stream);
                if (!pe.HasMetadata) continue;
                var md = pe.GetMetadataReader();

                foreach (var handle in md.TypeDefinitions)
                {
                    var type = md.GetTypeDefinition(handle);
                    var ns = md.GetString(type.Namespace);
                    if (ns.Length == 0) continue;
                    namespaces.Add(ns);

                    // The root is kept too: a def naming
                    // VEF.AnimalBehaviours.CompX must be able to tie back to the
                    // mod providing VEF, even if the exact namespace differs.
                    var dot = ns.IndexOf('.');
                    if (dot > 0) namespaces.Add(ns[..dot]);
                }
            }
            catch { /* DLL illisible ou native : on l'ignore */ }
        }
        return namespaces;
    }

    // The namespace of a qualified class, root included.
    public static (string root, string ns) Split(string qualifiedClass)
    {
        var lastDot = qualifiedClass.LastIndexOf('.');
        var ns = lastDot > 0 ? qualifiedClass[..lastDot] : "";
        var firstDot = ns.IndexOf('.');
        var root = firstDot > 0 ? ns[..firstDot] : ns;
        return (root, ns);
    }
}
