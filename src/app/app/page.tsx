import Link from "next/link";
import { supabaseServer } from "../../lib/supabase/server";

type InvoiceRow = {
  id: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  due_date: string | null;
  currency: string;
};

type InvoiceTotalsRow = {
  invoice_id: string;
  currency: string;
  prices_include_vat: boolean | null;
  vat_rate: number | string | null;
  subtotal: number | string | null;
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

function calcTotals(subtotal: number, vatRate: number, pricesIncludeVat: boolean) {
  if (subtotal <= 0) return { subtotal, vatAmount: 0, total: 0 };

  if (pricesIncludeVat) {
    const divisor = 1 + vatRate / 100;
    const net = subtotal / divisor;
    const vatAmount = subtotal - net;
    return { subtotal, vatAmount, total: subtotal };
  } else {
    const vatAmount = subtotal * (vatRate / 100);
    return { subtotal, vatAmount, total: subtotal + vatAmount };
  }
}

export default async function AppPage() {
  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  // 1) Overdue updaten in DB
  await sb.rpc("refresh_overdue_invoices");

  // 2) Basis counts
  const { count: overdueCount } = await sb
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("status", "overdue");

  const { count: openCount } = await sb
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .in("status", ["sent", "overdue"]);

  // 3) Betaald deze maand (paid_at)
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const { count: paidThisMonthCount } = await sb
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("status", "paid")
    .gte("paid_at", startOfMonth.toISOString())
    .lt("paid_at", nextMonth.toISOString());

  // 4) Haal relevante invoices + totals op om bedragen te kunnen rekenen
  const { data: invs } = await sb
    .from("invoices")
    .select("id,status,due_date,currency")
    .in("status", ["sent", "overdue", "paid"])
    .order("due_date", { ascending: true, nullsFirst: false });

  const invoices: InvoiceRow[] = (invs ?? []) as InvoiceRow[];

  const ids = invoices.map((i) => i.id);

  // Als er nog niets is, voorkom "in()" issues
  const { data: totalsRaw } =
    ids.length === 0
      ? { data: [] as any[] }
      : await sb
          .from("invoice_totals")
          .select("invoice_id,currency,prices_include_vat,vat_rate,subtotal")
          .in("invoice_id", ids);

  const totalsById = new Map<string, InvoiceTotalsRow>();
  for (const row of (totalsRaw ?? []) as InvoiceTotalsRow[]) {
    totalsById.set(row.invoice_id, row);
  }

  // 5) Bedragen optellen
  let openAmount = 0;
  let overdueAmount = 0;
  let paidThisMonthAmount = 0;

  for (const inv of invoices) {
    const t = totalsById.get(inv.id);
    const subtotal = toNumber(t?.subtotal ?? 0);
    const vatRate = toNumber(t?.vat_rate ?? 21);
    const pricesIncludeVat = !!t?.prices_include_vat;

    const { total } = calcTotals(subtotal, vatRate, pricesIncludeVat);

    if (inv.status === "sent") openAmount += total;
    if (inv.status === "overdue") {
      openAmount += total;
      overdueAmount += total;
    }
  }

  // Paid this month amount (filter op paid_at)
  // We doen dit apart, want hierboven pakten we paid invoices zonder paid_at filter.
  const { data: paidIdsRaw } = await sb
    .from("invoices")
    .select("id")
    .eq("status", "paid")
    .gte("paid_at", startOfMonth.toISOString())
    .lt("paid_at", nextMonth.toISOString());

  const paidIds = (paidIdsRaw ?? []).map((r: { id: string }) => r.id);

  if (paidIds.length > 0) {
    const { data: paidTotalsRaw } = await sb
      .from("invoice_totals")
      .select("invoice_id,prices_include_vat,vat_rate,subtotal")
      .in("invoice_id", paidIds);

    for (const row of (paidTotalsRaw ?? []) as InvoiceTotalsRow[]) {
      const subtotal = toNumber(row.subtotal ?? 0);
      const vatRate = toNumber(row.vat_rate ?? 21);
      const pricesIncludeVat = !!row.prices_include_vat;
      const { total } = calcTotals(subtotal, vatRate, pricesIncludeVat);
      paidThisMonthAmount += total;
    }
  }

  // 6) Valuta (MVP: 1 valuta, neem EUR fallback)
  const currency = invoices[0]?.currency ?? "EUR";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Openstaand bedrag */}
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm text-gray-600">Openstaand</div>
          <div className="mt-2 text-3xl font-bold">
            {formatMoney(openAmount, currency)}
          </div>
          <div className="mt-1 text-sm text-gray-600">{openCount ?? 0} facturen</div>
          <div className="mt-4">
            <Link className="underline" href="/app/invoices">
              Naar facturen
            </Link>
          </div>
        </div>

        {/* Te laat bedrag */}
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm text-gray-600">Te laat</div>
          <div className="mt-2 text-3xl font-bold">
            {formatMoney(overdueAmount, currency)}
          </div>
          <div className="mt-1 text-sm text-gray-600">{overdueCount ?? 0} facturen</div>
          <div className="mt-4">
            <Link className="underline" href="/app/invoices">
              Bekijk te laat
            </Link>
          </div>
        </div>

        {/* Betaald deze maand */}
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm text-gray-600">Betaald (deze maand)</div>
          <div className="mt-2 text-3xl font-bold">
            {formatMoney(paidThisMonthAmount, currency)}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {paidThisMonthCount ?? 0} facturen
          </div>
          <div className="mt-4">
            <Link className="underline" href="/app/invoices">
              Bekijk betalingen
            </Link>
          </div>
        </div>
      </div>

      {/* Welkom / shortcuts */}
      <div className="bg-white border rounded-2xl p-6">
        <h1 className="text-2xl font-bold">Welkom</h1>
        <p className="mt-2 text-gray-600">
          Je bent ingelogd als <b>{user?.email}</b>.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            className="p-4 rounded-2xl border bg-gray-50 hover:bg-gray-100"
            href="/app/customers"
          >
            <b>Klanten</b>
            <div className="text-sm text-gray-600">
              Voeg klanten toe en beheer gegevens.
            </div>
          </Link>

          <Link
            className="p-4 rounded-2xl border bg-gray-50 hover:bg-gray-100"
            href="/app/quotes"
          >
            <b>Offertes</b>
            <div className="text-sm text-gray-600">
              Maak offertes en download PDF.
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
