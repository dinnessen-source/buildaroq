import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase/server";
import crypto from "crypto";

const BUCKET = "billing-logos";
const MAX_BYTES = 2_000_000;

function inferExtFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  return "png";
}

export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("logo");

    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Geen bestand gekozen." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Logo moet een afbeelding zijn (png/jpg/webp)." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Logo is te groot (max 2MB)." }, { status: 400 });
    }

    // 1) haal huidige logo_path op (zodat we oude kunnen verwijderen)
    const { data: current, error: curErr } = await sb
      .from("billing_settings")
      .select("logo_path")
      .eq("user_id", user.id)
      .single();

    // Als record nog niet bestaat is single() soms error; dat is ok.
    const oldLogoPath =
      !curErr && current?.logo_path && typeof current.logo_path === "string"
        ? current.logo_path
        : null;

    // 2) maak nieuw uniek pad (ALTijd nieuw bestand)
    const ext = inferExtFromMime(file.type);
    const unique = crypto.randomUUID();
    const newLogoPath = `user-logos/${user.id}/${unique}.${ext}`;

    // 3) upload nieuw bestand (geen upsert)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(newLogoPath, buffer, {
        upsert: false,
        contentType: file.type,
      });

    if (upErr) {
      return NextResponse.json({ error: `Storage upload: ${upErr.message}` }, { status: 403 });
    }

    // 4) update DB naar nieuw pad
    const { data: saved, error: dbErr } = await sb
      .from("billing_settings")
      .upsert(
        {
          user_id: user.id,
          logo_path: newLogoPath,
        },
        { onConflict: "user_id" }
      )
      .select("logo_path")
      .single();

    if (dbErr) {
      return NextResponse.json({ error: `DB upsert: ${dbErr.message}` }, { status: 500 });
    }

    // 5) verwijder oude logo (optioneel, maar ik raad het aan)
    // Alleen verwijderen als het in onze folder staat (extra veiligheid)
    if (oldLogoPath && oldLogoPath.startsWith(`user-logos/${user.id}/`)) {
      await sb.storage.from(BUCKET).remove([oldLogoPath]);
    }

    return NextResponse.json({ ok: true, logo_path: saved?.logo_path ?? newLogoPath });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Onbekende fout" }, { status: 500 });
  }
}