"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Labeler } from "@/components/Labeler";
import { EMPTY, type ModLabel } from "@/lib/labels";
import { workshopId, workshopUrl } from "@/lib/steam";

type Def = {
  Key: string;
  DefType: string;
  DefName: string | null;
  AbstractName: string | null;
  IsAbstract: boolean;
  Label: string | null;
  ParentName: string | null;
  // Optional: an inventory cached before the engine computed it has none, and the
  // sheet must stay readable without forcing a re-read.
  ParentChain?: { Name: string; Origin: string }[];
  TechLevel: string | null;
  TechLevelFrom: string | null;
  ArchitectCategory: string | null;
  ArchitectCategoryFrom: string | null;
  GroupKey: string | null;
  OverridesVanilla: boolean;
  TextureFiles: string[];
  MissingTextures: string[];
  Refs: { Research: string[]; Classes: string[] };
};

type Inventory = {
  Mods: {
    Name: string; PackageId: string; Path: string;
    SupportedVersions: string[]; DeclaredDependencies: string[]; DeadBefore16: boolean;
  }[];
  Defs: Def[];
  OverrideCount: number;
  Problems: string[];
};

type Closure = {
  Kept: number; Excluded: number; Undetermined: number;
  Conflicts: { Needed: string; NeededBy: string; Reason: string }[];
  Unresolved: string[];
  OrphanPatches: { File: string; TargetDefs: string[] }[];
  Dependencies: { PackageId: string; StillNeeded: boolean; Because: string[] }[];
};

// Undetermined counts as taken: we carve into an existing mod, we do not rebuild
// it piece by piece.
type State = "in" | "out";

type Group = { key: string; anchor: Def; members: Def[]; overrides: boolean };

const thumbOf = (defs: Def[]) => {
  const files = defs.flatMap((d) => d.TextureFiles);
  return (
    files.find((f) => f.toLowerCase().endsWith("_south.png")) ??
    files.find((f) => !f.split(/[\\/]/).pop()!.includes("_")) ??
    files[0]
  );
};

