"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Labeler } from "@/components/Labeler";
import { CATEGORIES, EMPTY, type CategoryId, type ModLabel } from "@/lib/labels";

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

type Sift = "all" | "todo" | "done" | "untagged";

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

  // Le classement se charge une fois : il ne depend ni de la portee ni de la
  // recherche, et il est minuscule a cote de la liste des mods.
  useEffect(() => {
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => setLabels(d.mods ?? {}))
      .catch(() => { /* un tri illisible ne doit pas empecher la liste */ });
  }, []);

  useEffect(() => {
    // Un mod se cherche en tapant : on attend une pause avant d'interroger le
    // serveur, sinon chaque frappe relance un filtrage sur cinq mille entrees.
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

  const patchLabel = (packageId: string, label: ModLabel) =>
    setLabels((prev) => ({ ...prev, [packageId]: label }));

  // Le filtre par etiquette porte sur ce que le serveur a deja renvoye : le tri
  // vit ici, pas dans le moteur, et la liste est deja bornee.
  const shown = useMemo(() => {
    return rows.filter((m) => {
      const l = labels[m.PackageId] ?? EMPTY;
      if (sift === "todo" && l.reviewed) return false;
      if (sift === "done" && !l.reviewed) return false;
      if (sift === "untagged" && l.categories.length > 0) return false;
      // Plusieurs etiquettes cochees, c'est un OU : on cherche « tout ce qui
      // touche aux animaux ou aux plantes », pas leur intersection, qui serait
      // presque toujours vide.
      if (only.length > 0 && !only.some((c) => l.categories.includes(c))) return false;
      return true;
    });
  }, [rows, labels, sift, only]);

  const tally = useMemo(() => {
    const done = rows.filter((m) => (labels[m.PackageId] ?? EMPTY).reviewed).length;
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
          <option value="untagged">sans etiquette</option>
        </select>
        <span className="tally">
          {busy
            ? "lecture..."
            : `${shown.length} affiches — ${counts.matched} sur ${counts.total}`}
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
          return (
            <li key={m.PackageId} className={l.reviewed ? "sorted" : ""}>
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
                  {m.DeadBefore16 && <em className="tag dead">mort avant 1.6</em>}
                </span>
              </Link>
              <Labeler packageId={m.PackageId} label={l} onChange={patchLabel} compact />
            </li>
          );
        })}
      </ul>

      {!busy && shown.length === 0 && <p className="sub">Aucun mod ne correspond.</p>}
    </main>
  );
}
