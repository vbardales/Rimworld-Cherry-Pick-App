# Rimworld Cherry Pick App

Inspecter un mod RimWorld, choisir ce qu'on en garde, et voir ce que ce choix
entraine — avant d'extraire quoi que ce soit.

L'outil repond a une question que le XML ne repond pas tout seul : **si je garde
cette arme, de quoi d'autre ai-je besoin ?** Sur un cas reel, cocher les quatre
armes a distance de *Marro* en tire dix-sept : les projectiles, l'etabli qui les
fabrique, la matiere premiere, les recherches prealables et les bases abstraites.

## Demarrer

```bash
dotnet build engine/CherryPick.csproj -c Release
cd picker && npm install && npm run dev
```

Puis http://localhost:3000

## Pourquoi ca tourne en local, et pas ailleurs

L'application lit le dossier du jeu, le dossier Workshop et des PNG sur le
disque. Une page servie depuis un serveur distant s'execute dans le navigateur du
visiteur, qui n'a acces a rien de tout cela. **Un domaine peut heberger la
presentation et le telechargement, pas l'outil.**

## Deux pieges de la plateforme, deja contournes

**Smart App Control bloque un exe non signe.** Le projet C# met donc
`UseAppHost` a `false` : aucun executable n'est produit, et le picker invoque
`dotnet cherrypick.dll`, `dotnet.exe` etant signe par Microsoft. **Ne jamais
desactiver Smart App Control pour contourner ce genre de blocage** : sous
Windows 11 on ne peut plus le reactiver sans reinstaller le systeme.

**Les textures passent par `/api/texture`, jamais par `file://`.** Depuis une
page `http://localhost`, tous les navigateurs bloquent
`<img src="file:///...">`. Et le garde-fou de chemin n'est pas decoratif :
`isUnderAllowedRoot` verifie que tout fichier demande vit sous une racine de mods
connue, faute de quoi la route servirait n'importe quel fichier de la machine a
qui parle a localhost. Les deux routes repondent 403 en dehors.

## Structure

```
engine/     moteur C# — lecture XML, heritage, fermeture des dependances
picker/     interface Next — listing, inspection, selection
data/       le classement de la modlist, en clair et versionne
```

Le moteur porte toute l'analyse. L'interface n'orchestre que des appels.

```
cherrypick list [--all] [--json]     la modlist active, ou tout ce qui est installe
cherrypick scan <mod>                l'inventaire d'un mod, en JSON
cherrypick view <mod>                le meme, en page HTML autonome
cherrypick close <mod> --pick a,b    ce qu'une selection entraine
```

## Ce que la fermeture calcule

Chaque regle vient d'un rate reel rencontre en extrayant des mods a la main :

| Regle | Le cas qui l'a imposee |
| --- | --- |
| `ParentName`, transitif | bases abstraites oubliees, defs qui ne chargent pas |
| references de defs | une arme tire son etabli, qui tire sa matiere premiere |
| recherches et leurs prealables | vingt-six projets enchaines dans un seul mod |
| **patchs orphelins** | deux operations sans cible faisaient echouer le chargement |
| **dependances devenues inutiles** | une extraction avait perdu sa dependance a HAR sans qu'on le voie |
| references non resolues | ni dans le mod ni dans le jeu : dependance manquante ou coquille |

Les deux lignes en gras sont les plus utiles : elles signalent ce qu'on peut
**retirer**, ce qu'aucune lecture du XML ne donne spontanement.

## Classer la modlist

Une modlist de cent quatre-vingts mods ne se tient pas de tete. Chaque mod porte
donc deux marques, posees d'un clic depuis la liste :

- **a trier / trie** — pas « garde » : seulement « regarde, je sais ce qu'il
  fait ». C'est le tri qui fait avancer le travail, pas la decision d'extraire.
- **des categories**, multiples : moteur/UI, gameplay, animaux, loisirs,
  textures, nourriture, plantes, factions, races. Un mod de creatures apporte des
  animaux *et* leurs textures ; un overhaul touche au gameplay *et* aux factions.

Le classement vit dans `data/mod-labels.json`, versionne avec le reste : il se
fait sur des semaines, il ne peut pas dependre du cache d'un navigateur.

## Heritage

Chaque def affiche sa chaine de parents jusqu'a la racine, pas seulement son
parent immediat. Une def de mod ne declare presque rien — `KCSG_PowerConduit`
tient son cout, sa taille et sa categorie de `PowerConduit`, qui les tient de
`BuildingBase`.

Trois origines, distinguees a la couleur :

| Maillon | Sens |
| --- | --- |
| neutre | base declaree dans ce mod |
| vert | base du jeu (Core ou DLC) |
| **rouge pointille** | parent nomme mais introuvable |

Le dernier cas est le renseignement utile : il dit que la base vit dans une
dependance non scannee, et c'est toujours l'explication d'un niveau
technologique ou d'une categorie Architecte restes vides. Les add-ons de Vanilla
Vehicles Expanded en sont pleins — leurs tourelles heritent de
`VehicleTurretBase`, qui appartient au Vehicle Framework.

## Etat

Fait : listing des mods installes et actifs, inspection avec vignettes, niveau
technologique resolu par heritage, categorie du menu Architecte, recherches
liees, fermeture des dependances avec la raison de chaque ajout, detection des
patchs orphelins et des dependances inutiles, chaine d'heritage complete,
classement de la modlist par etiquettes.

A venir : la fermeture branchee dans l'interface, la fusion de ressources avec
affichage alternatif (style ou `randomGraphics` selon le nombre de sources visant
la meme cible), et la generation du mod.
