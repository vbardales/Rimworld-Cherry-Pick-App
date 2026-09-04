import type { Metadata } from "next";
import "./globals.css";

// No remote font: the tool has to start with no network, since all it does is
// read local files.
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
