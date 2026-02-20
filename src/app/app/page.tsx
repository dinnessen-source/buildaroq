import Link from "next/link";
import { supabaseServer } from "../../lib/supabase/server";

type InvoiceRow = {
  id: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  due_date: string | null;
  currency: string;
};

type InvoiceItemRow = {
  invoice_id: string;
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

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR",
  }).format(Number.isFinite(value) ? value : 0);
}

function isZeroVatType(vatType: string) {
  return (
    vatType === "NL_REVERSE_CHARGE" ||
    vatType === "EU_B2B_REVERSE_CHARGE" ||
    vatType === "NON_EU_OUTSIDE_SCOPE"
  );
}

function resolveVatRate(vatType: string, vatRate: unknown) {
  if (isZeroVatType(vatType)) return 0;
  const r = toNumber(vatRate);
  if (Number.isFinite(r) && r >= 0) return r;
  if (vatType === "NL_9_WONING") return 9;
  return 21;
}

function calcInvoiceTotalFromItems(items: InvoiceItemRow[]) {
  let subtotal = 0;
  let vatAmount = 0;

  for (const it of items) {
    const qty = toNumber(it.qty);
    const price = toNumber(it.unit_price);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

    const net = round2(qty * price);
    subtotal = round2(subtotal + net);

    const vatType = String(it.vat_type ?? "NL_21");
    const rate = resolveVatRate(vatType, it.vat_rate);
    const vat = round2(net * (rate / 100));
    vatAmount = round2(vatAmount + vat);
  }

  return {
    subtotal,
    vatAmount,
    total: round2(subtotal + vatAmount),
  };
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

  // 4) Invoices ophalen (voor bedragen)
  const { data: invs } = await sb
    .from("invoices")
    .select("id,status,due_date,currency")
    .in("status", ["sent", "overdue", "paid"])
    .order("due_date", { ascending: true, nullsFirst: false });

  const invoices: InvoiceRow[] = (invs ?? []) as InvoiceRow[];
  const ids = invoices.map((i) => i.id);

  // 5) Haal alle items van die invoices op (per-regel btw)
  // NB: dit is correct bij gemixte tarieven; later kun je dit optimaliseren met een view.
  const { data: itemsRaw, error: itemsErr } =
    ids.length === 0
      ? { data: [] as any[], error: null as any }
      : await sb
          .from("invoice_items")
          .select("invoice_id,qty,unit_price,vat_type,vat_rate")
          .in("invoice_id", ids);

  if (itemsErr) {
    console.error("invoice_items load failed:", itemsErr.message);
  }

  const items = (itemsRaw ?? []) as InvoiceItemRow[];

  // group items by invoice_id
  const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
  for (const it of items) {
    const key = it.invoice_id;
    if (!itemsByInvoice.has(key)) itemsByInvoice.set(key, []);
    itemsByInvoice.get(key)!.push(it);
  }

  // 6) Bedragen optellen (open/overdue)
  let openAmount = 0;
  let overdueAmount = 0;

  for (const inv of invoices) {
    if (inv.status !== "sent" && inv.status !== "overdue") continue;

    const invItems = itemsByInvoice.get(inv.id) ?? [];
    const { total } = calcInvoiceTotalFromItems(invItems);

    openAmount = round2(openAmount + total);
    if (inv.status === "overdue") {
      overdueAmount = round2(overdueAmount + total);
    }
  }

  // 7) Betaald deze maand bedrag (paid_at filter)
  const { data: paidIdsRaw } = await sb
    .from("invoices")
    .select("id")
    .eq("status", "paid")
    .gte("paid_at", startOfMonth.toISOString())
    .lt("paid_at", nextMonth.toISOString());

  const paidIds = (paidIdsRaw ?? []).map((r: { id: string }) => r.id);

  let paidThisMonthAmount = 0;
  if (paidIds.length > 0) {
    // items van paid invoices (subset)
    const { data: paidItemsRaw, error: paidItemsErr } = await sb
      .from("invoice_items")
      .select("invoice_id,qty,unit_price,vat_type,vat_rate")
      .in("invoice_id", paidIds);

    if (paidItemsErr) {
      console.error("paid invoice_items load failed:", paidItemsErr.message);
    } else {
      const paidItems = (paidItemsRaw ?? []) as InvoiceItemRow[];
      const paidItemsByInvoice = new Map<string, InvoiceItemRow[]>();
      for (const it of paidItems) {
        if (!paidItemsByInvoice.has(it.invoice_id)) paidItemsByInvoice.set(it.invoice_id, []);
        paidItemsByInvoice.get(it.invoice_id)!.push(it);
      }

      for (const pid of paidIds) {
        const invItems = paidItemsByInvoice.get(pid) ?? [];
        const { total } = calcInvoiceTotalFromItems(invItems);
        paidThisMonthAmount = round2(paidThisMonthAmount + total);
      }
    }
  }

  // 8) Valuta (MVP: 1 valuta, neem EUR fallback)
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
          <div className="mt-1 text-sm text-gray-600">{paidThisMonthCount ?? 0} facturen</div>
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
            <div className="text-sm text-gray-600">Voeg klanten toe en beheer gegevens.</div>
          </Link>

          <Link
            className="p-4 rounded-2xl border bg-gray-50 hover:bg-gray-100"
            href="/app/quotes"
          >
            <b>Offertes</b>
            <div className="text-sm text-gray-600">Maak offertes en download PDF.</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
