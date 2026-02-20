"use server";

import { supabaseServer } from "../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

export async function convertQuoteToInvoice(quoteId: string) {
  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) throw new Error("Niet ingelogd");

  // 1) Quote ophalen
  const { data: quote, error: qErr } = await sb
    .from("quotes")
    .select("id,user_id,customer_id,status,currency,vat_rate,prices_include_vat,notes,footer")
    .eq("id", quoteId)
    .single();

  if (qErr) throw new Error(qErr.message);
  if (!quote) throw new Error("Offerte niet gevonden");
  if (quote.user_id !== user.id) throw new Error("Geen toegang");

  if (quote.status !== "accepted") {
    throw new Error("Alleen geaccepteerde offertes kunnen naar factuur.");
  }

  // 2) Voorkom dubbele factuur
  const { data: existing, error: exErr } = await sb
    .from("invoices")
    .select("id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) {
    redirect(`/app/invoices/${existing.id}`);
  }

  // 3) Quote items ophalen (IMPORTANT: vat_type + vat_rate)
  const { data: items, error: itemsErr } = await sb
    .from("quote_items")
    .select("description,qty,unit,unit_price,vat_type,vat_rate")
    .eq("quote_id", quoteId)
    .order("created_at", { ascending: true });

  if (itemsErr) throw new Error(itemsErr.message);

  // 4) Invoice nummer via RPC
  const { data: invNo, error: noErr } = await sb.rpc("next_invoice_number");
  if (noErr) throw new Error(noErr.message);
  if (!invNo) throw new Error("Kon geen factuurnummer genereren.");

  // 5) due_date berekenen (YYYY-MM-DD)
  const { data: bs, error: bsErr } = await sb
    .from("billing_settings")
    .select("payment_terms_days")
    .eq("user_id", user.id)
    .single();

  if (bsErr) {
    // niet hard falen; fallback gebruiken
    console.warn("billing_settings load failed:", bsErr.message);
  }

  const termsDays = Number(bs?.payment_terms_days ?? 14);
  const due = new Date();
  due.setDate(due.getDate() + termsDays);
  const due_date = due.toISOString().slice(0, 10);

  // 6) Invoice aanmaken
  // (vat_rate / prices_include_vat blijven legacy velden; regels zijn de waarheid)
  const { data: invoice, error: invErr } = await sb
    .from("invoices")
    .insert({
      user_id: user.id,
      customer_id: quote.customer_id,
      invoice_number: invNo,
      status: "draft",
      notes: quote.notes,
      footer: quote.footer,
      currency: quote.currency,
      vat_rate: quote.vat_rate,
      prices_include_vat: quote.prices_include_vat,
      quote_id: quoteId,
      due_date,
    })
    .select("id")
    .single();

  if (invErr) throw new Error(invErr.message);
  if (!invoice?.id) throw new Error("Factuur aanmaken mislukt");

  // 7) Items kopiëren naar invoice_items (with vat_type + vat_rate)
  const safeItems = items ?? [];
  if (safeItems.length > 0) {
    const rows = safeItems.map((it) => ({
      invoice_id: invoice.id,
      user_id: user.id,
      description: it.description,
      qty: toNumber(it.qty),
      unit: it.unit ?? null,
      unit_price: toNumber(it.unit_price),

      // NEW: keep VAT snapshot per line
      vat_type: (it.vat_type ?? "NL_21") as string,
      vat_rate: it.vat_rate === null ? null : toNumber(it.vat_rate),
    }));

    const { error: copyErr } = await sb.from("invoice_items").insert(rows);
    if (copyErr) throw new Error(copyErr.message);
  }

  // 8) Revalidate + redirect
  revalidatePath("/app/invoices");
  revalidatePath(`/app/quotes/${quoteId}`);
  revalidatePath("/app/quotes");

  redirect(`/app/invoices/${invoice.id}`);
}
