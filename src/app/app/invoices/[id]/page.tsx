import Link from "next/link";
import { notFound } from "next/navigation";
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
  due_date: string | null; // date (YYYY-MM-DD) komt vaak als string

  // ✅ nieuw: voor link naar offerte
  quote_id: string | null;
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
  vat_rate: number | null;
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

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: currency || "EUR",
  }).format(value);
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

  // due_date is YYYY-MM-DD; maak er een einde-van-dag van in lokale tijd
  const due = new Date(`${due_date}T23:59:59`);
  const now = new Date();
  return now > due;
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
    if (error) console.error("DELETE INVOICE ITEM ERROR:", error);

    revalidatePath(`/app/invoices/${id}`);
  }

  async function setStatus(formData: FormData) {
    "use server";
    const sb2 = await supabaseServer();

    const nextStatus = String(formData.get("status") || "") as InvoiceStatus;
    const allowed: InvoiceStatus[] = [
      "draft",
      "sent",
      "paid",
      "overdue",
      "cancelled",
    ];
    if (!allowed.includes(nextStatus)) return;

    const {
      data: { user: u },
    } = await sb2.auth.getUser();
    if (!u) return;

    const patch: {
  status: InvoiceStatus;
  paid_at?: string | null;
} = { status: nextStatus };

if (nextStatus === "paid") {
  patch.paid_at = new Date().toISOString();
} else {
  // draft/sent/overdue/cancelled -> paid_at leeg
  patch.paid_at = null;
}


    const { error } = await sb2.from("invoices").update(patch).eq("id", id);
    if (error) console.error("SET STATUS ERROR:", error);

    revalidatePath(`/app/invoices/${id}`);
  }

  // --- Data load ---
  const { data: invoiceRaw, error: invErr } = await sb
    .from("invoices")
    .select(
      "id,user_id,customer_id,invoice_number,status,due_date,created_at,notes,footer,currency,vat_rate,prices_include_vat,quote_id,quotes:quote_id ( id, quote_number )"
    )
    .eq("id", id)
    .single();

  if (invErr || !invoiceRaw) return notFound();
  if (invoiceRaw.user_id !== user.id) return notFound();

  // ✅ Join kan object of array zijn → pak hem veilig
  const quotesJoin = (invoiceRaw as any).quotes;
  const quoteNumberFromJoin = Array.isArray(quotesJoin)
    ? quotesJoin?.[0]?.quote_number ?? null
    : quotesJoin?.quote_number ?? null;

  // ✅ Fallback query als join geen nummer geeft
  let quoteNumberResolved: string | null = quoteNumberFromJoin;

  if ((invoiceRaw as any).quote_id && !quoteNumberResolved) {
    const { data: q } = await sb
      .from("quotes")
      .select("quote_number")
      .eq("id", (invoiceRaw as any).quote_id)
      .maybeSingle();

    quoteNumberResolved = q?.quote_number ?? null;
  }

  const invoice: Invoice = {
    ...invoiceRaw,
    vat_rate: (invoiceRaw as any).vat_rate === null ? null : toNumber((invoiceRaw as any).vat_rate),
    prices_include_vat: (invoiceRaw as any).prices_include_vat,
    due_date: (invoiceRaw as any).due_date ? String((invoiceRaw as any).due_date) : null,
    quote_id: (invoiceRaw as any).quote_id ?? null,
  };

  const { data: customerRaw } = await sb
    .from("customers")
    .select("name,email,phone,address")
    .eq("id", invoice.customer_id)
    .single();

  const customer: Customer | null = customerRaw ?? null;

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

  // Totals
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

  const footer = invoice.footer ?? billingSettings?.invoice_footer ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Factuur</div>
          <h1 className="text-2xl font-bold">{invoice.invoice_number}</h1>

          {/* ✅ “Gebaseerd op OFF-xxxx” */}
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
          </div>
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

{/* Niet meer versturen/betalen als cancelled */}
{invoice.status !== "cancelled" ? (
  <>
    <form action={setStatus}>
      <input type="hidden" name="status" value="sent" />
      <button
        type="submit"
        className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
      >
        Markeer als verstuurd
      </button>
    </form>

    <form action={setStatus}>
      <input type="hidden" name="status" value="paid" />
      <button
        type="submit"
        className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
      >
        Markeer als betaald
      </button>
    </form>
  </>
) : null}

{/* Annuleren kan alleen als nog niet paid en nog niet cancelled */}
{invoice.status !== "cancelled" && invoice.status !== "paid" ? (
  <form action={setStatus}>
    <input type="hidden" name="status" value="cancelled" />
    <button
      type="submit"
      className="px-4 py-2 rounded-xl border bg-red-50 text-red-700 hover:bg-red-100"
    >
      Annuleer factuur
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
            <div className="text-gray-700 whitespace-pre-wrap">
              {customer.address ?? "—"}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Klant niet gevonden.</div>
        )}
      </div>

      {/* Add item */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="text-sm font-semibold mb-3">Nieuwe regel</div>
        <AddInvoiceItemForm invoiceId={invoice.id} />
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

      {/* Notes */}
      {invoice.notes ? (
        <div className="rounded-2xl border bg-white p-6">
          <div className="text-sm font-semibold mb-2">Notities</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {invoice.notes}
          </div>
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
