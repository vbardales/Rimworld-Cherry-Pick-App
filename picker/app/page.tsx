"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Labeler } from "@/components/Labeler";
import { CATEGORIES, isSorted, key, labelOf, type CategoryId, type ModLabel } from "@/lib/labels";
import { workshopUrl } from "@/lib/steam";

type ModRow = {
  PackageId: string;
  Name: string;
  Author: string;
  Path: string;
  Source: string;
  Found: boolean;
  Active: boolean;
  SupportedVersions: string[];
  DeadBefore16: boolean;
  Description: string;
  DeclaredDependencies: string[];
  MissingDependencies: string[];
};

type Sift = "all" | "todo" | "done";

// How long a labelled mod stays before leaving the list.
//
// Picking a category means the mod has been looked at, so marking it "sorted" by
// hand right after would be a second click saying what the first already said.
// But the row cannot vanish on the click itself — there has to be time to add a
// second label, and to notice one was put on the wrong row.
const HOLD_MS = 10_000;

// How long the row then takes to fold up. Kept in step with the CSS animation.
const FOLD_MS = 450;

// Where the state of the controls is kept between visits.
//
// Opening a mod and coming back reset them, and the two that reset silently are
// the costly ones: the scope and the sorting filter say WHICH mods are missing
// from the list, and a list quietly showing the wrong set is worse than an empty
// one. So they are remembered across visits, and across days — this is a tool one
// comes back to, not a page one lands on.
const KEEP = "cherrypick:list";

