import type { Metadata } from "next";
import "./globals.css";

// Pas de police distante : l'outil doit demarrer sans reseau, puisqu'il ne sert
// qu'a lire des fichiers locaux.
export const metadata: Metadata = {
  title: "cherrypick",
  description: "Inspecter un mod RimWorld et choisir ce qu'on en garde.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
