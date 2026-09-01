"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export default function Home() {
  const [scope, setScope] = useState<"active" | "all">("active");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ModRow[]>([]);
  const [counts, setCounts] = useState({ total: 0, matched: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <span className="tally">
          {busy
            ? "lecture..."
            : `${counts.matched} sur ${counts.total}${
                counts.matched > rows.length ? ` — ${rows.length} affiches` : ""
              }`}
        </span>
      </div>

      {error && <p className="err">{error}</p>}

      <ul className="mods">
        {rows.map((m) => (
          <li key={m.PackageId}>
            <Link
              href={`/mod/${encodeURIComponent(m.PackageId)}?path=${encodeURIComponent(m.Path)}`}
            >
              <span className="name">{m.Name || m.PackageId}</span>
              <span className="pid">{m.PackageId}</span>
              <span className="tags">
                {m.Active && <em className="tag act">actif</em>}
                <em className="tag">{m.Source}</em>
                {m.SupportedVersions.length > 0 && (
                  <em className="tag">{m.SupportedVersions.join(" ")}</em>
                )}
                {m.DeadBefore16 && <em className="tag dead">mort avant 1.6</em>}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {!busy && rows.length === 0 && <p className="sub">Aucun mod ne correspond.</p>}
    </main>
  );
}
