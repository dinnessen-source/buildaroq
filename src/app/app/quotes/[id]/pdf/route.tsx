import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { supabaseServer } from "../../../../../lib/supabase/server";
import {
  QuotePdfDocument,
  type QuotePdfData,
} from "../../../../../lib/pdf/QuotePdfDocument";

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Quote
  const { data: quote, error: qErr } = await sb
    .from("quotes")
    .select(
      "id,user_id,customer_id,quote_number,status,notes,footer,currency,vat_rate,prices_include_vat,created_at"
    )
    .eq("id", id)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ error: qErr?.message ?? "Quote not found" }, { status: 404 });
  }

  if (quote.user_id !== user.id) {
    return NextResponse.json({ error: "No access" }, { status: 404 });
  }

  // Customer (soft)
  const { data: customer } = await sb
    .from("customers")
    .select("name,email,phone,address")
    .eq("id", quote.customer_id)
    .single();

  // Items
  const { data: itemsRaw, error: iErr } = await sb
    .from("quote_items")
    .select("description,qty,unit,unit_price")
    .eq("quote_id", quote.id)
    .order("created_at", { ascending: true });

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  const items = (itemsRaw ?? []).map((it) => ({
    description: it.description,
    qty: toNumber(it.qty),
    unit: it.unit ?? null,
    unit_price: toNumber(it.unit_price),
  }));

  // Billing settings (fallbacks)
  const { data: bs } = await sb
    .from("billing_settings")
    .select("currency,default_vat_rate,prices_include_vat,quote_footer,iban")
    .eq("user_id", user.id)
    .single();

  // Seller profile
  const { data: profile } = await sb
    .from("profiles")
    .select(
      "company_name,company_email,phone,address_line1,address_line2,postal_code,city,country,vat_number,chamber_of_commerce"
    )
    .eq("id", user.id)
    .single();

  const currency = quote.currency || bs?.currency || "EUR";
  const vatRate =
    quote.vat_rate === null
      ? bs
        ? toNumber(bs.default_vat_rate)
        : 21
      : toNumber(quote.vat_rate);

  const pricesIncludeVat =
    quote.prices_include_vat === null
      ? !!bs?.prices_include_vat
      : !!quote.prices_include_vat;

  const subtotal = items.reduce((sum, it) => sum + it.qty * it.unit_price, 0);

  let vatAmount = 0;
  let total = 0;

  if (pricesIncludeVat) {
    const divisor = 1 + vatRate / 100;
    const net = subtotal / divisor;
    vatAmount = subtotal - net;
    total = subtotal;
  } else {
    vatAmount = subtotal * (vatRate / 100);
    total = subtotal + vatAmount;
  }

  const pdfData: QuotePdfData = {
    brandName: "BuildaroQ",
    quote: {
      id: quote.id,
      quote_number: quote.quote_number,
      status: quote.status,
      notes: quote.notes ?? null,
      footer: (quote.footer ?? bs?.quote_footer ?? null) as string | null,
      created_at: quote.created_at,
    },
    seller: {
      company_name: profile?.company_name ?? null,
      company_email: profile?.company_email ?? null,
      phone: profile?.phone ?? null,
      address_line1: profile?.address_line1 ?? null,
      address_line2: profile?.address_line2 ?? null,
      postal_code: profile?.postal_code ?? null,
      city: profile?.city ?? null,
      country: profile?.country ?? null,
      vat_number: profile?.vat_number ?? null,
      chamber_of_commerce: profile?.chamber_of_commerce ?? null,
      iban: bs?.iban ?? null,
    },
    customer: customer
      ? {
          name: customer.name,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          address: customer.address ?? null,
        }
      : null,
    items,
    totals: {
      currency,
      prices_include_vat: pricesIncludeVat,
      vat_rate: vatRate,
      subtotal,
      vat_amount: vatAmount,
      total,
    },
  };

  const element = React.createElement(
    QuotePdfDocument,
    { data: pdfData }
  ) as unknown as React.ReactElement;

  const buffer = await (renderToBuffer as any)(element);

  const filename = `offerte-${quote.quote_number}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
