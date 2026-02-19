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
  vat_rate: number | null;
  prices_include_vat: boolean | null;
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
  unit_price: number;
  vat_rate: number | null;
};

type BillingSettings = {
  currency: string;
  default_vat_rate: number;
  prices_include_vat: boolean;
  quote_footer: string | null;
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR",
  }).format(value);
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

  // extra safety (RLS zou dit al doen)
  if (quote.user_id !== user.id) return notFound();

  // 2) Customer
  const { data: customerRaw } = await sb
    .from("customers")
    .select("id,name,email,phone,address")
    .eq("id", quote.customer_id)
    .single();

  const customer: Customer | null = customerRaw ?? null;

  // ✅ Bestaat er al een factuur voor deze offerte?
  const { data: linkedInvoice } = await sb
    .from("invoices")
    .select("id, invoice_number")
    .eq("quote_id", quote.id)
    .maybeSingle();

  // 3) Items
  const { data: itemsRaw, error: itemsErr } = await sb
    .from("quote_items")
    .select("id,description,qty,unit,unit_price,vat_rate")
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
  const pricesIncludeVat =
    quote.prices_include_vat ?? billingSettings?.prices_include_vat ?? false;

  // 5) Totals (MVP: 1 vat rate)
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.unit_price, 0);

  let vatAmount = 0;
  let total = 0;

  if (pricesIncludeVat) {
    const divisor = 1 + defaultVatRate / 100;
    const net = subtotal / divisor;
    vatAmount = subtotal - net;
    total = subtotal;
  } else {
    vatAmount = subtotal * (defaultVatRate / 100);
    total = subtotal + vatAmount;
  }

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

          {/* ✅ Als er al een factuur is: toon link */}
          {linkedInvoice?.id ? (
            <Link
              href={`/app/invoices/${linkedInvoice.id}`}
              className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
            >
              Gefactureerd: {linkedInvoice.invoice_number ?? "Open factuur"}
            </Link>
          ) : null}

          {/* ✅ Alleen tonen als accepted en nog niet gefactureerd */}
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
            BTW: {defaultVatRate}% •{" "}
            {pricesIncludeVat ? "prijzen incl. BTW" : "prijzen excl. BTW"}
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
              <div className="text-gray-700">
                {pricesIncludeVat ? "Subtotaal (incl.)" : "Subtotaal"}
              </div>
              <div className="font-semibold">{formatMoney(subtotal, currency)}</div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-gray-700">BTW ({defaultVatRate}%)</div>
              <div className="font-semibold">{formatMoney(vatAmount, currency)}</div>
            </div>

            <div className="flex items-center justify-between text-base">
              <div className="font-bold">Totaal</div>
              <div className="font-bold">{formatMoney(total, currency)}</div>
            </div>
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
