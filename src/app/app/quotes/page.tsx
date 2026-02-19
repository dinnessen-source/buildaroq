import Link from "next/link";
import { supabaseServer } from "../../../lib/supabase/server";

type QuoteRow = {
  id: string;
  quote_number: string;
  status: "draft" | "sent" | "accepted" | "declined";
  created_at: string;
  customer_id: string | null;
  currency: string | null;
  prices_include_vat: boolean | null;
  vat_rate: number | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
};

type QuoteItemRow = {
  quote_id: string;
  qty: number;
  unit_price: number;
};

type InvoiceLinkRow = {
  id: string;
  invoice_number: string | null;
  quote_id: string | null;
};

function formatDateNL(iso: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatMoneyNL(amount: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(amount);
}

function computeTotal({
  subtotal,
  vatRate,
  pricesIncludeVat,
}: {
  subtotal: number;
  vatRate: number;
  pricesIncludeVat: boolean;
}) {
  if (pricesIncludeVat) return subtotal;
  return subtotal + subtotal * (vatRate / 100);
}

function StatusBadge({ status }: { status: QuoteRow["status"] }) {
  const map = {
    draft: { label: "Concept", cls: "bg-zinc-100 text-zinc-700 border-zinc-200" },
    sent: { label: "Verzonden", cls: "bg-blue-50 text-blue-700 border-blue-100" },
    accepted: {
      label: "Geaccepteerd",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-100",
    },
    declined: { label: "Afgewezen", cls: "bg-red-50 text-red-700 border-red-100" },
  } as const;

  const { label, cls } = map[status];

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function BilledBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700">
      Gefactureerd
    </span>
  );
}

