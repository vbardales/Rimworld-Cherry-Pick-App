import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import { isUnderAllowedRoot } from "@/lib/cherrypick";

// Serves a texture from disk.
//
// Indispensable: from an http://localhost page, every browser blocks
// <img src="file:///...">. And the path guard is not decorative — without it this
// route would read any file on the machine for whoever can talk to localhost.
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
