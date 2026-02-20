import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import fs from "fs";
import path from "path";

import { supabaseServer } from "../../../../../lib/supabase/server";
import {
  InvoicePdfDocument,
  type InvoicePdfData,
} from "../../../../../lib/pdf/InvoicePdfDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BILLING_LOGO_BUCKET = "billing-logos";
const PUBLIC_FALLBACK_LOGO = "logo.png"; // optioneel in /public

function loadPublicImageAsDataUri(relPathFromPublic: string) {
  const filePath = path.join(process.cwd(), "public", relPathFromPublic);
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
      ? "image/webp"
      : ext === "svg"
      ? "image/svg+xml"
      : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function downloadStorageImageAsDataUri(
  sb: Awaited<ReturnType<typeof supabaseServer>>,
  bucket: string,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await sb.storage.from(bucket).download(storagePath);
  if (error || !data) return null;

  const ab = await data.arrayBuffer();
  const bytes = new Uint8Array(ab);

  const fromBlobType = (data as any).type as string | undefined;
  const ext = storagePath.split(".").pop()?.toLowerCase();
  const fallbackType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
      ? "image/webp"
      : ext === "svg"
      ? "image/svg+xml"
      : "image/png";

  const contentType = fromBlobType && fromBlobType !== "" ? fromBlobType : fallbackType;
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

type VatType =
  | "NL_21"
  | "NL_9_WONING"
  | "NL_REVERSE_CHARGE"
  | "EU_B2B_REVERSE_CHARGE"
  | "NON_EU_OUTSIDE_SCOPE"
  | "FOREIGN_LOCAL_VAT";

type Line = {
  qty: number;
  unit_price: number;
  vat_type?: VatType | string | null;
  vat_rate?: number | null;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isZeroVatType(vatType: string) {
  return (
    vatType === "NL_REVERSE_CHARGE" ||
    vatType === "EU_B2B_REVERSE_CHARGE" ||
    vatType === "NON_EU_OUTSIDE_SCOPE"
  );
}

function resolveVatRate(vatType: string, vatRate: unknown): number {
  if (isZeroVatType(vatType)) return 0;

  const r = typeof vatRate === "number" ? vatRate : Number(vatRate);
  if (Number.isFinite(r) && r >= 0) return r;

  if (vatType === "NL_9_WONING") return 9;
  return 21;
}

function calcTotals(lines: Line[]) {
  let subtotal = 0;

  const vatBreakdown = new Map<number, { base: number; vat: number }>();

  const flags = {
    hasReverseNl: false,
    hasReverseEu: false,
    hasOutsideEu: false,
  };

  for (const l of lines) {
    const qty = Number(l.qty);
    const unitPrice = Number(l.unit_price);
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) continue;

    const net = round2(qty * unitPrice);
    subtotal = round2(subtotal + net);

    const vatType = String(l.vat_type ?? "NL_21");
    const rate = resolveVatRate(vatType, l.vat_rate);

    if (vatType === "NL_REVERSE_CHARGE") flags.hasReverseNl = true;
    if (vatType === "EU_B2B_REVERSE_CHARGE") flags.hasReverseEu = true;
    if (vatType === "NON_EU_OUTSIDE_SCOPE") flags.hasOutsideEu = true;

    const vat = round2(net * (rate / 100));

    if (!vatBreakdown.has(rate)) vatBreakdown.set(rate, { base: 0, vat: 0 });
    const row = vatBreakdown.get(rate)!;
    row.base = round2(row.base + net);
    row.vat = round2(row.vat + vat);
  }

  const vat_amount = round2(
    Array.from(vatBreakdown.values()).reduce((s, r) => s + r.vat, 0)
  );
  const total = round2(subtotal + vat_amount);

  const notices: string[] = [];
  if (flags.hasReverseNl) notices.push("BTW verlegd (onderaanneming/bouw).");
  if (flags.hasReverseEu)
    notices.push("BTW verlegd – intracommunautaire dienst (EU B2B).");
  if (flags.hasOutsideEu)
    notices.push("Plaats van dienst buiten Nederland (buiten EU).");

  return {
    subtotal,
    vat_amount,
    total,
    vat_breakdown: Array.from(vatBreakdown.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat })),
    notices,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
      "id,user_id,customer_id,invoice_number,status,notes,footer,currency,prices_include_vat,created_at,due_date"
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

  // Items (vat_type + vat_rate)
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("invoice_items")
    .select("description,qty,unit,unit_price,vat_type,vat_rate")
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
    vat_type: (it.vat_type ?? "NL_21") as string,
    vat_rate: it.vat_rate === null ? null : toNumber(it.vat_rate),
  }));

  // Billing settings (incl. logo_path)
  const { data: bs } = await sb
    .from("billing_settings")
    .select("currency,invoice_footer,iban,logo_path")
    .eq("user_id", user.id)
    .maybeSingle();

  // Seller profile
  const { data: profile } = await sb
    .from("profiles")
    .select(
      "company_name,company_email,phone,address_line1,address_line2,postal_code,city,country,vat_number,chamber_of_commerce"
    )
    .eq("id", user.id)
    .single();

  const currency = invoice.currency || bs?.currency || "EUR";

  const totalsCalc = calcTotals(
    items.map((it) => ({
      qty: it.qty,
      unit_price: it.unit_price,
      vat_type: it.vat_type,
      vat_rate: it.vat_rate,
    }))
  );

  // ✅ LOGO: download → base64 data-uri (meest bulletproof)
  let logoDataUri: string | null = null;

  if (bs?.logo_path) {
    logoDataUri = await downloadStorageImageAsDataUri(
      sb,
      BILLING_LOGO_BUCKET,
      bs.logo_path
    );
  }

  // fallback (optioneel)
  if (!logoDataUri) {
    try {
      logoDataUri = loadPublicImageAsDataUri(PUBLIC_FALLBACK_LOGO);
    } catch {
      logoDataUri = null;
    }
  }

  const pdfData: InvoicePdfData = {
   
    logoDataUri,
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
      prices_include_vat: !!invoice.prices_include_vat,
      subtotal: totalsCalc.subtotal,
      vat_amount: totalsCalc.vat_amount,
      total: totalsCalc.total,
      vat_breakdown: totalsCalc.vat_breakdown,
      notices: totalsCalc.notices,
    } as any,
  };

  const element = React.createElement(InvoicePdfDocument, {
    data: pdfData as any,
  }) as unknown as React.ReactElement;

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