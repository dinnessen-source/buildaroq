import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";

import { supabaseServer } from "../../../../../lib/supabase/server";
import {
  InvoicePdfDocument,
  type InvoicePdfData,
} from "../../../../../lib/pdf/InvoicePdfDocument";

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

  // Invoice
  const { data: invoice, error: invErr } = await sb
    .from("invoices")
    .select(
      "id,user_id,customer_id,invoice_number,status,notes,footer,currency,vat_rate,prices_include_vat,created_at,due_date"
    )
    .eq("id", id)
    .single();

  if (invErr || !invoice) {
    return NextResponse.json(
      { error: invErr?.message ?? "Invoice not found" },
      { status: 404 }
    );
  }

  if (invoice.user_id !== user.id) {
    return NextResponse.json({ error: "No access" }, { status: 404 });
  }

  // Customer (soft)
  const { data: customer } = await sb
    .from("customers")
    .select("name,email,phone,address")
    .eq("id", invoice.customer_id)
    .single();

  // Items
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("invoice_items")
    .select("description,qty,unit,unit_price")
    .eq("invoice_id", invoice.id)
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
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
    .select("currency,default_vat_rate,prices_include_vat,invoice_footer,iban")
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

  const currency = invoice.currency || bs?.currency || "EUR";
  const vatRate =
    invoice.vat_rate === null
      ? toNumber(bs?.default_vat_rate ?? 21)
      : toNumber(invoice.vat_rate);

  const pricesIncludeVat =
    invoice.prices_include_vat === null
      ? !!bs?.prices_include_vat
      : !!invoice.prices_include_vat;

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

  const pdfData: InvoicePdfData = {
    brandName: "BuildaroQ",
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      notes: invoice.notes ?? null,
      footer: (invoice.footer ?? bs?.invoice_footer ?? null) as string | null,
      created_at: invoice.created_at,
      due_date: invoice.due_date ? String(invoice.due_date) : null,
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
    InvoicePdfDocument,
    { data: pdfData }
  ) as unknown as React.ReactElement;

  // TS typings van renderToBuffer zijn vaak te streng → cast
  const buffer = await (renderToBuffer as any)(element);

  const filename = `factuur-${invoice.invoice_number}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
