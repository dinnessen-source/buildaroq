import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "../../../../lib/supabase/server";
import { AddInvoiceItemForm } from "./AddInvoiceItemForm";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

type Invoice = {
  id: string;
  user_id: string;
  customer_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  notes: string | null;
  footer: string | null;
  currency: string;
  vat_rate: number | null;
  prices_include_vat: boolean | null;
  created_at: string;
  due_date: string | null; // YYYY-MM-DD

  quote_id: string | null;

  // ✅ locking velden (Supabase stap 1)
  issued_at: string | null;
  locked_at: string | null;

  // ✅ correctie link (optioneel aanwezig in DB)
  original_invoice_id?: string | null;
  correction_type?: "credit" | "debit" | null;
};

type Customer = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

type InvoiceItem = {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  vat_rate: number | null; // snapshot %
  vat_type?: string | null;
};

type BillingSettings = {
  currency: string;
  default_vat_rate: number;
  prices_include_vat: boolean;
  invoice_footer: string | null;
  payment_terms_days: number;
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR",
  }).format(Number.isFinite(value) ? value : 0);
}

function badgeClasses(status: InvoiceStatus) {
  switch (status) {
    case "draft":
      return "bg-gray-100 text-gray-800";
    case "sent":
      return "bg-blue-100 text-blue-800";
    case "paid":
      return "bg-green-100 text-green-800";
    case "overdue":
      return "bg-red-100 text-red-800";
    case "cancelled":
      return "bg-zinc-100 text-zinc-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function isOverdue(status: InvoiceStatus, due_date: string | null) {
  if (status === "paid" || status === "cancelled") return false;
  if (!due_date) return false;

  const due = new Date(`${due_date}T23:59:59`);
  const now = new Date();
  return now > due;
}

/**
 * Groepeer BTW per tarief en reken correct voor incl/excl prijzen.
 * - pricesIncludeVat=false: unit_price is EXCL btw
 * - pricesIncludeVat=true:  unit_price is INCL btw
 */
function computeVatBreakdown(
  items: InvoiceItem[],
  defaultVatRate: number,
  pricesIncludeVat: boolean
) {
  const perRate = new Map<number, { base: number; vat: number }>();

  let baseSubtotal = 0; // altijd excl btw
  let grossTotal = 0; // altijd incl btw

  for (const it of items) {
    const rate = (it.vat_rate ?? defaultVatRate) as number;
    const qty = Number(it.qty);
    const unitPrice = Number(it.unit_price);
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) continue;

    const line = round2(qty * unitPrice);

    if (pricesIncludeVat) {
      const divisor = 1 + rate / 100;
      const base = round2(line / divisor);
      const vat = round2(line - base);

      baseSubtotal = round2(baseSubtotal + base);
      grossTotal = round2(grossTotal + line);

      const row = perRate.get(rate) ?? { base: 0, vat: 0 };
      row.base = round2(row.base + base);
      row.vat = round2(row.vat + vat);
      perRate.set(rate, row);
    } else {
      const base = round2(line);
      const vat = round2(base * (rate / 100));
      const gross = round2(base + vat);

      baseSubtotal = round2(baseSubtotal + base);
      grossTotal = round2(grossTotal + gross);

      const row = perRate.get(rate) ?? { base: 0, vat: 0 };
      row.base = round2(row.base + base);
      row.vat = round2(row.vat + vat);
      perRate.set(rate, row);
    }
  }

  const breakdown = Array.from(perRate.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }));

  const vatTotal = round2(breakdown.reduce((s, r) => s + r.vat, 0));

  return {
    baseSubtotal,
    grossTotal,
    vatTotal,
    breakdown,
  };
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id || id === "new") return notFound();

  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) return notFound();

  // --- Server actions ---
  async function deleteItem(formData: FormData) {
    "use server";
    const sb2 = await supabaseServer();
    const itemId = String(formData.get("item_id") || "");

    const {
      data: { user: u },
    } = await sb2.auth.getUser();

    if (!u) return;
    if (!itemId) return;

    const { error } = await sb2.from("invoice_items").delete().eq("id", itemId);

    // Als invoice locked is, gooit je DB trigger een error -> netjes loggen
    if (error) console.error("DELETE INVOICE ITEM ERROR:", error);

    revalidatePath(`/app/invoices/${id}`);
  }

  async function setStatus(formData: FormData) {
  "use server";
  const sb2 = await supabaseServer();

  const nextStatus = String(formData.get("status") || "") as InvoiceStatus;
  const allowed: InvoiceStatus[] = ["draft", "sent", "paid", "cancelled"];
  if (!allowed.includes(nextStatus)) return;

  const {
    data: { user: u },
  } = await sb2.auth.getUser();
  if (!u) return;

  // ✅ Laad huidige invoice in deze server action scope
  const { data: current, error: currErr } = await sb2
    .from("invoices")
    .select("id,user_id,invoice_number,locked_at,status")
    .eq("id", id)
    .single();

  if (currErr || !current) return;
  if (current.user_id !== u.id) return;

  const patch: Record<string, any> = { status: nextStatus };

  if (nextStatus === "sent") {
    // al gelocked? niet opnieuw doen
    if (!current.locked_at) {
      const nowIso = new Date().toISOString();
      patch.issued_at = nowIso;
      patch.locked_at = nowIso;
    }

    // Alleen nummer genereren als hij nog null/empty is
    if (!current.invoice_number || current.invoice_number.trim() === "") {
      const { data: last } = await sb2
        .from("invoices")
        .select("invoice_number")
        .eq("user_id", u.id)
        .not("invoice_number", "is", null)
        .order("invoice_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      let nextNumber = 1;

      if (last?.invoice_number) {
        const match = last.invoice_number.match(/\d+$/);
        if (match) nextNumber = parseInt(match[0], 10) + 1;
      }

      patch.invoice_number = `INV-${String(nextNumber).padStart(5, "0")}`;
    }
  }

  const { error } = await sb2.from("invoices").update(patch).eq("id", id);
  if (error) console.error("SET STATUS ERROR:", error);

  revalidatePath(`/app/invoices/${id}`);
  revalidatePath(`/app/invoices`);
}

  async function createCorrection(formData: FormData) {
    "use server";
    const sb2 = await supabaseServer();

    const type = String(formData.get("type") || "") as "credit" | "debit";
    if (type !== "credit" && type !== "debit") return;

    const {
      data: { user: u },
    } = await sb2.auth.getUser();
    if (!u) return;

    // Originele invoice ophalen
    const { data: inv, error: invErr } = await sb2
      .from("invoices")
      .select(
        "id,user_id,customer_id,notes,footer,currency,prices_include_vat,vat_rate,quote_id"
      )
      .eq("id", id)
      .single();

    if (invErr || !inv) return;

    // Items ophalen (incl vat_type als je die hebt)
    const { data: its, error: itsErr } = await sb2
      .from("invoice_items")
      .select("description,qty,unit,unit_price,vat_rate,vat_type")
      .eq("invoice_id", id);

    if (itsErr) return;

    // Nieuwe invoice maken (draft, nummer later bij sent)
const { data: created, error: createErr } = await sb2
  .from("invoices")
  .insert({
    user_id: inv.user_id,
    customer_id: inv.customer_id,
    invoice_number: null,
    status: "draft",
    notes: inv.notes,
    footer: inv.footer,
    currency: inv.currency,
    vat_rate: inv.vat_rate,
    prices_include_vat: inv.prices_include_vat,
    due_date: null,
    quote_id: inv.quote_id,
    original_invoice_id: inv.id,
    correction_type: type,
  })
  .select("id")
  .single();

    if (createErr || !created) {
      console.error("CREATE CORRECTION ERROR:", createErr);
      return;
    }

    // Items kopiëren
    const newItems =
      (its ?? []).map((it: any) => ({
        invoice_id: created.id,
        description: it.description,
        qty: type === "credit" ? -1 * toNumber(it.qty) : toNumber(it.qty),
        unit: it.unit ?? null,
        unit_price: toNumber(it.unit_price),
        vat_rate: it.vat_rate === null ? null : toNumber(it.vat_rate),
        vat_type: it.vat_type ?? null,
      })) ?? [];

    if (newItems.length > 0) {
      const { error: itemsInsertErr } = await sb2.from("invoice_items").insert(newItems);
      if (itemsInsertErr) console.error("COPY ITEMS ERROR:", itemsInsertErr);
    }

    revalidatePath(`/app/invoices`);
    redirect(`/app/invoices/${created.id}`);
  }

  // 1) Invoice (✅ locked_at + issued_at mee selecteren)
  const { data: invoiceRaw, error: invoiceErr } = await sb
    .from("invoices")
    .select(
      "id,user_id,customer_id,invoice_number,status,notes,footer,currency,vat_rate,prices_include_vat,created_at,due_date,quote_id,issued_at,locked_at,original_invoice_id,correction_type"
    )
    .eq("id", id)
    .single();

  if (invoiceErr) {
    console.error("INVOICE LOAD ERROR:", invoiceErr);
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout bij laden factuur</div>
        <div className="text-sm text-red-700 mt-2">{invoiceErr.message}</div>
        <div className="mt-4">
          <Link className="underline" href="/app/invoices">
            Terug
          </Link>
        </div>
      </div>
    );
  }

  if (!invoiceRaw) return notFound();
  if (invoiceRaw.user_id !== user.id) return notFound();

  // Quote nr ophalen (alleen voor weergave)
  let quoteNumberResolved: string | null = null;
  if ((invoiceRaw as any).quote_id) {
    const { data: q } = await sb
      .from("quotes")
      .select("quote_number")
      .eq("id", (invoiceRaw as any).quote_id)
      .maybeSingle();
    quoteNumberResolved = q?.quote_number ?? null;
  }

  const invoice: Invoice = {
    ...invoiceRaw,
    vat_rate: invoiceRaw.vat_rate === null ? null : toNumber(invoiceRaw.vat_rate),
    prices_include_vat: invoiceRaw.prices_include_vat,
    due_date: invoiceRaw.due_date ? String(invoiceRaw.due_date) : null,
    quote_id: (invoiceRaw as any).quote_id ?? null,
    issued_at: invoiceRaw.issued_at ? String(invoiceRaw.issued_at) : null,
    locked_at: invoiceRaw.locked_at ? String(invoiceRaw.locked_at) : null,
    original_invoice_id: (invoiceRaw as any).original_invoice_id ?? null,
    correction_type: (invoiceRaw as any).correction_type ?? null,
  };

  // ✅ lock rule
  const isLocked = !!invoice.locked_at || invoice.status !== "draft";

  // 2) Customer
  const { data: customerRaw } = await sb
    .from("customers")
    .select("name,email,phone,address")
    .eq("id", invoice.customer_id)
    .single();

  const customer: Customer | null = customerRaw ?? null;

  // 3) Items
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("invoice_items")
    .select("id,description,qty,unit,unit_price,vat_rate")
    .eq("invoice_id", invoice.id)
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return (
      <div className="space-y-4">
        <Link className="underline" href="/app/invoices">
          Terug
        </Link>
        <div className="p-4 rounded-xl border bg-red-50 text-red-700">
          Fout bij laden van regels: {itemsErr.message}
        </div>
      </div>
    );
  }

  const items: InvoiceItem[] = (itemsRaw ?? []).map((it) => ({
    ...it,
    qty: toNumber(it.qty),
    unit_price: toNumber(it.unit_price),
    vat_rate: it.vat_rate === null ? null : toNumber(it.vat_rate),
  }));

  // 4) Billing settings
  const { data: bsRaw } = await sb
    .from("billing_settings")
    .select(
      "currency,default_vat_rate,prices_include_vat,invoice_footer,payment_terms_days"
    )
    .eq("user_id", user.id)
    .single();

  const billingSettings: BillingSettings | null = bsRaw
    ? {
        currency: bsRaw.currency ?? "EUR",
        default_vat_rate: toNumber(bsRaw.default_vat_rate),
        prices_include_vat: !!bsRaw.prices_include_vat,
        invoice_footer: bsRaw.invoice_footer ?? null,
        payment_terms_days: toNumber(bsRaw.payment_terms_days ?? 14),
      }
    : null;

  const currency = invoice.currency || billingSettings?.currency || "EUR";
  const defaultVatRate = invoice.vat_rate ?? billingSettings?.default_vat_rate ?? 21;
  const pricesIncludeVat =
    invoice.prices_include_vat ?? billingSettings?.prices_include_vat ?? false;

  const computedOverdue = isOverdue(invoice.status, invoice.due_date);
  const displayStatus: InvoiceStatus = computedOverdue ? "overdue" : invoice.status;

  // ✅ Totals met meerdere BTW’s
  const totals = computeVatBreakdown(items, defaultVatRate, pricesIncludeVat);
  const subtotal = totals.baseSubtotal;
  const total = totals.grossTotal;

  const footer = invoice.footer ?? billingSettings?.invoice_footer ?? null;

  const correctionLabel =
    invoice.correction_type === "credit"
      ? "Creditfactuur"
      : invoice.correction_type === "debit"
      ? "Aanvullende factuur"
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">
            Factuur{correctionLabel ? ` • ${correctionLabel}` : ""}
          </div>
          <h1 className="text-2xl font-bold">
            {invoice.invoice_number || "—"}
          </h1>

          {/* correctie verwijzing */}
          {invoice.original_invoice_id ? (
            <div className="mt-2 text-sm text-gray-600">
              Correctie op{" "}
              <Link className="underline" href={`/app/invoices/${invoice.original_invoice_id}`}>
                originele factuur
              </Link>
            </div>
          ) : null}

          {/* “Gebaseerd op OFF-xxxx” */}
          {invoice.quote_id ? (
            <div className="mt-2 text-sm text-gray-600">
              Gebaseerd op{" "}
              <Link className="underline" href={`/app/quotes/${invoice.quote_id}`}>
                {quoteNumberResolved ?? "offerte"}
              </Link>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-semibold ${badgeClasses(
                displayStatus
              )}`}
            >
              {displayStatus}
            </span>

            <span className="text-sm text-gray-600">
              Datum: {new Date(invoice.created_at).toLocaleDateString("nl-NL")}
            </span>

            <span className="text-sm text-gray-600">
              Vervaldatum:{" "}
              {invoice.due_date
                ? new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString("nl-NL")
                : "—"}
            </span>

            {billingSettings?.payment_terms_days ? (
              <span className="text-sm text-gray-600">
                ({billingSettings.payment_terms_days} dagen)
              </span>
            ) : null}

            {invoice.locked_at ? (
              <span className="text-xs text-gray-500">
                Vergrendeld: {new Date(invoice.locked_at).toLocaleString("nl-NL")}
              </span>
            ) : null}
          </div>

          {isLocked ? (
            <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              Deze factuur is uitgereikt en vergrendeld. Wijzigingen doe je via een
              credit- of debetcorrectie.
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-end">
          <Link className="underline" href="/app/invoices">
            Terug
          </Link>

          <a
            href={`/app/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
          >
            Download PDF
          </a>

          {/* Status actions */}
          {invoice.status !== "cancelled" ? (
            <>
              {/* Alleen versturen als draft */}
              {invoice.status === "draft" ? (
                <form action={setStatus}>
                  <input type="hidden" name="status" value="sent" />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
                  >
                    Markeer als verstuurd
                  </button>
                </form>
              ) : null}

              {/* Betalen mag na sent/overdue */}
              {invoice.status !== "draft" ? (
                <form action={setStatus}>
                  <input type="hidden" name="status" value="paid" />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
                  >
                    Markeer als betaald
                  </button>
                </form>
              ) : null}
            </>
          ) : null}

          {/* ✅ Correcties alleen als locked (dus niet draft) */}
          {isLocked && invoice.status !== "cancelled" ? (
            <>
              <form action={createCorrection}>
                <input type="hidden" name="type" value="credit" />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
                >
                  Maak creditfactuur
                </button>
              </form>

              <form action={createCorrection}>
                <input type="hidden" name="type" value="debit" />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
                >
                  Maak aanvullende factuur
                </button>
              </form>
            </>
          ) : null}

          {/* Annuleren alleen voor draft (geen uitgereikte facturen “cancellen”) */}
          {invoice.status === "draft" ? (
            <form action={setStatus}>
              <input type="hidden" name="status" value="cancelled" />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl border bg-red-50 text-red-700 hover:bg-red-100"
              >
                Verwijder concept
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Customer */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold mb-3">Klant</div>
        {customer ? (
          <div className="grid gap-2 text-sm">
            <div className="font-semibold">{customer.name}</div>
            <div className="text-gray-700">{customer.email ?? "—"}</div>
            <div className="text-gray-700">{customer.phone ?? "—"}</div>
            <div className="text-gray-700 whitespace-pre-wrap">{customer.address ?? "—"}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Klant niet gevonden.</div>
        )}
      </div>

      {/* Add item (✅ only when not locked) */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold mb-3">Nieuwe regel</div>
        {!isLocked ? (
          <AddInvoiceItemForm invoiceId={invoice.id} />
        ) : (
          <div className="text-sm text-gray-600">
            Vergrendeld — maak een credit/debet correctie om wijzigingen door te voeren.
          </div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="p-6 border-b">
          <div className="text-sm font-semibold">Regels</div>
          <div className="text-sm text-gray-600 mt-1">
            Standaard BTW fallback: {defaultVatRate}% •{" "}
            {pricesIncludeVat ? "prijzen incl. BTW" : "prijzen excl. BTW"}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">Nog geen regels toegevoegd.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-4">Omschrijving</th>
                <th className="text-right p-4">Aantal</th>
                <th className="text-right p-4">Prijs</th>
                <th className="text-right p-4">Regeltotaal</th>
                <th className="text-right p-4">Actie</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const lineTotal = round2(it.qty * it.unit_price);
                const rate = it.vat_rate ?? defaultVatRate;

                return (
                  <tr key={it.id} className="border-t">
                    <td className="p-4">
                      <div className="font-semibold">{it.description}</div>

                      <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                        {it.unit ? <span>Unit: {it.unit}</span> : null}
                        <span>BTW: {rate}%</span>
                      </div>
                    </td>
                    <td className="p-4 text-right text-gray-700">{it.qty.toString()}</td>
                    <td className="p-4 text-right text-gray-700">
                      {formatMoney(it.unit_price, currency)}
                    </td>
                    <td className="p-4 text-right font-semibold">
                      {formatMoney(lineTotal, currency)}
                    </td>
                    <td className="p-4 text-right">
                      {!isLocked ? (
                        <form action={deleteItem}>
                          <input type="hidden" name="item_id" value={it.id} />
                          <button type="submit" className="underline text-red-600">
                            Verwijderen
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-gray-400">Vergrendeld</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Totals */}
        <div className="p-6 border-t bg-gray-50">
          <div className="ml-auto w-full max-w-sm space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-gray-700">
                {pricesIncludeVat ? "Subtotaal (excl.)" : "Subtotaal"}
              </div>
              <div className="font-semibold">{formatMoney(subtotal, currency)}</div>
            </div>

            {/* BTW per tarief */}
            {totals.breakdown.length === 0 ? (
              <div className="flex items-center justify-between">
                <div className="text-gray-700">BTW</div>
                <div className="font-semibold">{formatMoney(0, currency)}</div>
              </div>
            ) : (
              totals.breakdown.map((row) => (
                <div key={row.rate} className="flex items-center justify-between">
                  <div className="text-gray-700">BTW ({row.rate}%)</div>
                  <div className="font-semibold">{formatMoney(row.vat, currency)}</div>
                </div>
              ))
            )}

            <div className="flex items-center justify-between text-base">
              <div className="font-bold">Totaal (incl.)</div>
              <div className="font-bold">{formatMoney(total, currency)}</div>
            </div>

            <div className="pt-2 text-xs text-gray-500">
              {pricesIncludeVat
                ? "Let op: regelprijzen zijn incl. BTW; subtotal wordt teruggerekend excl."
                : "Regelprijzen zijn excl. BTW; totaal is incl. BTW."}
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes ? (
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm font-semibold mb-2">Notities</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</div>
        </div>
      ) : null}

      {/* Footer */}
      {footer ? (
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm font-semibold mb-2">Footer</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}