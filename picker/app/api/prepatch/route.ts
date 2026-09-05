import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { GAME_DIR } from "@/lib/cherrypick";
import { ecrire, dossierDe, fichierDe, MOD_DIR, PACKAGE_ID } from "@/lib/prepatch";

// Le mod genere qui retire des defs avant qu'elles n'existent.
//
// L'autre sortie de l'outil, a cote de /api/cherrypicker. Les deux disent la meme
// chose et le disent a des moments differents : Cherry Picker retire une def batie,
// celui-ci retire un noeud XML avant que le jeu ne la batisse. Ni l'un ni l'autre
// ne touche au mod source.
//
// Contrairement au fichier de Cherry Picker, qui est unique et commun a tous les
// mods, ici chaque mod trie a son propre fichier sous Patches/. Aucune fusion,
// aucune notion de « perimetre » : reprendre un mod ne peut pas effacer le tri
// d'un autre.

// Ce qui est deja pose, mod par mod.
export async function GET() {
  const dossier = dossierDe(GAME_DIR);
  try {
    const noms = await fs.readdir(path.join(dossier, "Patches"));
    const fichiers = await Promise.all(
      noms.filter((n) => n.endsWith(".xml")).map(async (n) => {
        const t = await fs.readFile(path.join(dossier, "Patches", n), "utf8");
        return { fichier: n, defs: (t.match(/defName="/g) ?? []).length };
      }),
    );
    return NextResponse.json({ dossier, packageId: PACKAGE_ID, fichiers });
  } catch {
    // Rien d'ecrit encore : ce n'est pas une panne, c'est l'etat de depart.
    return NextResponse.json({ dossier, packageId: PACKAGE_ID, fichiers: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    const name = String(body?.name ?? packageId).trim();
    if (!packageId) {
      return NextResponse.json({ error: "packageId manquant" }, { status: 400 });
    }
    const removals = Array.isArray(body?.removals)
      ? body.removals
          .map((r: unknown) => r as { defType?: unknown; defName?: unknown })
          .filter((r: { defType?: unknown; defName?: unknown }) =>
            typeof r.defType === "string" && typeof r.defName === "string")
          .map((r: { defType?: unknown; defName?: unknown }) =>
            ({ defType: String(r.defType), defName: String(r.defName) }))
      : [];

    const res = await ecrire(GAME_DIR, { packageId, name }, removals);

    // Le mod doit charger en dernier pour que les patchs des autres aient deja
    // reussi. On ne touche pas a ModsConfig.xml pour autant : c'est le fichier que
    // le jeu reecrit en quittant, et l'ecraser pendant qu'il tourne perd une
    // partie. On dit ou en est le mod, elle place la ligne.
    const actif = await estActif(packageId);

    return NextResponse.json({
      dossier: res.dossier,
      fichier: path.basename(res.fichier),
      ecrites: res.ecrites,
      // Un defName qu'on n'a pas ose ecrire dans un xpath. Toujours vide en
      // pratique, jamais silencieux si ca arrive.
      refuses: res.refuses,
      modDir: MOD_DIR,
      packageId: PACKAGE_ID,
      ...actif,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Le mod genere est-il dans la modlist, et en dernier ?
//
// Lecture seule : on ne modifie jamais ModsConfig.xml. RimWorld le garde en
// memoire et le reecrit en quittant, donc une ecriture faite pendant qu'il tourne
// est perdue — et c'est le fichier qui decide de ce qui se charge.
async function estActif(source: string): Promise<{ present: boolean; dernier: boolean; apres: number }> {
  try {
    const f = path.join(
      process.env.USERPROFILE ?? "",
      "AppData", "LocalLow", "Ludeon Studios",
      "RimWorld by Ludeon Studios", "Config", "ModsConfig.xml",
    );
    const xml = await fs.readFile(f, "utf8");
    const ids = [...xml.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].trim().toLowerCase());
    const i = ids.indexOf(PACKAGE_ID.toLowerCase());
    if (i < 0) return { present: false, dernier: false, apres: 0 };
    // Combien de mods se chargent APRES lui, en ne comptant que ceux dont les
    // patchs pourraient viser une def qu'il retire — c'est-a-dire tous.
    void source;
    return { present: true, dernier: i === ids.length - 1, apres: ids.length - 1 - i };
  } catch {
    return { present: false, dernier: false, apres: 0 };
  }
}

// Annuler le tri d'un mod : on efface son fichier, rien d'autre.
export async function DELETE(req: NextRequest) {
  const packageId = (req.nextUrl.searchParams.get("packageId") ?? "").trim();
  if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });
  const f = path.join(dossierDe(GAME_DIR), "Patches", fichierDe(packageId));
  try {
    await fs.rm(f, { force: true });
    return NextResponse.json({ efface: path.basename(f) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
