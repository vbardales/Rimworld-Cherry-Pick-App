namespace CherryPick;

// Un mod source scanne. Plusieurs peuvent finir dans une meme extraction :
// certaines en fusionnent (Animal Ark en agrege seize). Mais le scan reste
// toujours mod par mod, a la demande.
public sealed class ModInfo
{
    public string Id { get; set; } = "";            // nom du dossier : identifiant Workshop, ou nom local
    public string Name { get; set; } = "";
    public string PackageId { get; set; } = "";
    public string Path { get; set; } = "";
    public List<string> SupportedVersions { get; set; } = new();

    // Dependances declarees dans About.xml. Le picker doit pouvoir dire
    // lesquelles deviennent inutiles une fois la selection faite.
    public List<string> DeclaredDependencies { get; set; } = new();

    // Racine(s) de contenu retenues : "." plus le dossier de version applicable.
    public List<string> ContentRoots { get; set; } = new();

    // Vrai si aucune version supportee n'atteint la 1.6 : le mod est mort, donc
    // candidat a un portage public plutot qu'a une extraction privee.
    public bool DeadBefore16 { get; set; }
}

// Ce qu'une def reference. Chaque liste alimente la fermeture des dependances.
public sealed class DefRefs
{
    // Jetons ayant la forme d'un defName. Volontairement permissif : mieux vaut
    // tirer une def de trop dans la fermeture que d'en oublier une et livrer un
    // mod casse.
    public List<string> Defs { get; set; } = new();

    // Le sous-ensemble venant de balises qui portent VRAIMENT une reference de
    // def. Sert au rapport « references non resolues » : sur la liste permissive,
    // ce rapport se noyait sous les libelles, les enums et les booleens — `true`,
    // `Item`, `barrel`, `stock` — et devenait illisible, donc inutile.
    public List<string> StrictDefs { get; set; } = new();

    // Classes C# qualifiees : Class=, thingClass, compClass, workerClass, et les
    // balises personnalisees du type <ItemProcessor.CombinationDef>.
    public List<string> Classes { get; set; } = new();

    public List<string> Textures { get; set; } = new();
    public List<string> Sounds { get; set; } = new();
    public List<string> Research { get; set; } = new();
}

public sealed class DefEntry
{
    public string Key { get; set; } = "";           // "ThingDef/BioForge" ou "ThingDef/Name=BuildingBase"
    public string DefType { get; set; } = "";
    public string? DefName { get; set; }
    public string? AbstractName { get; set; }       // attribut Name=
    public bool IsAbstract { get; set; }
    public string? Label { get; set; }
    public string? ParentName { get; set; }

    // Niveau de progression affiche dans le picker : Neolithic, Medieval,
    // Industrial, Spacer... Souvent absent de la def elle-meme et herite du
    // parent, d'ou le champ resolu separement.
    public string? TechLevel { get; set; }
    public string? TechLevelFrom { get; set; }        // def dont il est herite, si herite

    // Pour un batiment : ou il apparait dans le menu Architecte. Comme le niveau
    // technologique, presque toujours herite du parent.
    public string? ArchitectCategory { get; set; }
    public string? ArchitectCategoryFrom { get; set; }

    public string Mod { get; set; } = "";
    public string File { get; set; } = "";
    public int Line { get; set; }

    // Renseigne quand la def est gardee derriere un MayRequire / MayRequireAnyOf.
    public List<string> MayRequire { get; set; } = new();

    public DefRefs Refs { get; set; } = new();

    // Fichiers de texture reellement trouves sur disque, et chemins qui ne
    // resolvent nulle part — ces derniers signalent un dessin manquant.
    public List<string> TextureFiles { get; set; } = new();
    public List<string> MissingTextures { get; set; } = new();

    // Confort d'affichage : le libelle s'il existe, sinon le defName.
    public string Display => string.IsNullOrWhiteSpace(Label) ? (DefName ?? AbstractName ?? Key) : Label!;
}

// Un fichier de patch. Il ne declare aucune def mais en vise, et un patch dont la
// cible n'est pas retenue est un orphelin : c'est ce defaut qui a fait echouer
// deux operations de Medieval Homestead au chargement.
public sealed class PatchEntry
{
    public string Mod { get; set; } = "";
    public string File { get; set; } = "";
    public List<string> TargetDefs { get; set; } = new();     // defName= lus dans les xpath
    public List<string> Classes { get; set; } = new();
    public List<string> GuardedByMods { get; set; } = new();  // PatchOperationFindMod
}

public sealed class Inventory
{
    public List<ModInfo> Mods { get; set; } = new();
    public List<DefEntry> Defs { get; set; } = new();
    public List<PatchEntry> Patches { get; set; } = new();

    // XML illisible, About manquant... Remonte a l'interface plutot qu'ecrit sur
    // la sortie d'erreur, pour que rien ne se perde.
    public List<string> Problems { get; set; } = new();
}

// Une entree de la modlist active de RimWorld.
public sealed class ActiveMod
{
    public string PackageId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public string Source { get; set; } = "";        // workshop, local, ou officiel
    public bool Found { get; set; }
    public bool Active { get; set; }        // present dans ModsConfig.xml
    public List<string> SupportedVersions { get; set; } = new();
    public bool DeadBefore16 { get; set; }
}
