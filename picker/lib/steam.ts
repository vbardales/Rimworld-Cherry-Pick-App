// Finds a mod's Steam page from its path on disk.
//
// Steam files every subscription in a folder named after the page's id:
// .../workshop/content/294100/<id>. The id is therefore written nowhere inside
// the mod — not in About.xml, not in the packageId — but it is always there, in
// the path.
//
// 294100 is RimWorld's app id on Steam; checking it avoids building a link out of
// a folder that merely looks similar.

// Paths arrive in Windows notation. We split on both separators without writing a
// literal backslash: through the layers of quoting that lead here, an escaped
// backslash gets lost silently, and the regex then splits on forward slashes only
// — so no mod has a page any more.
const SEPARATORS = ["/", String.fromCharCode(92)];

function segments(modPath: string): string[] {
  let parts = [modPath];
  for (const sep of SEPARATORS) parts = parts.flatMap((p) => p.split(sep));
  return parts.filter(Boolean);
}

export function workshopId(modPath: string | undefined): string | null {
  if (!modPath) return null;
  const parts = segments(modPath);
  const last = parts[parts.length - 1];
  if (!/^\d+$/.test(last ?? "")) return null;
  return parts.includes("294100") ? last : null;
}

export function workshopUrl(modPath: string | undefined): string | null {
  const id = workshopId(modPath);
  return id ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` : null;
}
