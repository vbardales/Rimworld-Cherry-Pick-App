using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

namespace CherryPick;

// Quels espaces de noms C# chaque mod apporte.
//
// Sert a repondre a une question precise : « une fois la selection faite, cette
// dependance declaree sert-elle encore a quelque chose ? » Sans cette carte on
// ne pourrait que deviner. Avec elle, la reponse est factuelle : si aucune
// classe retenue n'appartient a un espace de noms de ce mod, il ne sert plus.
//
// C'est ce qui est arrive trois fois cette semaine sans qu'on le voie tout de
// suite — Rabbie Gear a perdu Humanoid Alien Races, Burn Barrel a perdu Harmony
// et le Vanilla Expanded Framework.
//
// La lecture passe par System.Reflection.Metadata : on lit les metadonnees du
// PE sans charger l'assemblage. Charger une DLL compilee pour RimWorld dans ce
// processus echouerait de toute facon, ses references etant introuvables.
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

                    // On retient aussi la racine : une def qui cite
                    // VEF.AnimalBehaviours.CompX doit pouvoir se rattacher au mod
                    // qui fournit VEF, meme si l'espace de noms exact differe.
                    var dot = ns.IndexOf('.');
                    if (dot > 0) namespaces.Add(ns[..dot]);
                }
            }
            catch { /* DLL illisible ou native : on l'ignore */ }
        }
        return namespaces;
    }

    // L'espace de noms d'une classe qualifiee, racine comprise.
    public static (string root, string ns) Split(string qualifiedClass)
    {
        var lastDot = qualifiedClass.LastIndexOf('.');
        var ns = lastDot > 0 ? qualifiedClass[..lastDot] : "";
        var firstDot = ns.IndexOf('.');
        var root = firstDot > 0 ? ns[..firstDot] : ns;
        return (root, ns);
    }
}
