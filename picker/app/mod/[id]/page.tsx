"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Def = {
  Key: string;
  DefType: string;
  DefName: string | null;
  AbstractName: string | null;
  IsAbstract: boolean;
  Label: string | null;
  ParentName: string | null;
  TechLevel: string | null;
  TechLevelFrom: string | null;
  ArchitectCategory: string | null;
  ArchitectCategoryFrom: string | null;
  File: string;
  MayRequire: string[];
  TextureFiles: string[];
  MissingTextures: string[];
  Refs: { Defs: string[]; Classes: string[]; Textures: string[]; Sounds: string[]; Research: string[] };
};

type Inventory = {
  Mods: {
    Id: string; Name: string; PackageId: string; Path: string;
    SupportedVersions: string[]; DeclaredDependencies: string[]; DeadBefore16: boolean;
  }[];
  Defs: Def[];
  Patches: { File: string; TargetDefs: string[]; GuardedByMods: string[] }[];
  Problems: string[];
};

const thumb = (d: Def) =>
  d.TextureFiles.find((f) => f.toLowerCase().endsWith("_south.png")) ??
  d.TextureFiles.find((f) => !f.split(/[\\/]/).pop()!.includes("_")) ??
  d.TextureFiles[0];

export default function ModPage({
  params,
  searchParams,
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
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!modPath) { setError("chemin du mod manquant"); return; }
    fetch(`/api/scan?id=${encodeURIComponent(id)}&path=${encodeURIComponent(modPath)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? Promise.reject(new Error(d.error)) : setInv(d)))
      .catch((e) => setError(String(e)));
  }, [id, modPath]);

  const mod = inv?.Mods?.[0];

  const types = useMemo(
    () => [...new Set(inv?.Defs.map((d) => d.DefType) ?? [])].sort(),
    [inv],
  );
  const techs = useMemo(
    () => [...new Set((inv?.Defs ?? []).map((d) => d.TechLevel).filter(Boolean) as string[])].sort(),
    [inv],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (inv?.Defs ?? []).filter((d) => {
      if (hideAbstract && d.IsAbstract) return false;
      if (type && d.DefType !== type) return false;
      if (tech && d.TechLevel !== tech) return false;
      if (!needle) return true;
      return [d.Label, d.DefName, d.DefType, d.ArchitectCategory, d.Refs.Research.join(" ")]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [inv, q, type, tech, hideAbstract]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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
          {mod.DeadBefore16 && <em className="tag dead">mort avant 1.6</em>}
        </p>
        {mod.DeclaredDependencies.length > 0 && (
          <p className="sub">dependances declarees : {mod.DeclaredDependencies.join(", ")}</p>
        )}
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
        <span className="tally">{shown.length} / {inv.Defs.length} defs — {picked.size} cochees</span>
      </div>

      <table className="defs">
        <tbody>
          {shown.map((d) => {
            const t = thumb(d);
            return (
              <tr key={d.Key}>
                <td className="cb">
                  <input type="checkbox" checked={picked.has(d.Key)} onChange={() => toggle(d.Key)} />
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
                  <div className="name">{d.Label || d.DefName}</div>
                  <div className="sub">
                    {d.DefName}
                    {d.ParentName && <> &lt; {d.ParentName}</>}
                  </div>
                  {d.MissingTextures.length > 0 && (
                    <div className="miss">texture introuvable : {d.MissingTextures.join(", ")}</div>
                  )}
                </td>
                <td className="col">{d.DefType}</td>
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
                <td className="col">{d.Refs.Research.join(", ")}</td>
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
