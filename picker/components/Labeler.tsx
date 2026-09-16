"use client";

import { memo, useState } from "react";
import { CATEGORIES, type CategoryId, type ModLabel } from "@/lib/labels";

// A mod's labels, clickable. The same component serves the list and the mod
// sheet: sorting has to be doable at a glance from the list, without opening
// every mod, and correctable once a mod is open.
//
// Saving happens on the click, with no "apply" button: a classification you have
// to remember to save is one you lose.
// Memoise, et ce n'est pas une precaution de principe.
//
// Une ligne de la liste porte dix-sept puces, donc quatre-vingt-dix-neuf lignes
// en portent seize cent quatre-vingt-trois. Sans memoisation, le moindre
// changement d'etat de la page les redessine toutes : le compte a rebours
// d'une ligne qui part, une etiquette posee ailleurs, une lecture qui revient.
// Mesure avant : de 0,5 a 2 secondes par changement de filtre, alors que la
// reponse du serveur arrive en 60 ms.
//
// Les trois props qui comptent sont stables : packageId est une chaine,
// onChange vient d'un useCallback, et label est l'objet du magasin — une
// nouvelle identite n'apparait que pour le mod qu'on vient de modifier.
export const Labeler = memo(function Labeler({
  packageId, path, label, onChange, compact = false, dead = false,
}: {
  packageId: string;
  // The mod's folder, sent along on a category change only — never stored in
  // the label file itself, which stays keyed by packageId. It exists purely so
  // the server can find the same mod in RimSort's own database, which is keyed
  // by that folder path and knows nothing of packageId.
  path?: string;
  label: ModLabel;
  onChange: (packageId: string, label: ModLabel) => void;
  compact?: boolean;
  // The mod declares no version >= 1.6. Only such a mod deserves the button:
  // offering "works in 1.6" on a mod that already declares it teaches nothing.
  dead?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState<string | null>(null);

  const send = (patch: { categories?: CategoryId[]; works16?: boolean }) => {
    // Optimistic display: the disk will answer, but the colour must not wait for
    // the round trip.
    onChange(packageId, {
      categories: patch.categories ?? label.categories,
      works16: patch.works16 ?? label.works16,
      updated: new Date().toISOString(),
    });
    // Un enregistrement qui echoue doit se voir.
    //
    // Sans cette branche, l'affichage optimiste restait en place et l'echec ne
    // laissait aucune trace : l'etiquette semblait posee, le disque n'en savait
    // rien, et on s'en apercevait des heures plus tard en regardant la date du
    // fichier. On revient donc a l'etat d'avant le clic, et on le dit.
    const avant = label;
    setRate(null);
    setBusy(true);
    fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // path rides along only when categories move: that is the one case
      // RimSort's own colour needs to change.
      body: JSON.stringify({ packageId, ...patch, ...(patch.categories ? { path } : {}) }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (d.label) onChange(packageId, d.label);
      })
      .catch((e) => { onChange(packageId, avant); setRate(String(e.message ?? e)); })
      .finally(() => setBusy(false));
  };

  const toggle = (id: CategoryId) => {
    const has = label.categories.includes(id);
    send({ categories: has ? label.categories.filter((c) => c !== id) : [...label.categories, id] });
  };

  return (
    <div className={`labeler${compact ? " compact" : ""}${busy ? " busy" : ""}`}>
      {rate && (
        <span className="rate" title={`non enregistre : ${rate}`} onClick={() => setRate(null)}>
          non enregistre
        </span>
      )}
      {dead && (
        <button
          type="button"
          className={`chip v16${label.works16 ? " on" : ""}`}
          onClick={() => send({ works16: !label.works16 })}
          title={
            label.works16
              ? "verifie en 1.6 — cliquer pour retirer"
              : "le mod n'annonce pas la 1.6 : marquer qu'il y tourne quand meme"
          }
        >
          {label.works16 ? "✓ 1.6" : "1.6 ?"}
        </button>
      )}
      {CATEGORIES.map((c) => {
        const on = label.categories.includes(c.id);
        return (
          <button
            type="button"
            key={c.id}
            data-cat={c.id}
            className={`chip${on ? " on" : ""}`}
            onClick={() => toggle(c.id)}
            title={
              (on ? `retirer « ${c.label} »` : `classer en « ${c.label} »`)
              + (c.hint ? ` — ${c.hint}` : "")
            }
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
});