export default function ModPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { id } = use(params);
  const { path: modPath } = use(searchParams);

  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [tech, setTech] = useState("");
  const [hideAbstract, setHideAbstract] = useState(true);
  const [states, setStates] = useState<Map<string, State>>(new Map());
  const [closure, setClosure] = useState<Closure | null>(null);
  const [computing, setComputing] = useState(false);

  const [rescanning, setRescanning] = useState(false);
  const [label, setLabel] = useState<ModLabel>(EMPTY);

  // Read the mod again from its files.
  //
  // The inventory is cached and revalidated against the mod FOLDER's date, but
  // changing a file in a subfolder does not always change it. Without this button,
  // one can work for a long time on a stale inventory without noticing.
  const load = useCallback((refresh: boolean) => {
    if (!modPath) { setError("chemin du mod manquant"); return; }
    setRescanning(refresh);
    setError(null);
    const url = `/api/scan?id=${encodeURIComponent(id)}&path=${encodeURIComponent(modPath)}`
      + (refresh ? "&refresh=1" : "");
    fetch(url)
      .then((r) => r.json())
      .then((d) => (d.error ? Promise.reject(new Error(d.error)) : setInv(d)))
      .catch((e) => setError(String(e)))
      .finally(() => setRescanning(false));
  }, [id, modPath]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    fetch("/api/labels")
      .then((r) => r.json())
      .then((d) => setLabel(d.mods?.[id] ?? EMPTY))
      .catch(() => { /* an unreadable classification must not block the sheet */ });
  }, [id]);

  const mod = inv?.Mods?.[0];

  // One entry per group: defs describing one same thing must not be decidable
  // separately.
  const groups = useMemo<Group[]>(() => {
    if (!inv) return [];
    const byGroup = new Map<string, Def[]>();
    for (const d of inv.Defs) {
      const k = d.GroupKey ?? d.Key;
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k)!.push(d);
    }
    return [...byGroup].map(([key, members]) => ({
      key,
      anchor: members.find((m) => m.Key === key) ?? members[0],
      members,
      overrides: members.some((m) => m.OverridesVanilla),
    }));
  }, [inv]);

  const types = useMemo(() => [...new Set(inv?.Defs.map((d) => d.DefType) ?? [])].sort(), [inv]);
  const techs = useMemo(
    () => [...new Set((inv?.Defs ?? []).map((d) => d.TechLevel).filter(Boolean) as string[])].sort(), [inv]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups.filter((g) => {
      if (hideAbstract && g.members.every((m) => m.IsAbstract)) return false;
      if (type && !g.members.some((m) => m.DefType === type)) return false;
      if (tech && g.anchor.TechLevel !== tech) return false;
      if (!needle) return true;
      return g.members
        .flatMap((m) => [m.Label, m.DefName, m.DefType, m.ArchitectCategory, m.Refs.Research.join(" ")])
        .join(" ").toLowerCase().includes(needle);
    });
  }, [groups, q, type, tech, hideAbstract]);

  const cycle = (key: string) =>
    setStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(key);
      if (cur === undefined) next.set(key, "in");
      else if (cur === "in") next.set(key, "out");
      else next.delete(key);
      return next;
    });

  // Marking in bulk. "Take everything" does not mean the same as a mod left
  // undetermined: the result is identical, but one is a decision and the other the
  // absence of one. That is what tells a full port from an unfinished cherry-pick.
  const setAll = (targets: Group[], value: State | null) =>
    setStates((prev) => {
      const next = new Map(prev);
      for (const g of targets) {
        if (value === null) next.delete(g.key);
        else next.set(g.key, value);
      }
      return next;
    });

  const filtered = shown.length !== groups.length;

  // A selection is PARTIAL as soon as one entry is dropped, or some undetermined
  // remains after we started deciding.
  //
  // The distinction carries the output: taking the whole mod is a port, and the
  // result is the mod itself. Taking only part of it is a cherry-pick, and the
  // result is a CONFIGURATION — replayed when the source mod moves, instead of a
  // snapshot that would have to be redone by hand.
  const partial =
    groups.length > 0 &&
    (states.size < groups.length || [...states.values()].some((s) => s === "out"));

  const exportConfig = () => {
    if (!mod) return;
    const config = {
      version: 1,
      mode: partial ? "cherry-pick" : "portage integral",
      source: {
        packageId: mod.PackageId,
        name: mod.Name,
        path: mod.Path,
        supportedVersions: mod.SupportedVersions,
        deadBefore16: mod.DeadBefore16,
        declaredDependencies: mod.DeclaredDependencies,
      },
      // Explicit states only. Undetermined is not written down: it is the default,
      // and freezing it here would make the config lie the day the source mod gains
      // new defs.
      states: Object.fromEntries(
        [...states].flatMap(([groupKey, s]) => {
          const g = groups.find((x) => x.key === groupKey);
          return g ? g.members.map((m) => [m.Key, s] as const) : [];
        }),
      ),
      // Snapshot of the diagnosis at export time, for later reading. It is
      // recomputed every time the config is replayed.
      diagnostic: closure && {
        embarquees: closure.Kept,
        ecartees: closure.Excluded,
        indeterminees: closure.Undetermined,
        conflits: closure.Conflicts.length,
        dependancesInutiles: closure.Dependencies.filter((d) => !d.StillNeeded).map((d) => d.PackageId),
        patchsOrphelins: closure.OrphanPatches.map((p) => p.File),
        referencesNonResolues: closure.Unresolved,
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cherrypick-${mod.PackageId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // The closure costs a call to the engine: it is computed after a pause, not on
  // every click.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recompute = useCallback(() => {
    if (!modPath || !inv) return;
    const picked: string[] = [];
    const excluded: string[] = [];
    for (const g of groups) {
      const s = states.get(g.key);
      if (!s) continue;
      for (const m of g.members) (s === "in" ? picked : excluded).push(m.Key);
    }
    setComputing(true);
    fetch("/api/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: modPath, picked, excluded }),
    })
      .then((r) => r.json())
      .then((d) => (d.error ? Promise.reject(new Error(d.error)) : setClosure(d)))
      .catch((e) => setError(String(e)))
      .finally(() => setComputing(false));
  }, [modPath, inv, groups, states]);

  useEffect(() => {
    if (!inv) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(recompute, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [inv, states, recompute]);

  if (error) return <main className="wrap"><p className="err">{error}</p><Link href="/">retour</Link></main>;
  if (!inv || !mod) return <main className="wrap"><p className="sub">lecture du mod...</p></main>;

  return (
    <main className="wrap">
      <header>
        <Link href="/" className="back">retour</Link>
        <h1>{mod.Name || mod.PackageId}</h1>
        <p className="sub">
          <em className="tag">{mod.PackageId}</em>
          {mod.SupportedVersions.length > 0 && <em className="tag">{mod.SupportedVersions.join(" ")}</em>}
          {mod.DeadBefore16 && !label.works16 && <em className="tag dead">mort avant 1.6</em>}
          {mod.DeadBefore16 && label.works16 && <em className="tag act">tourne en 1.6</em>}
          {inv.OverrideCount > 0 && (
            <em className="tag over">{inv.OverrideCount} def(s) remplacent le jeu</em>
          )}
          {workshopUrl(mod.Path) && (
            <a className="tag link" href={workshopUrl(mod.Path)!} target="_blank" rel="noreferrer noopener">
              🔍 Steam Workshop {workshopId(mod.Path)}
            </a>
          )}
        </p>
        {mod.DeclaredDependencies.length > 0 && (
          <p className="sub">dependances declarees : {mod.DeclaredDependencies.join(", ")}</p>
        )}
        <Labeler
          packageId={mod.PackageId}
          label={label}
          onChange={(_, l) => setLabel(l)}
          dead={mod.DeadBefore16}
        />
      </header>

      <div className="bar">
        <input type="search" placeholder="filtrer..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">tous les types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={tech} onChange={(e) => setTech(e.target.value)}>
          <option value="">tous les niveaux</option>
          {techs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="chk">
          <input type="checkbox" checked={hideAbstract} onChange={(e) => setHideAbstract(e.target.checked)} />
          masquer les abstraites
        </label>
        <span className="tally">
          {shown.length} / {groups.length} entrees — {states.size} marquees
        </span>
      </div>

      <div className="bar bulk">
        <button onClick={() => load(true)} disabled={rescanning}>
          {rescanning ? "relecture..." : "reetudier le mod"}
        </button>
        <button onClick={exportConfig} disabled={!closure}>
          exporter la conf{partial ? "" : " (mod entier)"}
        </button>
        <span className="sep">|</span>
        <span className="sub">le mod entier :</span>
        <button onClick={() => setAll(groups, "in")}>
          tout embarquer ({groups.length})
        </button>
        <button onClick={() => setAll(groups, "out")}>tout ecarter</button>
        <button onClick={() => setAll(groups, null)}>remettre a indetermine</button>
        {filtered && (
          <>
            <span className="sep">|</span>
            <span className="sub">le filtre courant :</span>
            <button onClick={() => setAll(shown, "in")}>embarquer ({shown.length})</button>
            <button onClick={() => setAll(shown, "out")}>ecarter</button>
          </>
        )}
      </div>

      {closure && <ClosurePanel c={closure} computing={computing} />}

      <table className="defs">
        <tbody>
          {shown.map((g) => {
            const d = g.anchor;
            const st = states.get(g.key);
            const t = thumbOf(g.members);
            const missing = g.members.flatMap((m) => m.MissingTextures);
            return (
              <tr key={g.key} className={st === "out" ? "row-out" : st === "in" ? "row-in" : ""}>
                <td className="cb">
                  <button
                    className={`tri ${st ?? "undef"}`}
                    onClick={() => cycle(g.key)}
                    title={
                      st === "in" ? "embarque"
                        : st === "out" ? "non-embarque"
                        : "indetermine — donc embarque"
                    }
                  >
                    {st === "in" ? "✓" : st === "out" ? "✕" : "·"}
                  </button>
                </td>
                <td className="pic">
                  {t ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/texture?f=${encodeURIComponent(t)}`} alt="" loading="lazy" />
                  ) : (
                    <span className="noimg" />
                  )}
                </td>
                <td>
                  <div className="name">
                    {d.Label || d.DefName || d.AbstractName}
                    {g.overrides && <em className="tag over">remplace le jeu</em>}
                  </div>
                  <div className="sub">
                    {d.DefName ?? `Name=${d.AbstractName}`}
                    <Chain d={d} />
                  </div>
                  {missing.length > 0 && (
                    <div className="miss">texture introuvable : {missing.join(", ")}</div>
                  )}
                </td>
                <td className="col">
                  {g.members.map((m) => (
                    <em key={m.Key} className="tag small">{m.DefType.replace("AlienRace.", "")}</em>
                  ))}
                </td>
                <td className="col">
                  {d.TechLevel && (
                    <>
                      <span className={d.TechLevelFrom ? "inh" : ""}>{d.TechLevel}</span>
                      {d.TechLevelFrom && <div className="sub">&lt; {d.TechLevelFrom}</div>}
                    </>
                  )}
                </td>
                <td className="col">
                  {d.ArchitectCategory && (
                    <>
                      <span className={d.ArchitectCategoryFrom ? "inh" : ""}>{d.ArchitectCategory}</span>
                      {d.ArchitectCategoryFrom && <div className="sub">&lt; {d.ArchitectCategoryFrom}</div>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {inv.Problems.length > 0 && (
        <>
          <h2>problemes de lecture</h2>
          <pre>{inv.Problems.join("\n")}</pre>
        </>
      )}
    </main>
  );
}

// A def's inheritance chain, all the way to its root.
//
// A mod def declares almost nothing: "BioForge" is ten tags long, and all the
// rest — cost, size, stats, category — comes from BuildingBase. Showing only the
// immediate parent suggested a short chain; showing the whole of it says where to
// go looking for what is not displayed.
//
// A link marked "missing" is the interesting case: the parent is named but
// nowhere to be found, hence defined in a dependency we did not scan. It is
// always the explanation for an empty tech level or category.
function Chain({ d }: { d: Def }) {
  const chain = d.ParentChain ?? (d.ParentName ? [{ Name: d.ParentName, Origin: "" }] : []);
  if (chain.length === 0) return null;
  return (
    <span className="chain">
      {chain.map((p, i) => (
        <span key={i}>
          {" < "}
          <span
            className={p.Origin === "missing" ? "gone" : p.Origin === "game" ? "core" : ""}
            title={
              p.Origin === "game" ? "base du jeu"
                : p.Origin === "missing" ? "parent introuvable — defini dans une dependance non scannee"
                : "base declaree dans ce mod"
            }
          >
            {p.Name}
          </span>
        </span>
      ))}
    </span>
  );
}

function ClosurePanel({ c, computing }: { c: Closure; computing: boolean }) {
  return (
    <section className={`panel${computing ? " busy" : ""}`}>
      <div className="counts">
        <b>{c.Kept}</b> embarquees <span className="sep">·</span>{" "}
        <b>{c.Excluded}</b> ecartees <span className="sep">·</span>{" "}
        <b>{c.Undetermined}</b> indeterminees
        {computing && <span className="sub"> — calcul en cours</span>}
      </div>

      {c.Conflicts.length > 0 && (
        <div className="block bad">
          <h3>{c.Conflicts.length} conflit(s)</h3>
          <p className="sub">Une def gardee reclame une def ecartee : chacune est une erreur au chargement.</p>
          <ul>
            {c.Conflicts.slice(0, 12).map((k, i) => (
              <li key={i}><b>{k.Needed}</b> reclame par {k.NeededBy} <span className="sub">({k.Reason})</span></li>
            ))}
          </ul>
        </div>
      )}

      {c.Dependencies.length > 0 && (
        <div className="block">
          <h3>dependances</h3>
          <ul>
            {c.Dependencies.map((d) => (
              <li key={d.PackageId}>
                {d.StillNeeded ? "conservee — " : "inutile — "}
                <b>{d.PackageId}</b>{" "}
                <span className="sub">
                  {d.StillNeeded
                    ? `(${d.Because.length} classe(s))`
                    : "plus aucune classe retenue ne lui appartient"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.OrphanPatches.length > 0 && (
        <div className="block bad">
          <h3>{c.OrphanPatches.length} patch(s) orphelin(s)</h3>
          <ul>
            {c.OrphanPatches.map((p) => (
              <li key={p.File}>{p.File} <span className="sub">visait {p.TargetDefs.join(", ")}</span></li>
            ))}
          </ul>
        </div>
      )}

      {c.Unresolved.length > 0 && (
        <div className="block">
          <h3>{c.Unresolved.length} reference(s) non resolue(s)</h3>
          <p className="sub">Ni dans le mod, ni dans le jeu : dependance manquante, ou coquille.</p>
          <p className="mono">{c.Unresolved.slice(0, 30).join(", ")}</p>
        </div>
      )}
    </section>
  );
}
