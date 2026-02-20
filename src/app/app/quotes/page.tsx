import Link from "next/link";
import { supabaseServer } from "../../../lib/supabase/server";
import { QuotesFilters } from "./QuotesFilters";

import type { BilledFilter, QuoteStatus } from "./_lib/quoteFilters";
import { addOneDay, buildHref, clampIsoDate, parseBilled, parseStatus } from "./_lib/quoteFilters";

type QuoteRow = {
  id: string;
  quote_number: string;
  status: QuoteStatus;
  created_at: string;
  currency: string | null;
  customer_id: string | null;
};

type CustomerRow = { id: string; name: string | null };

type InvoiceLinkRow = {
  id: string;
  invoice_number: string | null;
  quote_id: string | null;
};

type QuoteItemRow = {
  quote_id: string;
  qty: number | string | null;
  unit_price: number | string | null;
  vat_type: string | null;
  vat_rate: number | string | null;
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatDateNL(iso: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatMoneyNL(amount: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(
    Number.isFinite(amount) ? amount : 0
  );
}

function isZeroVatType(vatType: string) {
  return (
    vatType === "NL_REVERSE_CHARGE" ||
    vatType === "EU_B2B_REVERSE_CHARGE" ||
    vatType === "NON_EU_OUTSIDE_SCOPE"
  );
}

function resolveVatRate(vatType: string, vatRate: unknown, defaultVatRate = 21) {
  if (isZeroVatType(vatType)) return 0;
  const r = toNumber(vatRate);
  if (Number.isFinite(r) && r >= 0) return r;
  if (vatType === "NL_9_WONING") return 9;
  return defaultVatRate;
}

function calcTotalFromItems(items: QuoteItemRow[]) {
  let subtotal = 0;
  let vatAmount = 0;

  for (const it of items) {
    const qty = toNumber(it.qty);
    const price = toNumber(it.unit_price);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

    const net = round2(qty * price);
    subtotal = round2(subtotal + net);

    const vatType = String(it.vat_type ?? "NL_21");
    const rate = resolveVatRate(vatType, it.vat_rate, 21);
    vatAmount = round2(vatAmount + round2(net * (rate / 100)));
  }

  return { subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const map = {
    draft: { label: "Concept", cls: "bg-zinc-100 text-zinc-700 border-zinc-200" },
    sent: { label: "Verzonden", cls: "bg-blue-50 text-blue-700 border-blue-100" },
    accepted: { label: "Geaccepteerd", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    declined: { label: "Afgewezen", cls: "bg-red-50 text-red-700 border-red-100" },
  } as const;

  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    billed?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};

  const q = (sp.q ?? "").trim();
  const status = parseStatus(sp.status);
  const billed = parseBilled(sp.billed);
  const from = clampIsoDate(String(sp.from ?? ""));
  const to = clampIsoDate(String(sp.to ?? ""));

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const PAGE_SIZE = 25;
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const basePath = "/app/quotes";
  const sb = await supabaseServer();

  // 1) Billed filter: quote_id’s uit invoices
  let billedQuoteIds: string[] | null = null;
  if (billed !== "all") {
    const { data: invRows, error: invErr } = await sb
      .from("invoices")
      .select("quote_id")
      .not("quote_id", "is", null);

    if (invErr) {
      return (
        <div className="p-6 rounded-2xl border bg-white">
          <div className="text-red-700 font-semibold">Fout</div>
          <div className="text-sm text-red-700 mt-2">{invErr.message}</div>
        </div>
      );
    }

    const set = new Set<string>();
    for (const r of (invRows ?? []) as Array<{ quote_id: string | null }>) {
      if (r.quote_id) set.add(r.quote_id);
    }
    billedQuoteIds = Array.from(set);
  }

  // 2) Search op klantnaam → customer ids
  let customerIdsFromSearch: string[] = [];
  if (q) {
    const { data: custIdsRaw } = await sb.from("customers").select("id").ilike("name", `%${q}%`).limit(50);
    customerIdsFromSearch = (custIdsRaw ?? []).map((x: { id: string }) => x.id);
  }

  // 3) Quotes query
  let quotesQuery = sb
    .from("quotes")
    .select("id,quote_number,status,created_at,currency,customer_id", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status !== "all") quotesQuery = quotesQuery.eq("status", status);

  if (from) quotesQuery = quotesQuery.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) {
    const next = addOneDay(to);
    if (next) quotesQuery = quotesQuery.lt("created_at", `${next}T00:00:00.000Z`);
  }

  if (q) {
    if (customerIdsFromSearch.length > 0) {
      const ids = customerIdsFromSearch.join(",");
      quotesQuery = quotesQuery.or(`quote_number.ilike.%${q}%,customer_id.in.(${ids})`);
    } else {
      quotesQuery = quotesQuery.ilike("quote_number", `%${q}%`);
    }
  }

  if (billed === "yes") {
    if (!billedQuoteIds || billedQuoteIds.length === 0) return renderEmpty(basePath, { q, status, billed, from, to });
    quotesQuery = quotesQuery.in("id", billedQuoteIds);
  }

  if (billed === "no") {
    if (billedQuoteIds && billedQuoteIds.length > 0) {
      const list = `(${billedQuoteIds.join(",")})`;
      quotesQuery = quotesQuery.not("id", "in", list);
    }
  }

  quotesQuery = quotesQuery.range(rangeFrom, rangeTo);

  const { data: quotesData, error: quotesError, count } = await quotesQuery;

  if (quotesError) {
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout</div>
        <div className="text-sm text-red-700 mt-2">{quotesError.message}</div>
      </div>
    );
  }

  const quotes = (quotesData ?? []) as QuoteRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  if (quotes.length === 0) return renderEmpty(basePath, { q, status, billed, from, to });

  const quoteIds = quotes.map((x) => x.id);
  const customerIds = Array.from(new Set(quotes.map((x) => x.customer_id).filter(Boolean) as string[]));

  // 4) Customers
  const customersById = new Map<string, CustomerRow>();
  if (customerIds.length > 0) {
    const { data: customersData } = await sb.from("customers").select("id,name").in("id", customerIds);
    for (const c of (customersData ?? []) as CustomerRow[]) customersById.set(c.id, c);
  }

  // 5) Invoice link
  const invoiceByQuoteId = new Map<string, { id: string; invoice_number: string | null }>();
  {
    const { data: invData } = await sb.from("invoices").select("id,invoice_number,quote_id").in("quote_id", quoteIds);
    for (const inv of (invData ?? []) as InvoiceLinkRow[]) {
      if (!inv.quote_id) continue;
      if (!invoiceByQuoteId.has(inv.quote_id)) {
        invoiceByQuoteId.set(inv.quote_id, { id: inv.id, invoice_number: inv.invoice_number ?? null });
      }
    }
  }

  // 6) Totals
  const totalsByQuoteId = new Map<string, { subtotal: number; vatAmount: number; total: number }>();
  {
    const { data: items, error: itemsErr } = await sb
      .from("quote_items")
      .select("quote_id,qty,unit_price,vat_type,vat_rate")
      .in("quote_id", quoteIds);

    if (!itemsErr && items) {
      const itemsByQuote = new Map<string, QuoteItemRow[]>();
      for (const it of items as QuoteItemRow[]) {
        if (!itemsByQuote.has(it.quote_id)) itemsByQuote.set(it.quote_id, []);
        itemsByQuote.get(it.quote_id)!.push(it);
      }
      for (const qid of quoteIds) totalsByQuoteId.set(qid, calcTotalFromItems(itemsByQuote.get(qid) ?? []));
    }
  }

  const hasActiveFilters = Boolean(q || status !== "all" || billed !== "all" || from || to || page !== 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold underline">Offertes</h1>
          <p className="text-gray-600">
            {totalCount} totaal {status !== "all" ? `• ${labelStatus(status)}` : ""}
            {billed !== "all" ? ` • ${billed === "yes" ? "gefactureerd" : "niet gefactureerd"}` : ""}
            {from || to ? " • periode" : ""}
          </p>
        </div>

        <Link href="/app/quotes/new" className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
          + Nieuwe offerte
        </Link>
      </div>

      {/* Live filters */}
      <QuotesFilters basePath={basePath} initialQ={q} initialStatus={status} initialBilled={billed} initialFrom={from} initialTo={to} />

      {/* Tabel */}
      <div className="rounded-2xl border overflow-hidden bg-white">
        <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3">
          <div className="text-sm text-gray-600">
            Pagina {page} van {totalPages} • {totalCount} resultaten
          </div>
          {hasActiveFilters ? (
            <Link href={basePath} className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900">
              Reset
            </Link>
          ) : (
            <div className="text-xs text-gray-500">—</div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr className="border-b align-top">
              <th className="text-left p-4 w-[32%]">
                <div className="font-bold">Offerte</div>
                <div className="text-xs text-gray-500 mt-1">Nummer + klant</div>
              </th>
              <th className="text-left p-4 w-[16%]">
                <div className="font-bold">Status</div>
              </th>
              <th className="text-left p-4 w-[22%]">
                <div className="font-bold">Aangemaakt</div>
              </th>
              <th className="text-right p-4 w-[12%]">
                <div className="font-bold">Totaal</div>
                <div className="text-xs text-gray-500 mt-1">(incl. BTW)</div>
              </th>
              <th className="text-left p-4 w-[12%]">
                <div className="font-bold">Factuur</div>
              </th>
              <th className="text-right p-4 w-[6%]">
                <div className="font-bold">Acties</div>
              </th>
            </tr>
          </thead>

          <tbody>
            {quotes.map((row) => {
              const customerName = (row.customer_id && customersById.get(row.customer_id)?.name) || "Onbekende klant";
              const currency = row.currency ?? "EUR";
              const totals = totalsByQuoteId.get(row.id) ?? { total: 0, subtotal: 0, vatAmount: 0 };
              const linked = invoiceByQuoteId.get(row.id) ?? null;

              return (
                <tr key={row.id} className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex flex-col">
                      <Link href={`/app/quotes/${row.id}`} className="font-semibold hover:underline">
                        {row.quote_number}
                      </Link>
                      <span className="mt-0.5 text-xs text-gray-500">{customerName}</span>
                    </div>
                  </td>

                  <td className="p-4">
                    <StatusBadge status={row.status} />
                  </td>

                  <td className="p-4 text-gray-700">{formatDateNL(row.created_at)}</td>

                  <td className="p-4 text-right font-medium">{formatMoneyNL(totals.total, currency)}</td>

                  <td className="p-4">
                    {linked ? (
                      <Link className="underline" href={`/app/invoices/${linked.id}`}>
                        {linked.invoice_number ?? "Open factuur"}
                      </Link>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>

                  {/* ✅ Acties */}
                  <td className="p-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      {/* ✅ PDF = gewone <a> (geen Next Link) */}
                      <a
                        href={`/app/quotes/${row.id}/pdf?v=${Date.now()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                      >
                        PDF
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t bg-white px-4 py-3">
          <div className="text-xs text-gray-500">
            Toon {quotes.length} van {totalCount}
          </div>

          <div className="flex items-center gap-2">
            <Link
              aria-disabled={page <= 1}
              className={`rounded-xl border px-3 py-1.5 text-sm ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
              href={buildHref(basePath, { q, status, billed, from, to, page: page - 1 })}
            >
              ← Vorige
            </Link>

            <Link
              aria-disabled={page >= totalPages}
              className={`rounded-xl border px-3 py-1.5 text-sm ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
              href={buildHref(basePath, { q, status, billed, from, to, page: page + 1 })}
            >
              Volgende →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelStatus(s: QuoteStatus) {
  if (s === "draft") return "Concept";
  if (s === "sent") return "Verzonden";
  if (s === "accepted") return "Geaccepteerd";
  return "Afgewezen";
}

function renderEmpty(
  basePath: string,
  params: { q: string; status: "all" | QuoteStatus; billed: BilledFilter; from: string; to: string }
) {
  const hasFilters = Boolean(params.q || params.status !== "all" || params.billed !== "all" || params.from || params.to);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Offertes</h1>
          <p className="text-gray-600">0 resultaten</p>
        </div>

        <Link href="/app/quotes/new" className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
          + Nieuwe offerte
        </Link>
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <div className="font-bold">Geen offertes</div>
        <div className="text-gray-600 mt-1">Geen offertes voor deze selectie.</div>

        {hasFilters ? (
          <div className="mt-4">
            <Link href={basePath} className="text-sm font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900">
              Reset filters
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}