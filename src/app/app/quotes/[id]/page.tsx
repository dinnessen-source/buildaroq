import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "../../../../lib/supabase/server";
import { AddQuoteItemForm } from "./AddQuoteItemForm";
import { revalidatePath } from "next/cache";
import QuoteStatusActions from "./QuoteStatusActions";
import { convertQuoteToInvoice } from "../convertActions";

type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

type Quote = {
  id: string;
  user_id: string;
  customer_id: string;
  quote_number: string;
  status: QuoteStatus;
  notes: string | null;
  footer: string | null;
  currency: string;
  vat_rate: number | null; // legacy (not used for calc anymore)
  prices_include_vat: boolean | null; // legacy (not used for calc anymore)
  created_at: string;
};

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

type QuoteItem = {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number; // treated as EXCL VAT
  vat_type: string | null;
  vat_rate: number | null; // snapshot %
};

type BillingSettings = {
  currency: string;
  default_vat_rate: number; // legacy default; used as fallback only
  prices_include_vat: boolean; // legacy (display only)
  quote_footer: string | null;
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

function badgeClasses(status: QuoteStatus) {
  switch (status) {
    case "draft":
      return "bg-gray-100 text-gray-800";
    case "sent":
      return "bg-blue-100 text-blue-800";
    case "accepted":
      return "bg-green-100 text-green-800";
    case "declined":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function isZeroVatType(vatType: string) {
  return (
    vatType === "NL_REVERSE_CHARGE" ||
    vatType === "EU_B2B_REVERSE_CHARGE" ||
    vatType === "NON_EU_OUTSIDE_SCOPE"
  );
}

function resolveVatRate(vatType: string, vatRate: number | null, defaultVatRate: number) {
  if (isZeroVatType(vatType)) return 0;
  if (typeof vatRate === "number" && Number.isFinite(vatRate) && vatRate >= 0) return vatRate;
  if (vatType === "NL_9_WONING") return 9;
  // fallback for old items:
  return Number.isFinite(defaultVatRate) ? defaultVatRate : 21;
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "new") return notFound();

  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) return notFound();

  async function deleteItem(formData: FormData) {
    "use server";
    const sb2 = await supabaseServer();
    const itemId = String(formData.get("item_id") || "");

    const {
      data: { user: u },
    } = await sb2.auth.getUser();

    if (!u) return;
    if (!itemId) return;

    const { error } = await sb2.from("quote_items").delete().eq("id", itemId);

    if (error) {
      console.error("DELETE ITEM ERROR:", error);
      return;
    }

    revalidatePath(`/app/quotes/${id}`);
  }

  // 1) Quote
  const { data: quoteRaw, error: quoteErr } = await sb
    .from("quotes")
    .select(
      "id,user_id,customer_id,quote_number,status,notes,footer,currency,vat_rate,prices_include_vat,created_at"
    )
    .eq("id", id)
    .single();

  if (quoteErr) {
    console.error("QUOTE LOAD ERROR:", quoteErr);
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout bij laden offerte</div>
        <div className="text-sm text-red-700 mt-2">{quoteErr.message}</div>
        <div className="mt-4">
          <Link className="underline" href="/app/quotes">
            Terug
          </Link>
        </div>
      </div>
    );
  }

  if (!quoteRaw) return notFound();

  const quote: Quote = {
    ...quoteRaw,
    vat_rate: quoteRaw.vat_rate === null ? null : toNumber(quoteRaw.vat_rate),
    prices_include_vat: quoteRaw.prices_include_vat,
  };

  if (quote.user_id !== user.id) return notFound();

  // 2) Customer
  const { data: customerRaw } = await sb
    .from("customers")
    .select("id,name,email,phone,address")
    .eq("id", quote.customer_id)
    .single();

  const customer: Customer | null = customerRaw ?? null;

  // Linked invoice?
  const { data: linkedInvoice } = await sb
    .from("invoices")
    .select("id, invoice_number")
    .eq("quote_id", quote.id)
    .maybeSingle();

  // 3) Items (with vat_type/vat_rate)
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("quote_items")
    .select("id,description,qty,unit,unit_price,vat_type,vat_rate")
    .eq("quote_id", quote.id)
    .order("created_at", { ascending: true });

  if (itemsErr) {
    return (
      <div className="space-y-4">
        <Link className="underline" href="/app/quotes">
          Terug
        </Link>
        <div className="p-4 rounded-xl border bg-red-50 text-red-700">
          Fout bij laden van offertregels: {itemsErr.message}
        </div>
      </div>
    );
  }

  const items: QuoteItem[] = (itemsRaw ?? []).map((it) => ({
    ...it,
    qty: toNumber(it.qty),
    unit_price: toNumber(it.unit_price),
    vat_type: (it.vat_type ?? "NL_21") as string,
    vat_rate: it.vat_rate === null ? null : toNumber(it.vat_rate),
  }));

  // 4) Billing settings (fallbacks)
  const { data: bsRaw } = await sb
    .from("billing_settings")
    .select("currency,default_vat_rate,prices_include_vat,quote_footer")
    .eq("user_id", user.id)
    .single();

  const billingSettings: BillingSettings | null = bsRaw
    ? {
        currency: bsRaw.currency ?? "EUR",
        default_vat_rate: toNumber(bsRaw.default_vat_rate),
        prices_include_vat: !!bsRaw.prices_include_vat,
        quote_footer: bsRaw.quote_footer ?? null,
      }
    : null;

  const currency = quote.currency || billingSettings?.currency || "EUR";
  const defaultVatRate = quote.vat_rate ?? billingSettings?.default_vat_rate ?? 21;

  // 5) Totals (multi VAT, per line) - prices are EXCL VAT
  let subtotal = 0;
  const vatMap = new Map<number, { base: number; vat: number }>();

  let hasReverseNl = false;
  let hasReverseEu = false;
  let hasOutsideEu = false;

  for (const it of items) {
    const net = round2(it.qty * it.unit_price);
    subtotal = round2(subtotal + net);

    const vatType = String(it.vat_type ?? "NL_21");
    const rate = resolveVatRate(vatType, it.vat_rate, defaultVatRate);

    if (vatType === "NL_REVERSE_CHARGE") hasReverseNl = true;
    if (vatType === "EU_B2B_REVERSE_CHARGE") hasReverseEu = true;
    if (vatType === "NON_EU_OUTSIDE_SCOPE") hasOutsideEu = true;

    const vat = round2(net * (rate / 100));

    if (!vatMap.has(rate)) vatMap.set(rate, { base: 0, vat: 0 });
    const row = vatMap.get(rate)!;
    row.base = round2(row.base + net);
    row.vat = round2(row.vat + vat);
  }

  const vatBreakdown = Array.from(vatMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }));

  const vatAmount = round2(vatBreakdown.reduce((s, r) => s + r.vat, 0));
  const total = round2(subtotal + vatAmount);

  const nonZeroRates = vatBreakdown.filter((r) => r.rate !== 0).map((r) => r.rate);
  const uniqueNonZeroRates = Array.from(new Set(nonZeroRates));
  const multipleVatRates = uniqueNonZeroRates.length > 1;

  const notices: string[] = [];
  if (hasReverseNl) notices.push("BTW verlegd (onderaanneming/bouw).");
  if (hasReverseEu) notices.push("BTW verlegd – intracommunautaire dienst (EU B2B).");
  if (hasOutsideEu) notices.push("Plaats van dienst buiten Nederland (buiten EU).");

  const footer = quote.footer ?? billingSettings?.quote_footer ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Offerte</div>
          <h1 className="text-2xl font-bold">{quote.quote_number}</h1>

          <div className="mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-semibold ${badgeClasses(
                quote.status
              )}`}
            >
              {quote.status}
            </span>

            <span className="text-sm text-gray-600">
              {new Date(quote.created_at).toLocaleDateString("nl-NL")}
            </span>
          </div>
        </div>

        {/* Acties rechts */}
        <div className="flex items-center gap-3">
          <Link className="underline" href="/app/quotes">
            Terug
          </Link>

          <a
            href={`/app/quotes/${quote.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
          >
            Download PDF
          </a>

          <QuoteStatusActions quoteId={quote.id} status={quote.status} />

          {linkedInvoice?.id ? (
            <Link
              href={`/app/invoices/${linkedInvoice.id}`}
              className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
            >
              Gefactureerd: {linkedInvoice.invoice_number ?? "Open factuur"}
            </Link>
          ) : null}

          {quote.status === "accepted" && !linkedInvoice?.id ? (
            <form
              action={async () => {
                "use server";
                await convertQuoteToInvoice(quote.id);
              }}
            >
              <button
                type="submit"
                className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
              >
                Maak factuur
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold mb-3">Nieuwe regel</div>
        <AddQuoteItemForm quoteId={quote.id} />
      </div>

      {/* Customer */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold mb-3">Klant</div>
        {customer ? (
          <div className="grid gap-2 text-sm">
            <div className="font-semibold">{customer.name}</div>
            <div className="text-gray-700">{customer.email ?? "—"}</div>
            <div className="text-gray-700">{customer.phone ?? "—"}</div>
            <div className="text-gray-700 whitespace-pre-wrap">
              {customer.address ?? "—"}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Klant niet gevonden.</div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="p-6 border-b">
          <div className="text-sm font-semibold">Regels</div>
          <div className="text-sm text-gray-600 mt-1">
            BTW:{" "}
            {multipleVatRates
              ? "meerdere tarieven"
              : `${uniqueNonZeroRates[0] ?? 0}%`}{" "}
            • prijzen excl. BTW
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-6 text-sm text-gray-600">
            Nog geen regels toegevoegd.
          </div>
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
                const lineTotal = it.qty * it.unit_price;
                return (
                  <tr key={it.id} className="border-t">
                    <td className="p-4">
                      <div className="font-semibold">{it.description}</div>
                      {it.unit ? (
                        <div className="text-xs text-gray-500">
                          Unit: {it.unit}
                        </div>
                      ) : null}
                    </td>

                    <td className="p-4 text-right text-gray-700">
                      {it.qty.toString()}
                    </td>

                    <td className="p-4 text-right text-gray-700">
                      {formatMoney(it.unit_price, currency)}
                    </td>

                    <td className="p-4 text-right font-semibold">
                      {formatMoney(lineTotal, currency)}
                    </td>

                    <td className="p-4 text-right">
                      <form action={deleteItem}>
                        <input type="hidden" name="item_id" value={it.id} />
                        <button type="submit" className="underline text-red-600">
                          Verwijderen
                        </button>
                      </form>
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
              <div className="text-gray-700">Subtotaal</div>
              <div className="font-semibold">{formatMoney(subtotal, currency)}</div>
            </div>

            {/* Moneybird/Exact stijl: BTW % over grondslag = btw */}
            {vatBreakdown.filter((r) => r.rate !== 0).length > 0 ? (
              vatBreakdown
                .filter((r) => r.rate !== 0)
                .map((r) => (
                  <div key={r.rate} className="flex items-center justify-between">
                    <div className="text-gray-700">
                      BTW {r.rate}% over {formatMoney(r.base, currency)}
                    </div>
                    <div className="font-semibold">{formatMoney(r.vat, currency)}</div>
                  </div>
                ))
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-gray-700">BTW</div>
                <div className="font-semibold">{formatMoney(0, currency)}</div>
              </div>
            )}

            <div className="flex items-center justify-between text-base">
              <div className="font-bold">Totaal</div>
              <div className="font-bold">{formatMoney(total, currency)}</div>
            </div>

            {notices.length ? (
              <div className="mt-3 text-xs text-gray-600 space-y-1">
                {notices.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Notes / Footer */}
      {quote.notes ? (
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm font-semibold mb-2">Notities</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {quote.notes}
          </div>
        </div>
      ) : null}

      {footer ? (
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm font-semibold mb-2">Footer</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
