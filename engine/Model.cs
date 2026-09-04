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

    // Racines de contenu retenues, lues dans LoadFolders.xml quand il existe.
    public List<string> ContentRoots { get; set; } = new();

    // Celles qui ne se chargent que sous condition (IfModActive / IfModNotActive).
    // Elles sont inventoriees quand meme : on veut voir tout ce que le mod peut
    // apporter, quitte a signaler que c'est conditionnel.
    public List<string> ConditionalRoots { get; set; } = new();

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

// Un maillon de la chaine d'heritage d'une def.
public sealed class ParentStep
{
    public string Name { get; set; } = "";

    // D'ou vient ce parent : "mod" (declare ici), "jeu" (base du Core ou d'un
    // DLC), ou "absent" — un parent nomme que personne ne fournit. Ce dernier
    // cas n'est pas cosmetique : il vient d'une dependance qu'on n'a pas
    // scannee, et c'est lui qui explique un niveau technologique ou une
    // categorie Architecte restes vides.
    public string Origin { get; set; } = "";
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

    // La chaine de parents, remontee jusqu'a sa racine. Une def de mod ne dit
    // presque rien d'elle-meme : le cout, la taille, les stats, la categorie
    // viennent de bases successives. Sans la chaine, on ne peut pas distinguer
    // une valeur vraiment absente d'une valeur heritee de plus haut.
    public List<ParentStep> ParentChain { get; set; } = new();

    public string Mod { get; set; } = "";
    public string File { get; set; } = "";
    public int Line { get; set; }

    // Liens qui rattachent cette def a une autre. Un PawnKindDef sans sa race
    // n'est rien, une recette sans son produit non plus : les afficher separement
    // laisserait cocher l'un et ecarter l'autre.
    public string? Race { get; set; }            // PawnKindDef -> ThingDef
    public List<string> Products { get; set; } = new();   // RecipeDef -> ce qu'elle fabrique
    public string? AddsHediff { get; set; }      // RecipeDef -> hediff pose

    // Defs que celle-ci semble posseder : le hediff qu'un aliment procure, la
    // pensee qu'il laisse. Le rattachement n'a lieu que si PERSONNE D'AUTRE ne les
    // reclame — un hediff partage par cinq objets appartient aux cinq, donc a
    // aucun, et les fusionner ferait un groupe absurde.
    public List<string> Owns { get; set; } = new();

    // Vrai quand ce defName existe deja dans le jeu : la def ne cree rien, elle
    // REMPLACE celle du jeu. Un mod de retexture n'est fait que de celles-la.
    // Sans ce drapeau, l'outil les presente comme du contenu neuf, alors qu'elles
    // ne s'extraient pas — elles se disputent la def avec tout autre mod qui y
    // touche, et le dernier charge gagne.
    public bool OverridesVanilla { get; set; }

    // Cle du groupe auquel cette def appartient. Une seule decision par groupe.
    public string? GroupKey { get; set; }

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

    // Combien de defs du mod remplacent une def du jeu. Un mod de retexture les a
    // presque toutes ; un mod de contenu, aucune.
    public int OverrideCount { get; set; }
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
