import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { settingsFile, readKeys, render } from "@/lib/cherrypicker";

// Lit et ecrit la liste de Cherry Picker.
//
// C'est la seule route de l'outil qui touche a quelque chose que le JEU relit.
// Deux precautions qui vont avec :
//
//   - une sauvegarde datee avant chaque ecriture, parce que le fichier est global
//     et qu'on y ecrit le travail de plusieurs mods ;
//   - RimWorld doit etre ferme. Il garde ses reglages en memoire et les reecrit en
//     quittant : lancer le jeu, ecrire ici, puis quitter le jeu efface tout ce
//     qu'on vient de poser.
export async function GET() {
  const file = await settingsFile();
  if (!file) return NextResponse.json({ error: "Cherry Picker introuvable dans Config/" }, { status: 404 });
  try {
    return NextResponse.json({ file, keys: await readKeys(file) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const file = await settingsFile();
  if (!file) return NextResponse.json({ error: "Cherry Picker introuvable dans Config/" }, { status: 404 });

  try {
    const body = await req.json();
    const keys: string[] = Array.isArray(body?.keys) ? body.keys.map(String) : [];
    // Les cles de CE mod qui etaient posees a la passe precedente. Sans elles, une
    // entree qu'on vient de reprendre resterait retiree pour toujours : on ne peut
    // pas distinguer « plus voulue » de « posee par un autre mod ».
    const scope: string[] = Array.isArray(body?.scope) ? body.scope.map(String) : keys;

    const before = await readKeys(file);
    const others = before.filter((k) => !scope.includes(k));
    const after = [...new Set([...others, ...keys])].sort();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.${stamp}.bak`;
    await fs.copyFile(file, backup);
    await fs.writeFile(file, render(after), "utf8");

    return NextResponse.json({
      file,
      backup: path.basename(backup),
      avant: before.length,
      apres: after.length,
      ajoutees: keys.filter((k) => !before.includes(k)).length,
      retirees: before.filter((k) => scope.includes(k) && !keys.includes(k)).length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