export default function Home() {
  const [scope, setScope] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ModRow[]>([]);
  const [busy, setBusy] = useState(true);
  // Ce qui declenche une relecture, et rien d'autre.
  //
  // On lit TOUT une fois, puis on filtre sur place. Un filtre n'est plus une
  // question posee au disque : les nom mille mods sont deja la, et le serveur ne
  // repond plus qu'a une demande explicite — au lancement, au changement de
  // perimetre, ou sur le bouton.
  const [relire, setRelire] = useState(0);
  const [lu, setLu] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [labels, setLabels] = useState<Record<string, ModLabel>>({});
  const [sift, setSift] = useState<Sift>("all");
  const [only, setOnly] = useState<CategoryId[]>([]);

  // Ne montrer que ce qui ne tourne pas en 1.6.
  //
  // « Mort avant 1.6 » est une deduction : le mod ne declare pas 1.6. Le bouton
  // « tourne en 1.6 » dement cette deduction un mod a la fois, et ce filtre est ce
  // qui reste a verifier — la pile de portages possibles, sans ceux deja essayes.
  const [casse, setCasse] = useState(false);

  // Ne montrer que ce qui manque vraiment une dependance.
  //
  // « Manque » veut dire absente du disque, pas seulement inactive : une
  // dependance installee mais eteinte est l'affaire de la modlist, pas du mod.
  // Le moteur fait deja cette distinction (ModList.MissingOf) ; ici on ne fait
  // que la lire.
  const [depsManquantes, setDepsManquantes] = useState(false);

  // Les mods marques d'une etoile. Une marque a part, orthogonale au tri : un
  // mod peut etre etoile et pas encore classe, ou classe et jamais etoile.
  const [etoiles, setEtoiles] = useState(false);

  // Dossiers Workshop videes par le moteur a la derniere lecture — residus
  // Steam sans meme un About.xml. Montre une fois, puis efface : il n'y a rien
  // a en faire, juste a savoir que c'est arrive.
  const [purges, setPurges] = useState<string[]>([]);

  // Le retour en haut ne s'affiche qu'une fois la barre de filtres hors de vue.
  //
  // Un bouton toujours la, c'est un bouton qui recouvre une ligne pour rien pendant
  // les trois quarts du temps. On l'accroche au defilement, et on ne redessine que
  // sur le passage du seuil — pas a chaque pixel.
  const [loin, setLoin] = useState(false);
  useEffect(() => {
    const seuil = () => setLoin(window.scrollY > 600);
    window.addEventListener("scroll", seuil, { passive: true });
    return () => window.removeEventListener("scroll", seuil);
  }, []);

  // Combien de lignes on dessine, et pourquoi ce n'est pas tout.
  //
  // Le serveur repond en soixante millisecondes ; c'est le navigateur qui peine.
  // Une ligne porte dix-sept puces, donc deux cents lignes en portent plus de
  // trois mille quatre cents — a chaque changement de filtre, autant de boutons a
  // construire. La memoisation n'y peut rien : quand le filtre change, les lignes
  // changent vraiment, et il faut bien les dessiner.
  //
  // On en dessine donc soixante, et on charge la suite a la demande. Le tri se
  // fait par le haut de la liste : les cent quarante autres ne servaient qu'a
  // ralentir le clic suivant.
  const PAS = 60;
  const [visibles, setVisibles] = useState(PAS);

  // Mods on reprieve: just labelled, and momentarily exempt from the current
  // filter.
  const [leaving, setLeaving] = useState<string[]>([]);

  // Mods on their way out: the reprieve is over, and the row is folding up.
  //
  // React would unmount the row the instant the filter drops it, and everything
  // below would jump up under the pointer — which is exactly how a click lands on
  // the wrong mod. So the row stays mounted for the length of the fold, taking no
  // clicks, and the list closes up at a speed the eye can follow.
  const [folding, setFolding] = useState<string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // The controls are restored after mounting, never while rendering: reading
  // localStorage during the first render would make the server's HTML and the
  // browser's disagree, and React would throw the whole tree away.
  //
  // Nothing is written back before the restore has happened, otherwise the first
  // render would overwrite the stored state with the defaults it was about to
  // replace.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(KEEP) ?? "{}");
      if (kept.scope === "all" || kept.scope === "active") setScope(kept.scope);
      if (["all", "todo", "done"].includes(kept.sift)) setSift(kept.sift);
      if (typeof kept.q === "string") setQ(kept.q);
      if (typeof kept.casse === "boolean") setCasse(kept.casse);
      if (typeof kept.depsManquantes === "boolean") setDepsManquantes(kept.depsManquantes);
      if (typeof kept.etoiles === "boolean") setEtoiles(kept.etoiles);
      // Labels come and go. A category that no longer exists would filter the list
      // down to nothing, with no visible reason — so only the known ones survive.
      if (Array.isArray(kept.only)) {
        const known = new Set<string>(CATEGORIES.map((c) => c.id));
        setOnly(kept.only.filter((c: CategoryId) => known.has(c)));
      }
    } catch {
      // no stored state, or unreadable: the defaults are fine
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(KEEP, JSON.stringify({ scope, q, sift, only, casse, depsManquantes, etoiles }));
    } catch {
      // private window, or storage refused: the tool works, it just forgets
    }
  }, [restored, scope, q, sift, only, casse, depsManquantes, etoiles]);

  // Le classement se lit avec la liste, et sa panne se voit.
  //
  // Il ne dependait ni du perimetre ni de la recherche, donc il se lisait une seule
  // fois au montage — et son echec etait avale en silence. Tant que la reponse des
  // mods portait aussi les etiquettes des lignes rendues, cet oubli se reparait
  // tout seul a chaque filtre. Depuis qu'on ne lit plus qu'une fois, c'est devenu
  // l'unique source : ratee, tous les mods paraissent non tries, « tries » ne rend
  // rien, et rien ne dit pourquoi.
  //
  // Donc : relue en meme temps que la liste — le bouton « relire » la rattrape — et
  // un echec s'affiche au lieu de se deviner.
  useEffect(() => {
    if (!restored) return;
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setLabels(d.mods ?? {});
      })
      .catch((e) => setError("classement illisible — les etiquettes manquent : " + String(e)));
  }, [restored, relire]);

  useEffect(() => {
    // Nothing is fetched before the controls are restored: the scope decides what
    // is asked for, and asking with the default first would spend a second of
    // engine time on a list about to be replaced.
    if (!restored) return;
    // Une lecture en cours est abandonnee des qu'une autre est demandee.
    //
    // Le nettoyage ne coupait que le delai d'attente : une requete deja partie
    // continuait, et sa reponse ecrasait la suivante si elle arrivait apres. Sur
    // les neuf mille mods installes, une lecture prenait plusieurs secondes — on
    // changeait de perimetre, on attendait, et on obtenait le perimetre precedent,
    // avec des commandes qui disaient autre chose que la liste.
    const abandon = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      // Tout le perimetre, sans plafond : c'est le seul appel de la session, et il
      // faut qu'aucun filtre pose ensuite n'ait a redemander quoi que ce soit.
      fetch(`/api/mods?scope=${scope}&limit=0`, { signal: abandon.signal })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setRows(d.mods);
          setLu(new Date());
          if (Array.isArray(d.pruned) && d.pruned.length > 0) setPurges(d.pruned);
        })
        .catch((e) => {
          // Une lecture abandonnee n'est pas une panne : elle a ete remplacee.
          if (e?.name !== "AbortError") setError(String(e));
        })
        .finally(() => {
          // Et elle ne rend pas la main non plus : la lecture qui l'a remplacee
          // est encore en cours, l'attente doit continuer de se voir.
          if (!abandon.signal.aborted) setBusy(false);
        });
    }, 180);
    return () => { clearTimeout(timer); abandon.abort(); };
  }, [restored, scope, relire]);

  // Changer de filtre, c'est repartir du haut : le plafond retombe avec la liste.
  useEffect(() => { setVisibles(PAS); }, [scope, q, sift, only, casse, depsManquantes, etoiles]);

  // Ce que le tri a deja couvert, compte sur l'ensemble et non sur la page.
  //
  // Le serveur donnait ces nombres ; il les redonnait donc a chaque filtre. Ici
  // ils se recalculent quand une etiquette est posee, et se voient bouger au clic.
  const counts = useMemo(() => {
    const sorted = rows.filter((m) => isSorted(labelOf(labels, m.PackageId))).length;
    const ko = rows.filter((m) => m.DeadBefore16 && !labelOf(labels, m.PackageId).works16).length;
    const manquantes = rows.filter((m) => m.MissingDependencies.length > 0).length;
    const etoilees = rows.filter((m) => labelOf(labels, m.PackageId).starred).length;
    return { total: rows.length, sorted, todo: rows.length - sorted, ko, manquantes, etoilees };
  }, [rows, labels]);

  const cancelLeaving = useCallback((packageId: string) => {
    const t = timers.current.get(packageId);
    if (t) { clearTimeout(t); timers.current.delete(packageId); }
    setLeaving((prev) => (prev.includes(packageId) ? prev.filter((x) => x !== packageId) : prev));
    setFolding((prev) => (prev.includes(packageId) ? prev.filter((x) => x !== packageId) : prev));
  }, []);

  // A label sends the mod out of the list after a delay — but only under "to
  // sort", the one view a label actually empties. Under "sorted and unsorted" or
  // "sorted", labelling changes nothing about whether the row belongs, so there
  // is nothing to fold: scheduling the animation anyway made the row fade, fold
  // to nothing, then snap back open the instant the timer cleared it, since
  // `shown` had kept it in the list the whole time.
  //
  // The departure is decided on the LABELS, not on the "sorted" state: the server
  // derives sorting from the labels, so its reply always comes back sorted, and
  // reading that flag cancelled the departure right after scheduling it.
  //
  // The delay restarts on every click: adding a second category means the mod is
  // not fully described yet, not that it should leave sooner.
  const patchLabel = useCallback((packageId: string, label: ModLabel) => {
    setLabels((prev) => ({ ...prev, [key(packageId)]: label }));

    // Removing every label cancels the departure: it is the only way to do it, and
    // it is enough — a cancel button at the end of the row would shift the labels.
    if (label.categories.length === 0) { cancelLeaving(packageId); return; }
    if (sift !== "todo") return;

    const t = timers.current.get(packageId);
    if (t) clearTimeout(t);
    setLeaving((prev) => (prev.includes(packageId) ? prev : [...prev, packageId]));
    timers.current.set(packageId, setTimeout(() => {
      // The row's real height, handed to the animation.
      //
      // A guessed starting height is worse than none: too high and the fold spends
      // its first moments doing nothing visible, too low and the row snaps down
      // before it starts. Both defeat the point, which is that the movement be
      // followable. Measuring is one line, and it survives a row that wraps.
      const row = document.querySelector<HTMLElement>(
        `.mods li[data-pid="${CSS.escape(packageId)}"]`,
      );
      row?.style.setProperty("--h", `${row.offsetHeight}px`);

      setLeaving((prev) => prev.filter((x) => x !== packageId));
      setFolding((prev) => (prev.includes(packageId) ? prev : [...prev, packageId]));

      // Same duration as the CSS animation. Ending the fold early would make the
      // row snap out; ending it late would leave a gap in the list.
      timers.current.set(packageId, setTimeout(() => {
        timers.current.delete(packageId);
        setFolding((prev) => prev.filter((x) => x !== packageId));
      }, FOLD_MS));
    }, HOLD_MS));
  }, [cancelLeaving, sift]);

  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  // A star never sends the mod away, whatever the current filter: it is not a
  // classification, and disappearing on a click that only marks a mod as
  // particular would be the same surprise the sift guard above exists to avoid.
  const toggleStar = useCallback((packageId: string, cur: ModLabel) => {
    const optimiste: ModLabel = { ...cur, starred: !cur.starred, updated: new Date().toISOString() };
    setLabels((prev) => ({ ...prev, [key(packageId)]: optimiste }));
    fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, starred: optimiste.starred }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (d.label) setLabels((prev) => ({ ...prev, [key(packageId)]: d.label }));
      })
      .catch(() => setLabels((prev) => ({ ...prev, [key(packageId)]: cur })));
  }, []);

  // Turns a mod on or off in ModsConfig.xml. Optimistic for the same reason every
  // other click on this page is: the file write takes a moment, and a button
  // that waits for it feels broken long before it actually fails.
  const [activationEnCours, setActivationEnCours] = useState<Set<string>>(new Set());
  const toggleActive = useCallback((packageId: string, on: boolean) => {
    setRows((prev) => prev.map((m) => (m.PackageId === packageId ? { ...m, Active: on } : m)));
    setActivationEnCours((prev) => new Set(prev).add(packageId));
    fetch("/api/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, on }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      })
      .catch(() => {
        setRows((prev) => prev.map((m) => (m.PackageId === packageId ? { ...m, Active: !on } : m)));
        setError(`activation non enregistree pour ${packageId}`);
      })
      .finally(() => {
        setActivationEnCours((prev) => { const n = new Set(prev); n.delete(packageId); return n; });
      });
  }, []);

  // Tout le filtrage se fait ici, sur la liste complete tenue en memoire.
  //
  // Il partait au serveur tant que la reponse etait bornee a deux cents lignes :
  // filtrer apres une troncature, c'est repondre a une question que personne n'a
  // posee. La reponse n'est plus bornee, donc le disque n'a plus rien a en savoir,
  // et changer de filtre ne coute plus un aller-retour.
  // Ce que la recherche cherche.
  //
  // Elle accepte une expression reguliere, et le motif qui sert vraiment est
  // « ^ » : dix mods commencent par « Vanilla Factions Expanded », cinquante en
  // parlent, et « contient » ne permet pas de le dire. On tape « ^vanilla » et on
  // les a.
  //
  // Un motif se tape caractere par caractere, donc il est invalide pendant qu'on
  // l'ecrit : « [a » n'est pas une erreur, c'est un motif inacheve. Tant qu'il ne
  // compile pas on retombe sur la recherche par sous-chaine, qui trouve toujours
  // quelque chose de raisonnable, et le champ le signale sans rien bloquer.
  const motif = useMemo(() => {
    const c = q.trim();
    if (!c) return null;
    try {
      return { re: new RegExp(c, "i"), valide: true };
    } catch {
      return { texte: c.toLowerCase(), valide: false };
    }
  }, [q]);

  const shown = useMemo(() => {
    return rows.filter((m) => {
      if (motif) {
        // L'auteur est cherchable au meme titre que le nom : « hanaasagi » est
        // parfois la seule chose qu'on sache retaper d'un mod dont le titre est
        // en japonais.
        const va = motif.re
          ? motif.re.test(m.Name) || motif.re.test(m.PackageId) || motif.re.test(m.Author)
          : m.Name.toLowerCase().includes(motif.texte!) ||
            m.PackageId.toLowerCase().includes(motif.texte!) ||
            m.Author.toLowerCase().includes(motif.texte!);
        if (!va) return false;
      }
      // A freshly labelled row stays visible for ten seconds, then the filter takes
      // over. It is the FILTER that decides the departure, not the delay: under "to
      // sort" the row leaves, since labelling is sorting; under "sorted" or "both"
      // it stays, and making it vanish from a view where it belongs would be
      // absurd.
      //
      // Without this reprieve, labelling under "to sort" whisks the row away on the
      // click: the mod becomes sorted at that very instant, so the filter drops it
      // before the delay has served any purpose.
      if (leaving.includes(m.PackageId) || folding.includes(m.PackageId)) return true;
      const l = labelOf(labels, m.PackageId);
      // « Tourne en 1.6 » l'emporte sur ce que le mod declare : c'est une
      // verification faite a la main, la declaration n'est qu'une presomption.
      if (casse && (!m.DeadBefore16 || l.works16)) return false;
      if (depsManquantes && m.MissingDependencies.length === 0) return false;
      if (etoiles && !l.starred) return false;
      if (sift === "todo" && isSorted(l)) return false;
      if (sift === "done" && !isSorted(l)) return false;
      if (sift === "todo") return true;    // rien d'etiquete ici : le filtre par etiquette ne s'applique pas
      // Several labels ticked means OR: one looks for "everything touching animals
      // or plants", not their intersection, which would almost always be empty.
      if (only.length > 0 && !only.some((c) => l.categories.includes(c))) return false;
      return true;
    });
  }, [rows, motif, labels, sift, only, casse, depsManquantes, etoiles, leaving, folding]);

  return (
    <main className="wrap">
      <header>
        <h1>cherrypick</h1>
        <p className="sub">
          Inspecter un mod, choisir ce qu&apos;on en garde, et voir ce que ce choix entraine.
        </p>
      </header>

      <div className="bar">
        <div className="seg">
          <button
            className={scope === "active" ? "on" : ""}
            onClick={() => setScope("active")}
          >
            ma modlist
          </button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            tous les mods installes
          </button>
        </div>
        <input
          type="search"
          className={motif && !motif.valide ? "bancal" : ""}
          placeholder="nom, auteur, packageId, ou expression reguliere (^vanilla)"
          title="Une expression reguliere est acceptee : ^vanilla pour ce qui commence par Vanilla. Tant qu'elle est incomplete, la recherche se fait par sous-chaine."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sift} onChange={(e) => setSift(e.target.value as Sift)}>
          <option value="all">tries et non tries</option>
          <option value="todo">a trier ({counts.todo})</option>
          <option value="done">tries ({counts.sorted})</option>
          </select>
        {/* Un filtre a part, parce que ce n'est pas la meme question.
            Le menu dit ou on en est du tri ; celui-ci dit ce qui reste a faire
            tourner. Un mod peut etre trie et casse, ou intact et jamais regarde. */}
        <button className={casse ? "on" : ""} onClick={() => setCasse((v) => !v)}>
          ne tourne pas en 1.6 ({counts.ko})
        </button>
        {/* Manquante veut dire absente du disque, pas seulement inactive : voir
            ModList.MissingOf cote moteur, qui fait deja la difference. */}
        <button className={depsManquantes ? "on" : ""} onClick={() => setDepsManquantes((v) => !v)}>
          dependance manquante ({counts.manquantes})
        </button>
        <button className={etoiles ? "on" : ""} onClick={() => setEtoiles((v) => !v)}>
          ★ etoiles ({counts.etoilees})
        </button>
        <span className="tally">
          {busy
            ? "lecture..."
            : `${shown.length} affiche${shown.length > 1 ? "s" : ""} sur ${counts.total}`}
        </span>
        {/* Relire est un geste, pas une consequence.
            Le disque n'est consulte qu'ici : un mod installe ou desinstalle pendant
            la session ne se voit qu'apres ce bouton. L'heure dit de quand date ce
            qu'on regarde — sans elle, une liste perimee ressemble a une liste. */}
        <button className="ghost" onClick={() => setRelire((n) => n + 1)} disabled={busy}>
          relire le disque
          {lu && (
            <span className="sub">
              {" "}— lu a {lu.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </button>
      </div>

      <div className="bar bulk">
        <span className="sub">
          {sift === "todo" ? "les etiquettes ne filtrent pas ce qui reste a trier :" : "ne montrer que :"}
        </span>
        {/* Un menu, pas dix-neuf pastilles.
            Le choix devient unique : la liste rendait la ligne illisible bien
            avant qu'on ait besoin de croiser deux etiquettes. `only` reste un
            tableau, parce que le filtre et les preferences enregistrees le
            lisent ainsi, et parce qu'un jour on voudra peut-etre y remettre
            deux valeurs. */}
        <select
          // Une etiquette posee vaut tri : sous « a trier », aucun mod n'en
          // porte, et la liste sortait vide sans jamais dire pourquoi.
          disabled={sift === "todo"}
          value={only[0] ?? ""}
          onChange={(e) => setOnly(e.target.value ? [e.target.value as CategoryId] : [])}
        >
          <option value="">tout afficher</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="err">{error}</p>}

      {purges.length > 0 && (
        <p className="purge">
          {purges.length} dossier{purges.length > 1 ? "s" : ""} Workshop vide
          {purges.length > 1 ? "s" : ""} supprime{purges.length > 1 ? "s" : ""} (residu Steam, sans About.xml)
          {" "}
          <button className="ghost" onClick={() => setPurges([])}>ok</button>
        </p>
      )}

      <ul className="mods">
        {shown.slice(0, visibles).map((m) => (
          <Ligne
            key={m.PackageId}
            mod={m}
            label={labelOf(labels, m.PackageId)}
            leaving={leaving.includes(m.PackageId)}
            folding={folding.includes(m.PackageId)}
            onChange={patchLabel}
            onStar={toggleStar}
            onToggleActive={toggleActive}
            activating={activationEnCours.has(m.PackageId)}
          />
        ))}
      </ul>

      {shown.length > visibles && (
        <div className="suite">
          <button className="plus" onClick={() => setVisibles((n) => n + PAS)}>
            afficher {Math.min(PAS, shown.length - visibles)} de plus
            <span className="sub"> — {shown.length - visibles} restants</span>
          </button>
          {/* Tout d'un coup, avec le prix affiche.
              Une ligne porte dix-neuf puces : deux cents lignes en font quatre
              mille, et les neuf mille sept cents installes en feraient cent
              quatre-vingt-cinq mille, ce qu'aucun navigateur ne dessine sans se
              figer plusieurs secondes. On ne l'interdit pas — sur une recherche qui
              a deja reduit la liste, c'est exactement ce qu'on veut — mais le
              nombre est ecrit sur le bouton, et au-dela de mille il le dit. */}
          <button className="plus tout" onClick={() => setVisibles(shown.length)}>
            tout afficher ({shown.length})
            {shown.length > 1000 && <span className="sub"> — ce sera long</span>}
          </button>
        </div>
      )}

      {loin && (
        <button className="haut" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                title="revenir en haut">
          ↑
        </button>
      )}

      {!busy && shown.length === 0 && <p className="sub">Aucun mod ne correspond.</p>}
    </main>
  );
}

// Une ligne de la liste, memoisee.
//
// Le compte a rebours d'un depart, une etiquette posee ailleurs, une lecture qui
// revient : chacun de ces evenements est un etat de la PAGE, et redessinait donc
// les quatre-vingt-dix-neuf lignes et leurs seize cent quatre-vingt-trois puces.
// Ici les props d'une ligne ne changent que si CETTE ligne change — l'objet du
// mod vient de la reponse du serveur, le label du magasin, et onChange d'un
// useCallback.
const Ligne = memo(function Ligne({
  mod, label, leaving, folding, onChange, onStar, onToggleActive, activating,
}: {
  mod: ModRow;
  label: ModLabel;
  leaving: boolean;
  folding: boolean;
  onChange: (packageId: string, label: ModLabel) => void;
  onStar: (packageId: string, cur: ModLabel) => void;
  onToggleActive: (packageId: string, on: boolean) => void;
  activating: boolean;
}) {
  const steam = workshopUrl(mod.Path);
  return (
    <li
      data-pid={mod.PackageId}
      className={`${isSorted(label) ? "sorted" : ""}${leaving ? " leaving" : ""}${folding ? " folding" : ""}`}
    >
      <Link href={`/mod/${encodeURIComponent(mod.PackageId)}?path=${encodeURIComponent(mod.Path)}`}>
        {/* La description d'About.xml, au survol seulement : elle peut faire
            plusieurs paragraphes, et il n'y a pas de place pour elle dans la
            ligne elle-meme. `title` est le seul survol qui ne coute rien — pas
            d'etat, pas de positionnement a calculer. */}
        <span className="name" title={mod.Description || undefined}>
          {mod.Name || mod.PackageId}
        </span>{" "}
        <span className="pid">{mod.PackageId}</span>{" "}
        {/* L'auteur, quand About.xml le donne.
            C'est la seule identite qui reste aux mods d'avant 1.0 : pas de
            packageId, souvent un nom qui ne dit rien hors de sa langue. Sur les
            autres, il evite de confondre deux mods homonymes. */}
        {mod.Author && <span className="auteur">{mod.Author}</span>}{" "}
        <span className="tags">
          {mod.Active && <em className="tag act">actif</em>}
          <em className="tag">{mod.Source}</em>
          {mod.SupportedVersions.length > 0 && (
            <em className="tag">{mod.SupportedVersions.join(" ")}</em>
          )}
          {mod.DeadBefore16 && !label.works16 && <em className="tag dead">mort avant 1.6</em>}
          {mod.DeadBefore16 && label.works16 && <em className="tag act">tourne en 1.6</em>}
          {/* Ce mod ne declare pas de packageId, et la cle affichee est une cle de
              repli fabriquee depuis son dossier.
              Le champ n'est devenu obligatoire qu'en 1.0 : c'est donc la population
              des mods B18 et anterieurs, plus quelques negligents recents. Elle
              merite d'etre vue, parce qu'un mod sans packageId ne se porte pas, il
              se reconstruit — et parce que le jeu lui-meme ne sait pas l'activer. */}
          {mod.PackageId.includes(":") && (
            <em className="tag nopid" title="Ce mod ne déclare pas de packageId : la clé affichée est fabriquée depuis son dossier. Le jeu ne peut pas l'activer en l'état.">
              sans packageId
            </em>
          )}
          {/* Absente du disque, pas seulement eteinte — voir ModList.MissingOf
              cote moteur. */}
          {mod.MissingDependencies.length > 0 && (
            <em
              className="tag missing"
              title={`Declare mais absente : ${mod.MissingDependencies.join(", ")}`}
            >
              dependance manquante
            </em>
          )}
        </span>
      </Link>
      {/* Space reserved even with no page: a local mod has none, and a magnifier
          that comes and goes shifts the whole row. */}
      <a
        className={`peek${steam ? "" : " off"}`}
        href={steam ?? undefined}
        target="_blank"
        rel="noreferrer noopener"
        title={steam ? "ouvrir la fiche Steam Workshop" : "pas de fiche Steam : mod local"}
        onClick={(e) => e.stopPropagation()}
      >
        🔍
      </a>
      <button
        type="button"
        className={`star${label.starred ? " on" : ""}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStar(mod.PackageId, label); }}
        title={label.starred ? "retirer l'etoile" : "marquer comme particulier"}
      >
        {label.starred ? "★" : "☆"}
      </button>
      {/* Bascule ModsConfig.xml, exactement comme la case a cocher de RimSort.
          Reserve meme si le mod n'a pas de packageId : le jeu ne peut de toute
          facon pas l'activer, et le bouton desactive le dit mieux qu'une
          absence. */}
      <button
        type="button"
        className={`activer${mod.Active ? " on" : ""}`}
        disabled={activating || mod.PackageId.includes(":")}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleActive(mod.PackageId, !mod.Active); }}
        title={
          mod.PackageId.includes(":")
            ? "sans packageId : le jeu ne peut pas l'activer"
            : mod.Active ? "desactiver" : "activer"
        }
      >
        {mod.Active ? "activé" : "activer"}
      </button>
      <Labeler
        packageId={mod.PackageId}
        path={mod.Path}
        label={label}
        onChange={onChange}
        compact
        dead={mod.DeadBefore16}
      />
    </li>
  );
});
