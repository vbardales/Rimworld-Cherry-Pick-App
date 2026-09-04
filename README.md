# Rimworld Cherry Pick App

Inspect a RimWorld mod, choose what to keep from it, and see what that choice
pulls in — before extracting anything.

The tool answers a question the XML does not answer on its own: **if I keep this
weapon, what else do I need?** On a real case, ticking the four ranged weapons of
*Marro* pulls in seventeen more: the projectiles, the workbench that makes them,
the raw material, the prerequisite research and the abstract bases.

## Getting started

```bash
dotnet build engine/CherryPick.csproj -c Release
cd picker && npm install && npm run dev
```

Then http://localhost:3000

The interface is in French; the code, the documentation and the commit messages
are in English.

## Why it runs locally, and nowhere else

The application reads the game folder, the Workshop folder and PNG files on disk.
A page served from a remote server runs in the visitor's browser, which has
access to none of that. **A domain can host the presentation and the download,
not the tool.**

## Two platform traps, already worked around

**Smart App Control blocks an unsigned exe.** So the C# project sets
`UseAppHost` to `false`: no executable is produced, and the picker invokes
`dotnet cherrypick.dll`, `dotnet.exe` being signed by Microsoft. **Never disable
Smart App Control to work around that kind of block**: under Windows 11 it cannot
be turned back on without reinstalling the system.

**Textures go through `/api/texture`, never through `file://`.** From an
`http://localhost` page, every browser blocks `<img src="file:///...">`. And the
path guard is not decorative: `isUnderAllowedRoot` checks that any requested file
lives under a known mods root, failing which the route would serve any file on
the machine to whoever can talk to localhost. Both routes answer 403 outside.

## Structure

```
engine/     C# engine — XML reading, inheritance, dependency closure
picker/     Next interface — listing, inspection, selection
data/       the modlist classification and the saved configs, versioned
```

The engine carries the whole analysis. The interface only orchestrates calls.

```
cherrypick list [--all] [--json]     the active modlist, or everything installed
cherrypick scan <mod>                a mod's inventory, as JSON
cherrypick view <mod>                the same, as a standalone HTML page
cherrypick close <mod> --pick a,b    what a selection pulls in
```

## What the closure computes

Every rule comes from a real miss met while extracting mods by hand:

| Rule | The case that forced it |
| --- | --- |
| `ParentName`, transitive | forgotten abstract bases, defs that fail to load |
| def references | a weapon pulls its workbench, which pulls its raw material |
| research and its prerequisites | twenty-six projects chained in a single mod |
| **orphan patches** | two operations with no target made the load fail |
| **dependencies gone useless** | an extraction had lost its HAR dependency unnoticed |
| unresolved references | neither in the mod nor in the game: missing dependency or typo |

The two rules in bold are the most useful: they point at what can be **removed**,
which no reading of the XML gives up on its own.

## Classifying the modlist

A modlist of a hundred and eighty mods cannot be held in one's head. Each mod
therefore carries labels, put on with one click from the list: engine/UI,
gameplay, animals, joy, textures, food, plants, factions, races, medical,
furniture, structure, apparel/hair, ideology, weapons/armour, vehicles. A
creature mod
brings animals *and* their textures; an overhaul touches gameplay *and*
factions.

Where a category's border was settled on a mod that straddled it, the decision is
written next to the category and shown on the chip — storage furniture counts as
furniture, for one. The moment of hesitation is the moment the chip is hovered,
so that is where the answer lives.

One label is the common case, several the exception, and the exception costs
nothing: the row waits ten seconds, and every further click restarts that wait.
The labels sit on their own line under the name — at sixteen of them they need
some eight hundred pixels, and sharing a line meant either wrapping rows, whose
varying heights send clicks to the neighbouring mod, or truncating the name,
which is the one thing on the row that identifies the mod.

**One label is enough to call a mod sorted** — not "kept", only "looked at, and I
now know what it does". That is what moves the work forward; deciding to extract
comes later, and only for a fraction of them. Sorting is not a separate field but
a reading of the labels, so removing the last one puts the mod back in the queue
with nothing else to undo.

A freshly labelled row leaves the list ten seconds later — but only where the
filter says it should. Under "to sort" it goes; under "sorted" or "both" it
stays. The delay only postpones the filter's effect, it does not override it.

