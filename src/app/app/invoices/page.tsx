import Link from "next/link";
import { supabaseServer } from "../../../lib/supabase/server";
import { InvoicesFilters } from "./InvoicesFilters";

import type { SourceFilter, StatusFilter, InvoiceStatus } from "./_lib/invoiceFilters";
import { addOneDay, buildHref, clampIsoDate, parseSource, parseStatus } from "./_lib/invoiceFilters";

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  created_at: string;
  due_date: string | null;
  quote_id: string | null;
  customer_id: string; // ✅ nodig voor handmatige invoices
};

type CustomerRow = { id: string; name: string | null };

function formatDateNL(iso: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateOnlyNL(date: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const map = {
    draft: { label: "Concept", cls: "bg-zinc-100 text-zinc-700 border-zinc-200" },
    sent: { label: "Verstuurd", cls: "bg-blue-50 text-blue-700 border-blue-100" },
    paid: { label: "Betaald", cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    overdue: { label: "Te laat", cls: "bg-red-50 text-red-700 border-red-100" },
    cancelled: { label: "Geannuleerd", cls: "bg-zinc-100 text-zinc-800 border-zinc-200" },
  } as const;

  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    source?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};

  const q = (sp.q ?? "").trim();
  const status = parseStatus(sp.status);
  const source = parseSource(sp.source);
  const from = clampIsoDate(String(sp.from ?? ""));
  const to = clampIsoDate(String(sp.to ?? ""));

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const PAGE_SIZE = 25;
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const basePath = "/app/invoices";
  const sb = await supabaseServer();

  // optioneel: overdue refresh
  await sb.rpc("refresh_overdue_invoices");

  let query = sb
    .from("invoices")
    .select("id,invoice_number,status,created_at,due_date,quote_id,customer_id", { count: "exact" }) // ✅ customer_id
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Status filter
  if (status !== "all") {
    if (status === "open") query = query.in("status", ["sent", "overdue"]);
    else query = query.eq("status", status);
  }

  // Bron filter
  if (source === "quote") query = query.not("quote_id", "is", null);
  if (source === "manual") query = query.is("quote_id", null);

  // Datum filter (op created_at)
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) {
    const next = addOneDay(to);
    if (next) query = query.lt("created_at", `${next}T00:00:00.000Z`);
  }

  // --- Search: factuurnummer OF klantnaam (manual + quote) ---
  if (q) {
    // 1) customer ids op naam
    const { data: custIdsRaw } = await sb.from("customers").select("id").ilike("name", `%${q}%`).limit(50);
    const customerIds = (custIdsRaw ?? []).map((x: { id: string }) => x.id);

    // 2) quote ids bij die klanten
    let quoteIdsFromCustomers: string[] = [];
    if (customerIds.length > 0) {
      const { data: quoteIdsRaw } = await sb.from("quotes").select("id").in("customer_id", customerIds).limit(200);
      quoteIdsFromCustomers = (quoteIdsRaw ?? []).map((x: { id: string }) => x.id);
    }

    // 3) OR filter bouwen
    const orParts: string[] = [];
    orParts.push(`invoice_number.ilike.%${q}%`);

    if (customerIds.length > 0) {
      // ✅ manual invoices: customer_id match
      orParts.push(`customer_id.in.(${customerIds.join(",")})`);
    }

    if (quoteIdsFromCustomers.length > 0) {
      // ✅ quote-based invoices: quote_id match
      orParts.push(`quote_id.in.(${quoteIdsFromCustomers.join(",")})`);
    }

    query = query.or(orParts.join(","));
  }

  query = query.range(rangeFrom, rangeTo);

  const { data, error, count } = await query;

  if (error) {
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout</div>
        <div className="text-sm text-red-700 mt-2">{error.message}</div>
      </div>
    );
  }

  const invoices: InvoiceRow[] = (data ?? []) as InvoiceRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasActiveFilters = Boolean(q || status !== "all" || source !== "all" || from || to || page !== 1);

  // ---- Klantnamen voor alle invoices (manual + quote) ----
  const customerNameByInvoiceId = new Map<string, string>();

  // ✅ 1) Direct customer_id uit invoice (werkt voor manual én quote)
  const customerIdsAll = Array.from(new Set(invoices.map((x) => x.customer_id).filter(Boolean)));
  if (customerIdsAll.length > 0) {
    const { data: customers } = await sb.from("customers").select("id,name").in("id", customerIdsAll);
    const customersById = new Map<string, CustomerRow>();
    for (const c of (customers ?? []) as CustomerRow[]) customersById.set(c.id, c);

    for (const inv of invoices) {
      const name = customersById.get(inv.customer_id)?.name ?? null;
      if (name) customerNameByInvoiceId.set(inv.id, name);
    }
  }

  if (invoices.length === 0) {
    return renderEmpty(basePath, { q, status, source, from, to });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold underline">Facturen</h1>
          <p className="text-gray-600">
            {totalCount} totaal
            {status !== "all" ? ` • ${labelStatus(status)}` : ""}
            {source !== "all" ? ` • ${source === "quote" ? "van offerte" : "handmatig"}` : ""}
            {from || to ? " • periode" : ""}
          </p>
        </div>

        <Link href="/app/invoices/new" className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
          + Nieuwe factuur
        </Link>
      </div>

      {/* Filters */}
      <InvoicesFilters basePath={basePath} initialQ={q} initialStatus={status} initialSource={source} initialFrom={from} initialTo={to} />

      {/* Table */}
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
          <thead className="bg-gray-50 text-gray-700 border-b">
            <tr className="align-top">
              <th className="text-left p-4 w-[30%]">
                <div className="font-bold">Factuur</div>
                <div className="text-xs text-gray-500 mt-1">Nummer + klant</div>
              </th>

              <th className="text-left p-4 w-[14%]">
                <div className="font-bold">Status</div>
              </th>

              <th className="text-left p-4 w-[18%]">
                <div className="font-bold">Aangemaakt</div>
              </th>

              <th className="text-left p-4 w-[18%]">
                <div className="font-bold">Vervaldatum</div>
              </th>

              <th className="text-left p-4 w-[10%]">
                <div className="font-bold">Bron</div>
              </th>

              <th className="text-right p-4 w-[10%]">
                <div className="font-bold">Acties</div>
              </th>
            </tr>
          </thead>

          <tbody>
            {invoices.map((inv) => {
              const customerName =
                customerNameByInvoiceId.get(inv.id) ??
                "—";

              return (
                <tr key={inv.id} className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex flex-col">
                      <Link href={`/app/invoices/${inv.id}`} className="font-semibold hover:underline">
                        {inv.invoice_number ?? "Concept"}
                      </Link>
                      <span className="mt-0.5 text-xs text-gray-500">{customerName}</span>
                    </div>
                  </td>

                  <td className="p-4">
                    <StatusBadge status={inv.status} />
                  </td>

                  <td className="p-4 text-gray-700">{formatDateNL(inv.created_at)}</td>

                  <td className="p-4 text-gray-700">{inv.due_date ? formatDateOnlyNL(inv.due_date) : "—"}</td>

                  <td className="p-4 text-sm text-gray-600">{inv.quote_id ? "Offerte" : "Handmatig"}</td>

                  <td className="p-4 text-right">
                    <a
                      href={`/app/invoices/${inv.id}/pdf?v=${Date.now()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-white"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t bg-white px-4 py-3">
          <div className="text-xs text-gray-500">Toon {invoices.length} van {totalCount}</div>

          <div className="flex items-center gap-2">
            <Link
              aria-disabled={page <= 1}
              className={`rounded-xl border px-3 py-1.5 text-sm ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
              href={buildHref(basePath, { q, status, source, from, to, page: page - 1 })}
            >
              ← Vorige
            </Link>

            <Link
              aria-disabled={page >= totalPages}
              className={`rounded-xl border px-3 py-1.5 text-sm ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
              href={buildHref(basePath, { q, status, source, from, to, page: page + 1 })}
            >
              Volgende →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelStatus(s: StatusFilter) {
  if (s === "open") return "Open";
  if (s === "draft") return "Concept";
  if (s === "sent") return "Verstuurd";
  if (s === "paid") return "Betaald";
  if (s === "overdue") return "Te laat";
  if (s === "cancelled") return "Geannuleerd";
  return "Alle";
}

function renderEmpty(
  basePath: string,
  params: { q: string; status: StatusFilter; source: SourceFilter; from: string; to: string }
) {
  const hasFilters = Boolean(params.q || params.status !== "all" || params.source !== "all" || params.from || params.to);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturen</h1>
          <p className="text-gray-600">0 resultaten</p>
        </div>

        <Link href="/app/invoices/new" className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
          + Nieuwe factuur
        </Link>
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <div className="font-bold">Geen facturen</div>
        <div className="text-gray-600 mt-1">Geen facturen voor deze selectie.</div>

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