import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { isUnderAllowedRoot } from "@/lib/cherrypick";

// Sert une texture depuis le disque.
//
// Indispensable : depuis une page http://localhost, tous les navigateurs
// bloquent <img src="file:///...">. Et le garde-fou de chemin n'est pas
// decoratif — sans lui, cette route lirait n'importe quel fichier de la machine
// pour quiconque parle a localhost.
export async function GET(req: NextRequest) {
  const f = req.nextUrl.searchParams.get("f");
  if (!f) return new Response("f est requis", { status: 400 });
  if (!f.toLowerCase().endsWith(".png")) return new Response("png uniquement", { status: 403 });
  if (!isUnderAllowedRoot(f)) return new Response("chemin hors des racines de mods", { status: 403 });

  try {
    const buf = await fs.readFile(f);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("introuvable", { status: 404 });
  }
}
