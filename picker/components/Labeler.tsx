"use client";

import { useState } from "react";
import { CATEGORIES, type CategoryId, type ModLabel } from "@/lib/labels";

// Les etiquettes d'un mod, cliquables. Le meme composant sert dans la liste et
// sur la fiche : le classement doit pouvoir se faire d'un coup d'oeil sur la
// liste, sans ouvrir chaque mod, et se corriger une fois le mod ouvert.
//
// L'enregistrement part au clic, sans bouton « valider » : un tri qu'il faut
// penser a sauvegarder est un tri qu'on perd.
export function Labeler({
  packageId, label, onChange, compact = false,
}: {
  packageId: string;
  label: ModLabel;
  onChange: (packageId: string, label: ModLabel) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const send = (patch: { categories?: CategoryId[]; reviewed?: boolean }) => {
    // Affichage optimiste : le disque repondra, mais la couleur ne doit pas
    // attendre l'aller-retour.
    onChange(packageId, {
      categories: patch.categories ?? label.categories,
      reviewed: patch.reviewed ?? label.reviewed,
      updated: new Date().toISOString(),
    });
    setBusy(true);
    fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, ...patch }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.label) onChange(packageId, d.label); })
      .finally(() => setBusy(false));
  };

  const toggle = (id: CategoryId) => {
    const has = label.categories.includes(id);
    send({ categories: has ? label.categories.filter((c) => c !== id) : [...label.categories, id] });
  };

  return (
    <div className={`labeler${compact ? " compact" : ""}${busy ? " busy" : ""}`}>
      <button
        type="button"
        className={`chip check${label.reviewed ? " on" : ""}`}
        onClick={() => send({ reviewed: !label.reviewed })}
        title={label.reviewed ? "trie — cliquer pour remettre a trier" : "marquer comme trie"}
      >
        {label.reviewed ? "✓ trie" : "a trier"}
      </button>
      {CATEGORIES.map((c) => {
        const on = label.categories.includes(c.id);
        return (
          <button
            type="button"
            key={c.id}
            data-cat={c.id}
            className={`chip${on ? " on" : ""}`}
            onClick={() => toggle(c.id)}
            title={on ? `retirer « ${c.label} »` : `classer en « ${c.label} »`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
