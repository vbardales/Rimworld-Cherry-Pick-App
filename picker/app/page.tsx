"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Labeler } from "@/components/Labeler";
import { CATEGORIES, isSorted, key, labelOf, type CategoryId, type ModLabel } from "@/lib/labels";
import { workshopUrl } from "@/lib/steam";

type ModRow = {
  PackageId: string;
  Name: string;
  Path: string;
  Source: string;
  Found: boolean;
  Active: boolean;
  SupportedVersions: string[];
  DeadBefore16: boolean;
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
      localStorage.setItem(KEEP, JSON.stringify({ scope, q, sift, only, casse }));
    } catch {
      // private window, or storage refused: the tool works, it just forgets
    }
  }, [restored, scope, q, sift, only, casse]);

  // The classification loads once: it depends neither on the scope nor on the
  // search, and it is tiny next to the list of mods.
  useEffect(() => {
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => setLabels(d.mods ?? {}))
      .catch(() => { /* an unreadable classification must not block the list */ });
  }, []);

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
  useEffect(() => { setVisibles(PAS); }, [scope, q, sift, only, casse]);

  // Ce que le tri a deja couvert, compte sur l'ensemble et non sur la page.
  //
  // Le serveur donnait ces nombres ; il les redonnait donc a chaque filtre. Ici
  // ils se recalculent quand une etiquette est posee, et se voient bouger au clic.
  const counts = useMemo(() => {
    const sorted = rows.filter((m) => isSorted(labelOf(labels, m.PackageId))).length;
    const ko = rows.filter((m) => m.DeadBefore16 && !labelOf(labels, m.PackageId).works16).length;
    return { total: rows.length, sorted, todo: rows.length - sorted, ko };
  }, [rows, labels]);

  const cancelLeaving = useCallback((packageId: string) => {
    const t = timers.current.get(packageId);
    if (t) { clearTimeout(t); timers.current.delete(packageId); }
    setLeaving((prev) => (prev.includes(packageId) ? prev.filter((x) => x !== packageId) : prev));
    setFolding((prev) => (prev.includes(packageId) ? prev.filter((x) => x !== packageId) : prev));
  }, []);

  // A label sends the mod out of the list after a delay.
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
  }, [cancelLeaving]);

  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
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
        const va = motif.re
          ? motif.re.test(m.Name) || motif.re.test(m.PackageId)
          : m.Name.toLowerCase().includes(motif.texte!) ||
            m.PackageId.toLowerCase().includes(motif.texte!);
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
      if (sift === "todo" && isSorted(l)) return false;
      if (sift === "done" && !isSorted(l)) return false;
      if (sift === "todo") return true;    // rien d'etiquete ici : le filtre par etiquette ne s'applique pas
      // Several labels ticked means OR: one looks for "everything touching animals
      // or plants", not their intersection, which would almost always be empty.
      if (only.length > 0 && !only.some((c) => l.categories.includes(c))) return false;
      return true;
    });
  }, [rows, motif, labels, sift, only, casse, leaving, folding]);

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
          placeholder="nom, packageId, ou expression reguliere (^vanilla)"
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
        <div className="labeler">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              data-cat={c.id}
              // Une etiquette posee vaut tri : sous « a trier », aucun mod n'en
              // porte, et la liste sortait vide sans jamais dire pourquoi.
              disabled={sift === "todo"}
              className={`chip${only.includes(c.id) ? " on" : ""}`}
              onClick={() =>
                setOnly((prev) =>
                  prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                )
              }
            >
              {c.label}
            </button>
          ))}
        </div>
        {only.length > 0 && <button onClick={() => setOnly([])}>tout afficher</button>}
      </div>

      {error && <p className="err">{error}</p>}

      <ul className="mods">
        {shown.slice(0, visibles).map((m) => (
          <Ligne
            key={m.PackageId}
            mod={m}
            label={labelOf(labels, m.PackageId)}
            leaving={leaving.includes(m.PackageId)}
            folding={folding.includes(m.PackageId)}
            onChange={patchLabel}
          />
        ))}
      </ul>

      {shown.length > visibles && (
        <button className="plus" onClick={() => setVisibles((n) => n + PAS)}>
          afficher {Math.min(PAS, shown.length - visibles)} de plus
          <span className="sub"> — {shown.length - visibles} restants</span>
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
  mod, label, leaving, folding, onChange,
}: {
  mod: ModRow;
  label: ModLabel;
  leaving: boolean;
  folding: boolean;
  onChange: (packageId: string, label: ModLabel) => void;
}) {
  const steam = workshopUrl(mod.Path);
  return (
    <li
      data-pid={mod.PackageId}
      className={`${isSorted(label) ? "sorted" : ""}${leaving ? " leaving" : ""}${folding ? " folding" : ""}`}
    >
      <Link href={`/mod/${encodeURIComponent(mod.PackageId)}?path=${encodeURIComponent(mod.Path)}`}>
        <span className="name">{mod.Name || mod.PackageId}</span>{" "}
        <span className="pid">{mod.PackageId}</span>{" "}
        <span className="tags">
          {mod.Active && <em className="tag act">actif</em>}
          <em className="tag">{mod.Source}</em>
          {mod.SupportedVersions.length > 0 && (
            <em className="tag">{mod.SupportedVersions.join(" ")}</em>
          )}
          {mod.DeadBefore16 && !label.works16 && <em className="tag dead">mort avant 1.6</em>}
          {mod.DeadBefore16 && label.works16 && <em className="tag act">tourne en 1.6</em>}
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
      <Labeler
        packageId={mod.PackageId}
        label={label}
        onChange={onChange}
        compact
        dead={mod.DeadBefore16}
      />
    </li>
  );
});
