"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Labeler } from "@/components/Labeler";
import { CATEGORIES, EMPTY, isSorted, type CategoryId, type ModLabel } from "@/lib/labels";
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

export default function Home() {
  const [scope, setScope] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ModRow[]>([]);
  const [counts, setCounts] = useState({ total: 0, matched: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [labels, setLabels] = useState<Record<string, ModLabel>>({});
  const [sift, setSift] = useState<Sift>("all");
  const [only, setOnly] = useState<CategoryId[]>([]);

  // Mods on reprieve: just labelled, and momentarily exempt from the current
  // filter.
  const [leaving, setLeaving] = useState<string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // The classification loads once: it depends neither on the scope nor on the
  // search, and it is tiny next to the list of mods.
  useEffect(() => {
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => setLabels(d.mods ?? {}))
      .catch(() => { /* an unreadable classification must not block the list */ });
  }, []);

  useEffect(() => {
    // A mod is searched for by typing: we wait for a pause before asking the
    // server, otherwise every keystroke re-filters five thousand entries.
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      fetch(`/api/mods?scope=${scope}&q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setRows(d.mods);
          setCounts({ total: d.total, matched: d.matched });
        })
        .catch((e) => setError(String(e)))
        .finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [scope, q]);

  const cancelLeaving = useCallback((packageId: string) => {
    const t = timers.current.get(packageId);
    if (t) { clearTimeout(t); timers.current.delete(packageId); }
    setLeaving((prev) => (prev.includes(packageId) ? prev.filter((x) => x !== packageId) : prev));
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
    setLabels((prev) => ({ ...prev, [packageId]: label }));

    // Removing every label cancels the departure: it is the only way to do it, and
    // it is enough — a cancel button at the end of the row would shift the labels.
    if (label.categories.length === 0) { cancelLeaving(packageId); return; }

    const t = timers.current.get(packageId);
    if (t) clearTimeout(t);
    setLeaving((prev) => (prev.includes(packageId) ? prev : [...prev, packageId]));
    timers.current.set(packageId, setTimeout(() => {
      timers.current.delete(packageId);
      setLeaving((prev) => prev.filter((x) => x !== packageId));
    }, HOLD_MS));
  }, [cancelLeaving]);

  useEffect(() => {
    const map = timers.current;
    return () => { for (const t of map.values()) clearTimeout(t); map.clear(); };
  }, []);

  // Filtering by label works on what the server already returned: the
  // classification lives here, not in the engine, and the list is already capped.
  const shown = useMemo(() => {
    return rows.filter((m) => {
      // A freshly labelled row stays visible for ten seconds, then the filter takes
      // over. It is the FILTER that decides the departure, not the delay: under "to
      // sort" the row leaves, since labelling is sorting; under "sorted" or "both"
      // it stays, and making it vanish from a view where it belongs would be
      // absurd.
      //
      // Without this reprieve, labelling under "to sort" whisks the row away on the
      // click: the mod becomes sorted at that very instant, so the filter drops it
      // before the delay has served any purpose.
      if (leaving.includes(m.PackageId)) return true;
      const l = labels[m.PackageId] ?? EMPTY;
      if (sift === "todo" && isSorted(l)) return false;
      if (sift === "done" && !isSorted(l)) return false;
      // Several labels ticked means OR: one looks for "everything touching animals
      // or plants", not their intersection, which would almost always be empty.
      if (only.length > 0 && !only.some((c) => l.categories.includes(c))) return false;
      return true;
    });
  }, [rows, labels, sift, only, leaving]);

  const tally = useMemo(() => {
    const done = rows.filter((m) => isSorted(labels[m.PackageId] ?? EMPTY)).length;
    return { done, todo: rows.length - done };
  }, [rows, labels]);

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
          placeholder="filtrer par nom ou packageId..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sift} onChange={(e) => setSift(e.target.value as Sift)}>
          <option value="all">tries et non tries</option>
          <option value="todo">a trier ({tally.todo})</option>
          <option value="done">tries ({tally.done})</option>
          </select>
        <span className="tally">
          {busy
            ? "lecture..."
            : `${shown.length} affiche${shown.length > 1 ? "s" : ""} — ${counts.matched} sur ${counts.total}`}
        </span>
      </div>

      <div className="bar bulk">
        <span className="sub">ne montrer que :</span>
        <div className="labeler">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              data-cat={c.id}
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
        {shown.map((m) => {
          const l = labels[m.PackageId] ?? EMPTY;
          const due = leaving.includes(m.PackageId);
          const steam = workshopUrl(m.Path);
          return (
            <li
              key={m.PackageId}
              className={`${isSorted(l) ? "sorted" : ""}${due ? " leaving" : ""}`}
            >
              <Link
                href={`/mod/${encodeURIComponent(m.PackageId)}?path=${encodeURIComponent(m.Path)}`}
              >
                <span className="name">{m.Name || m.PackageId}</span>{" "}
                <span className="pid">{m.PackageId}</span>{" "}
                <span className="tags">
                  {m.Active && <em className="tag act">actif</em>}
                  <em className="tag">{m.Source}</em>
                  {m.SupportedVersions.length > 0 && (
                    <em className="tag">{m.SupportedVersions.join(" ")}</em>
                  )}
                  {m.DeadBefore16 && !l.works16 && <em className="tag dead">mort avant 1.6</em>}
                  {m.DeadBefore16 && l.works16 && <em className="tag act">tourne en 1.6</em>}
                </span>
              </Link>
              {/* Space reserved even with no page: a local mod has none, and a
                  magnifier that comes and goes shifts the whole row. */}
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
                packageId={m.PackageId}
                label={l}
                onChange={patchLabel}
                compact
                dead={m.DeadBefore16}
              />
            </li>
          );
        })}
      </ul>

      {!busy && shown.length === 0 && <p className="sub">Aucun mod ne correspond.</p>}
    </main>
  );
}
