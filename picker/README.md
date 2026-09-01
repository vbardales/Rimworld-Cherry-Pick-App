# cherrypick — interface

Interface locale pour inspecter un mod RimWorld et choisir ce qu'on en garde.

## Demarrer

```
cd tools/picker
npm run dev
```

Puis http://localhost:3000

## Pourquoi ca doit tourner en local

L'application lit le dossier du jeu, le dossier Workshop et des PNG sur le
disque. Une page servie depuis un serveur distant s'execute dans le navigateur
du visiteur, qui n'a acces a rien de tout cela. **nelim.fr peut heberger la page
de presentation et le telechargement, pas l'outil lui-meme.**

## Architecture

Le moteur d'analyse reste le binaire C# `tools/CherryPick` : il porte toute la
lecture XML, deja eprouvee. Next n'est que l'interface et l'orchestration.

```
lib/cherrypick.ts        appelle le binaire, met les inventaires en cache
app/page.tsx             accueil : la modlist active, ou les 5000+ mods installes
app/mod/[id]/page.tsx    inspection d'un mod
app/api/mods             -> cherrypick list [--all] --json
app/api/scan             -> cherrypick scan <chemin>, cache par date du dossier
app/api/texture          sert un PNG depuis le disque
```

Si le moteur a change, le recompiler avant :

```
dotnet build tools/CherryPick/CherryPick.csproj -c Release
```

## Deux points a ne pas defaire

**Les textures passent par `/api/texture`, jamais par `file://`.** Depuis une
page `http://localhost`, tous les navigateurs bloquent `<img src="file:///...">`.

**Le garde-fou de chemin n'est pas decoratif.** `isUnderAllowedRoot` verifie que
tout fichier demande vit sous une racine de mods connue. Sans lui, `/api/texture`
et `/api/scan` liraient n'importe quel fichier de la machine pour quiconque parle
a localhost. Les deux routes renvoient 403 en dehors de ces racines.

## Etat

Fait : listing des mods (actifs ou tous), inspection d'un mod avec vignettes,
niveau technologique resolu par heritage, categorie du menu Architecte,
recherches liees, filtres, cases a cocher.

A venir : la fermeture des dependances (cocher une arme doit tirer l'etabli et
la matiere premiere), la detection des patchs orphelins et des dependances
devenues inutiles, la fusion de ressources avec affichage alternatif, et la
generation du mod.
