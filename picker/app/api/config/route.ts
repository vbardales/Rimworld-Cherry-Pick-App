import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

// Where a cherry-pick configuration is filed.
//
// The browser can only offer a download, which lands in the downloads folder and
// has to be moved by hand — and a config that lives beside the day's screenshots
// is a config that will not be replayed. It belongs in the repository, next to
// the classification, because it is the same kind of thing: a decision worth
// keeping and worth seeing change in a diff.
const DIR = path.resolve(process.cwd(), "..", "data", "configs");

export async function GET() {
  try {
    const files = await fs.readdir(DIR).catch(() => []);
    return NextResponse.json({ dir: DIR, files: files.filter((f) => f.endsWith(".json")).sort() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.source?.packageId ?? "").trim();

    // The packageId names the file, so it may not escape the folder: a dot or a
    // slash in it would write anywhere on disk.
    if (!/^[A-Za-z0-9._-]+$/.test(packageId) || packageId.includes(".."))
      return NextResponse.json({ error: "packageId absent ou inutilisable" }, { status: 400 });

    await fs.mkdir(DIR, { recursive: true });
    const file = path.join(DIR, `cherrypick-${packageId}.json`);
    await fs.writeFile(file, JSON.stringify(body, null, 2), "utf8");

    return NextResponse.json({ file, name: path.basename(file) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