function buildHref(basePath: string, params: { billed?: "all" | "yes" | "no"; q?: string }) {
  const sp = new URLSearchParams();
  if (params.billed && params.billed !== "all") sp.set("billed", params.billed);
  if (params.q && params.q.trim()) sp.set("q", params.q.trim());
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ billed?: string; q?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const billedParam = sp.billed;
  const billed: "all" | "yes" | "no" =
    billedParam === "yes" ? "yes" : billedParam === "no" ? "no" : "all";

  const sb = await supabaseServer();

  // 1) Quotes
  const { data: quotesData, error: quotesError } = await sb
    .from("quotes")
    .select("id,quote_number,status,created_at,customer_id,currency,prices_include_vat,vat_rate")
    .order("created_at", { ascending: false });

  if (quotesError) {
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout</div>
        <div className="text-sm text-red-700 mt-2">{quotesError.message}</div>
      </div>
    );
  }

  const quotesAll = (quotesData ?? []) as unknown as QuoteRow[];

  // 2) Customers
  const customerIds = Array.from(
    new Set(quotesAll.map((q2) => q2.customer_id).filter(Boolean) as string[])
  );

  const customersById = new Map<string, CustomerRow>();

  if (customerIds.length > 0) {
    const { data: customersData, error: customersError } = await sb
      .from("customers")
      .select("id,name")
      .in("id", customerIds);

    if (!customersError && customersData) {
      for (const c of customersData as CustomerRow[]) customersById.set(c.id, c);
    }
  }

  // 3) Totals
  const quoteIds = quotesAll.map((q2) => q2.id);
  const totalsByQuoteId = new Map<string, number>();

  if (quoteIds.length > 0) {
    const { data: items, error: itemsError } = await sb
      .from("quote_items")
      .select("quote_id, qty, unit_price")
      .in("quote_id", quoteIds);

    if (!itemsError && items) {
      for (const it of items as QuoteItemRow[]) {
        const qty = Number(it.qty ?? 0);
        const price = Number(it.unit_price ?? 0);
        totalsByQuoteId.set(it.quote_id, (totalsByQuoteId.get(it.quote_id) ?? 0) + qty * price);
      }
    }
  }

  // 4) Invoice links (via quote_id)
  const invoiceByQuoteId = new Map<string, { id: string; invoice_number: string | null }>();

  if (quoteIds.length > 0) {
    const { data: invData, error: invErr } = await sb
      .from("invoices")
      .select("id,invoice_number,quote_id")
      .in("quote_id", quoteIds);

    if (!invErr && invData) {
      for (const inv of invData as InvoiceLinkRow[]) {
        if (!inv.quote_id) continue;
        if (!invoiceByQuoteId.has(inv.quote_id)) {
          invoiceByQuoteId.set(inv.quote_id, {
            id: inv.id,
            invoice_number: inv.invoice_number ?? null,
          });
        }
      }
    }
  }

  // 5) Filter: billed + search
  let quotes = quotesAll;

  if (billed === "yes") quotes = quotes.filter((x) => invoiceByQuoteId.has(x.id));
  if (billed === "no") quotes = quotes.filter((x) => !invoiceByQuoteId.has(x.id));

  if (q) {
    const qLower = q.toLowerCase();
    quotes = quotes.filter((row) => {
      const customerName =
        (row.customer_id && customersById.get(row.customer_id)?.name) || "Onbekende klant";
      return (
        (row.quote_number ?? "").toLowerCase().includes(qLower) ||
        (customerName ?? "").toLowerCase().includes(qLower)
      );
    });
  }

  const basePath = "/app/quotes";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Offertes</h1>
          <p className="text-gray-600">Beheer je offertes.</p>
        </div>

        <Link
          href="/app/quotes/new"
          className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
        >
          + Nieuwe offerte
        </Link>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form className="flex items-center gap-2">
          <input type="hidden" name="billed" value={billed === "all" ? "" : billed} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Zoek op offertenummer of klant…"
            className="w-full sm:w-96 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <button
            type="submit"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Zoek
          </button>
          {q ? (
            <Link
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              href={buildHref(basePath, { billed })}
            >
              Reset
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildHref(basePath, { billed: "all", q })}
            className={`rounded-full border px-3 py-1 text-sm ${
              billed === "all"
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Alle
          </Link>

          <Link
            href={buildHref(basePath, { billed: "yes", q })}
            className={`rounded-full border px-3 py-1 text-sm ${
              billed === "yes"
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Gefactureerd
          </Link>

          <Link
            href={buildHref(basePath, { billed: "no", q })}
            className={`rounded-full border px-3 py-1 text-sm ${
              billed === "no"
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            Niet gefactureerd
          </Link>
        </div>
      </div>

      {quotes.length === 0 ? (
        <div className="p-6 rounded-2xl border bg-white">
          <div className="font-bold">Geen offertes</div>
          <div className="text-gray-600 mt-1">Geen offertes voor deze selectie.</div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-600">{quotes.length} offertes</div>
            <div className="text-xs text-gray-500">Status • klant • totaal</div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-white text-gray-700">
              <tr className="border-b">
                <th className="text-left p-4">Offerte</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Aangemaakt</th>
                <th className="text-right p-4">Totaal</th>
                <th className="text-left p-4">Factuur</th>
                <th className="text-right p-4">Acties</th>
              </tr>
            </thead>

            <tbody>
              {quotes.map((q2) => {
                const customerName =
                  (q2.customer_id && customersById.get(q2.customer_id)?.name) || "Onbekende klant";

                const currency = q2.currency ?? "EUR";
                const vatRate = Number(q2.vat_rate ?? 0);
                const pricesIncludeVat = Boolean(q2.prices_include_vat);

                const subtotal = totalsByQuoteId.get(q2.id) ?? 0;
                const total = computeTotal({ subtotal, vatRate, pricesIncludeVat });

                const linked = invoiceByQuoteId.get(q2.id) ?? null;

                return (
                  <tr key={q2.id} className="border-t hover:bg-gray-50">
                    <td className="p-4">
                      <div className="flex flex-col">
                        <Link
                          href={`/app/quotes/${q2.id}`}
                          className="font-semibold hover:underline"
                        >
                          {q2.quote_number}
                        </Link>
                        <span className="mt-0.5 text-xs text-gray-500">{customerName}</span>
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={q2.status} />
                        {linked ? <BilledBadge /> : null}
                      </div>
                    </td>

                    <td className="p-4 text-gray-700">{formatDateNL(q2.created_at)}</td>

                    <td className="p-4 text-right font-medium">
                      {formatMoneyNL(total, currency)}
                    </td>

                    <td className="p-4">
                      {linked ? (
                        <Link className="underline" href={`/app/invoices/${linked.id}`}>
                          {linked.invoice_number ?? "Open factuur"}
                        </Link>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>

                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                          href={`/app/quotes/${q2.id}`}
                        >
                          Open
                        </Link>
                        <Link
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                          href={`/app/quotes/${q2.id}/pdf`}
                        >
                          PDF
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
