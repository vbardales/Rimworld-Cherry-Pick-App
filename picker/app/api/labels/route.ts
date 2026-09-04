import { NextRequest, NextResponse } from "next/server";
import { readStore, writeLabel } from "@/lib/labelStore";
import type { CategoryId } from "@/lib/labels";

export async function GET() {
  try {
    return NextResponse.json(await readStore());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = String(body?.packageId ?? "").trim();
    if (!packageId) return NextResponse.json({ error: "packageId manquant" }, { status: 400 });

    const patch: { categories?: CategoryId[]; reviewed?: boolean } = {};
    if (Array.isArray(body.categories)) patch.categories = body.categories.map(String) as CategoryId[];
    if (typeof body.reviewed === "boolean") patch.reviewed = body.reviewed;

    return NextResponse.json({ packageId, label: await writeLabel(packageId, patch) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
