import path from "node:path";
import fs from "node:fs/promises";
import type { CategoryId, LabelStore, ModLabel } from "./labels";
import { CATEGORIES } from "./labels";

// Le classement d'une modlist se fait sur des semaines, mod par mod. Il ne peut
// donc pas vivre dans le navigateur : un vidage de cache effacerait le tri, et
// il ne suivrait pas d'une machine a l'autre. Il vit dans le depot, en clair, et
// se relit sans l'outil.
const FILE = path.resolve(process.cwd(), "..", "data", "mod-labels.json");

const KNOWN = new Set<string>(CATEGORIES.map((c) => c.id));

export async function readStore(): Promise<LabelStore> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.mods) return { version: 1, mods: raw.mods };
  } catch {
    // fichier absent au premier lancement, ou illisible : on repart d'un tri vide
    // plutot que de refuser de servir la page.
  }
  return { version: 1, mods: {} };
}

// Une ecriture relit toujours le fichier juste avant : deux onglets ouverts sur
// la liste, et un enregistrement fait a partir d'un etat perime effacerait le
// classement fait dans l'autre.
//
// Les ecritures sont serialisees par cette chaine de promesses. Elles sont rares
// — un clic humain — mais deux clics rapproches suffiraient a en perdre un.
let queue: Promise<unknown> = Promise.resolve();

export function writeLabel(
  packageId: string,
  patch: { categories?: CategoryId[]; reviewed?: boolean },
): Promise<ModLabel> {
  const task = queue.then(async () => {
    const store = await readStore();
    const cur: ModLabel = store.mods[packageId] ?? { categories: [], reviewed: false, updated: "" };

    const categories = patch.categories
      ? [...new Set(patch.categories.filter((c) => KNOWN.has(c)))]
      : cur.categories;
    // Poser une categorie, c'est avoir regarde le mod : le tri en decoule, il ne
    // se declare pas separement. La regle est ici et pas dans l'interface — la
    // liste et la fiche d'un mod la liraient chacune a sa facon, et finiraient par
    // diverger.
    //
    // Consequence assumee : on ne peut pas dire « etiquete mais pas encore trie ».
    // Pour remettre un mod a trier, on retire ses etiquettes.
    const reviewed = (patch.reviewed ?? cur.reviewed) || categories.length > 0;

    const next: ModLabel = { categories, reviewed, updated: new Date().toISOString() };

    // Un mod sans etiquette et non trie n'a rien a faire dans le fichier : le
    // garder ferait grossir le tri d'entrees vides a chaque clic annule.
    if (categories.length === 0 && !reviewed) delete store.mods[packageId];
    else store.mods[packageId] = next;

    await fs.mkdir(path.dirname(FILE), { recursive: true });
    // Ecriture atomique : une coupure au milieu laisserait un JSON tronque, donc
    // tout le classement illisible au prochain demarrage.
    const tmp = `${FILE}.${process.pid}.tmp`;
    const ordered = Object.fromEntries(Object.entries(store.mods).sort(([a], [b]) => a.localeCompare(b)));
    await fs.writeFile(tmp, JSON.stringify({ version: 1, mods: ordered }, null, 2), "utf8");
    await fs.rename(tmp, FILE);

    return next;
  });
  queue = task.catch(() => {});
  return task;
}
