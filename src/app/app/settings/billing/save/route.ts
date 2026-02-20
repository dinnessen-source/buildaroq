import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";


const LOGO_BUCKET = "billing-logos";

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function inferExtFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/svg+xml") return "svg";
  return "png";
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const userId = user.id;

  const formData = await req.formData();

  // oude logo_path
  const { data: existingBs } = await sb
    .from("billing_settings")
    .select("logo_path")
    .eq("user_id", userId)
    .maybeSingle();

  const oldLogoPath = existingBs?.logo_path ?? null;

  // ✅ remove_logo support
  const removeLogo = String(formData.get("remove_logo") ?? "") === "1";

  // profile velden
  const company_name = String(formData.get("company_name") || "").trim();
  const company_email = String(formData.get("company_email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;

  const address_line1 = String(formData.get("address_line1") || "").trim() || null;
  const address_line2 = String(formData.get("address_line2") || "").trim() || null;
  const postal_code = String(formData.get("postal_code") || "").trim() || null;
  const city = String(formData.get("city") || "").trim() || null;
  const country = String(formData.get("country") || "").trim() || "NL";

  const vat_number = String(formData.get("vat_number") || "").trim() || null;
  const chamber_of_commerce = String(formData.get("chamber_of_commerce") || "").trim() || null;

  // billing velden
  const currency = String(formData.get("currency") || "EUR").trim() || "EUR";
  const default_vat_rate = toNumber(formData.get("default_vat_rate"));
  const payment_terms_days = Number(formData.get("payment_terms_days") ?? 14);

  const quote_footer = String(formData.get("quote_footer") || "").trim() || null;
  const invoice_footer = String(formData.get("invoice_footer") || "").trim() || null;
  const iban = String(formData.get("iban") || "").trim() || null;

  // 1) profile upsert
  const { error: pErr } = await sb.from("profiles").upsert(
    {
      id: userId,
      company_name: company_name || null,
      company_email,
      phone,
      address_line1,
      address_line2,
      postal_code,
      city,
      country,
      vat_number,
      chamber_of_commerce,
    },
    { onConflict: "id" }
  );
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  // 2) upload logo (optioneel)
  let newLogoPath: string | null = null;

  if (!removeLogo) {
    const file = formData.get("logo");

    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Logo moet een afbeelding zijn (png/jpg/webp/svg)." }, { status: 400 });
      }
      if (file.size > 2_000_000) {
        return NextResponse.json({ error: "Logo is te groot (max 2MB)." }, { status: 400 });
      }

      const ext = inferExtFromMime(file.type);
      newLogoPath = `user-logos/${userId}/${crypto.randomUUID()}.${ext}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      const { error: upErr } = await sb.storage.from(LOGO_BUCKET).upload(newLogoPath, buffer, {
        upsert: false,
        contentType: file.type,
        cacheControl: "0",
      });

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
    }
  }

  // 3) billing_settings upsert
  const payload: any = {
    user_id: userId,
    currency,
    default_vat_rate: Number.isFinite(default_vat_rate) ? default_vat_rate : 21,
    payment_terms_days: Number.isFinite(payment_terms_days) ? payment_terms_days : 14,
    quote_footer,
    invoice_footer,
    iban,
  };

  // ✅ als removeLogo: zet logo_path naar null
  if (removeLogo) payload.logo_path = null;
  // ✅ anders, als nieuwe upload: zet nieuwe path
  else if (newLogoPath) payload.logo_path = newLogoPath;

  const { error: bErr } = await sb.from("billing_settings").upsert(payload, { onConflict: "user_id" });
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 400 });

  // 4) delete old logo (best effort)
  // - als er een nieuwe is geupload: delete old
  // - als removeLogo: delete old
  if ((newLogoPath || removeLogo) && oldLogoPath) {
    await sb.storage.from(LOGO_BUCKET).remove([oldLogoPath]);
  }

  return NextResponse.redirect(new URL("/app/settings/billing?ok=1", req.url), 303);
}