A mod that declares no 1.6 version also gets a **works in 1.6** button. RimWorld
refuses to load what About.xml does not announce, but most content mods carry
over unchanged. The flag keeps the record of the test in game, so an already
verified mod does not read as dead on every pass through the list.

The classification lives in `data/mod-labels.json`, versioned with the rest: it
is built over weeks, it cannot depend on a browser cache.

The list controls — scope, sorting filter, label filter, search — are remembered
across visits and across days, in the browser. So is the selection made on a
mod sheet, one entry per mod: deciding on a few hundred entries is an hour of
work, and leaving the page used to throw it away, which meant the sheet could
only be used in one sitting. They are not the work, so they do
not belong in the file; but the scope and the sorting filter decide WHICH mods
are missing from the list, and a list quietly showing the wrong set is worse than
an empty one.

## Defs named after somebody else

Modders prefix their defNames and are consistent about it, so the handful that
break the pattern are worth a second look. On the Halloween mod, thirty-four defs
out of thirty-nine started with Lavas and the five that did not all started with
DankPyon_ — a JobDef copied verbatim from Medieval Overhaul, and four
ItemAcceptedDefs left over from 1.5 whose class no longer exists anywhere.
Nothing else in the tool pointed at them.

It only fires where there is a convention to break: the dominant prefix must hold
70% of the prefixed defs, and prefixes that extend one another count as one
author. Both bounds come from a mod that must NOT be flagged — the Vanilla
Expanded Framework is five subsystems in one folder and its biggest family covers
58%, so it stays silent; and Lava_ among thirty-three Lavas_ is not an outsider.

## Inheritance

Each def shows its parent chain to the root, not only its immediate parent. A mod
def declares almost nothing — `KCSG_PowerConduit` gets its cost, its size and its
category from `PowerConduit`, which gets them from `BuildingBase`.

Three origins, told apart by colour:

| Link | Meaning |
| --- | --- |
| neutral | base declared in this mod |
| green | base of the game (Core or DLC) |
| **dotted red** | parent named but nowhere to be found |

The last case is the useful piece of information: it says the base lives in a
dependency that was not scanned, and it is always the explanation for an empty
tech level or Architect category. The Vanilla Vehicles Expanded add-ons are full
of them — their turrets inherit from `VehicleTurretBase`, which belongs to the
Vehicle Framework.

## State

Done: listing of installed and active mods, inspection with thumbnails, tech
level resolved through inheritance, Architect menu category, linked research,
dependency closure with the reason for every addition, detection of orphan
patches and useless dependencies, full inheritance chain, modlist classification
by labels, links to the Steam Workshop pages.

A saved configuration lands in `data/configs/cherrypick-<packageId>.json`,
written straight into the repository rather than downloaded — a config filed
beside the day's screenshots is one that never gets replayed.

## The output is a Cherry Picker list

Nothing is generated. The source mod stays loaded as it is, and Owlchemist's
Cherry Picker is told to remove what was not wanted — nothing to copy, nothing to
re-port when the upstream moves, and the credit stays with its author.

Which means the list holds the DROPPED defs, not the kept ones: a cherry-pick
configuration and a mod generation are exactly each other's inverse.

The key format is Cherry Picker's own, read from its assembly
(`DefUtility.ToKey`): `TypeName/defName`, or `TypeName/defName/Namespace` for a
type outside `Verse` and `RimWorld`. That third segment is how it finds the
assembly again — a third-party def such as
`ItemAcceptedDef/DankPyon_SmokerFirstItem/ItemProcessor` cannot be removed
without it. An abstract base carries no defName and cannot be removed at all; it
produces nothing once its concrete defs are gone.

Its settings file is global, one list for every mod, so a configuration is MERGED
into it rather than written over it. The merge needs to know which keys belong to
the mod being sorted — otherwise an entry just taken back cannot be told from a
key placed while sorting another mod. Every write makes a timestamped backup
first, and RimWorld must be closed: it holds its settings in memory and writes
them out on quit.

To come: resource merging with an alternative display (style or `randomGraphics`
depending on how many sources target the same def), and the generation of the mod
itself.
