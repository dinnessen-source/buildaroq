import Link from "next/link";
import { supabaseServer } from "../../../lib/supabase/server";
import { InvoicesFilters } from "./InvoicesFilters";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  created_at: string;
  due_date: string | null;
  quote_id: string | null;
};

function isOverdue(inv: InvoiceRow) {
  if (inv.status === "paid" || inv.status === "cancelled") return false;
  if (!inv.due_date) return false;
  const due = new Date(`${inv.due_date}T23:59:59`);
  return new Date() > due;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const { status, source } = await searchParams;

  const sb = await supabaseServer();

  // optioneel: overdue refresh
  await sb.rpc("refresh_overdue_invoices");

  let query = sb
    .from("invoices")
    .select("id,invoice_number,status,created_at,due_date,quote_id")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  // --- STATUS FILTER ---
  if (status && status !== "all") {
    if (status === "open") {
      query = query.in("status", ["sent", "overdue"]);
    } else if (
      ["draft", "sent", "paid", "overdue", "cancelled"].includes(status)
    ) {
      query = query.eq("status", status);
    }
  }

  // --- SOURCE FILTER ---
  if (source === "quote") {
    query = query.not("quote_id", "is", null);
  } else if (source === "manual") {
    query = query.is("quote_id", null);
  }

  const { data, error } = await query;

  if (error) {
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout</div>
        <div className="text-sm text-red-700 mt-2">{error.message}</div>
      </div>
    );
  }

  const invoices: InvoiceRow[] = (data ?? []) as InvoiceRow[];

  // --- helper om links correct te bouwen ---
  function hrefWith(next: { status?: string; source?: string }) {
    const sp = new URLSearchParams();

    const s = next.status ?? status ?? "all";
    const so = next.source ?? source ?? "all";

    if (s && s !== "all") sp.set("status", s);
    if (so && so !== "all") sp.set("source", so);

    const qs = sp.toString();
    return qs ? `/app/invoices?${qs}` : "/app/invoices";
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturen</h1>
          <p className="text-gray-600">Beheer je facturen.</p>
        </div>

        <Link
          href="/app/invoices/new"
          className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
        >
          + Nieuwe factuur
        </Link>
      </div>

      {/* STATUS FILTER */}
      <div className="rounded-2xl border bg-white p-4">
        <InvoicesFilters
          status={status ?? "all"}
          source={source ?? "all"}
        />
      </div>

      {/* SOURCE FILTER */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          className={`rounded-full border px-3 py-1 text-sm ${
            !source || source === "all"
              ? "bg-black text-white border-black"
              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
          }`}
          href={hrefWith({ source: "all" })}
        >
          Alle
        </Link>

        <Link
          className={`rounded-full border px-3 py-1 text-sm ${
            source === "quote"
              ? "bg-black text-white border-black"
              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
          }`}
          href={hrefWith({ source: "quote" })}
        >
          Van offerte
        </Link>

        <Link
          className={`rounded-full border px-3 py-1 text-sm ${
            source === "manual"
              ? "bg-black text-white border-black"
              : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
          }`}
          href={hrefWith({ source: "manual" })}
        >
          Losse facturen
        </Link>
      </div>

      {/* TABLE */}
      {invoices.length === 0 ? (
        <div className="p-6 rounded-2xl border bg-white">
          <div className="font-bold">Geen facturen gevonden</div>
          <div className="text-gray-600 mt-1">
            Pas je filter aan of maak een factuur.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-4">Factuur</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Aangemaakt</th>
                <th className="text-left p-4">Vervaldatum</th>
                <th className="text-left p-4">Bron</th>
                <th className="text-left p-4">Acties</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const overdue = isOverdue(inv);
                const displayStatus = overdue ? "overdue" : inv.status;

                return (
                  <tr key={inv.id} className="border-t">
                    <td className="p-4 font-semibold">
                      {inv.invoice_number}
                    </td>

                    <td className="p-4">
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                          displayStatus === "cancelled"
                            ? "bg-zinc-100 text-zinc-800"
                            : displayStatus === "overdue"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {displayStatus}
                      </span>
                    </td>

                    <td className="p-4 text-gray-700">
                      {new Date(inv.created_at).toLocaleDateString("nl-NL")}
                    </td>

                    <td
                      className={`p-4 ${
                        overdue
                          ? "text-red-600 font-semibold"
                          : "text-gray-700"
                      }`}
                    >
                      {inv.due_date
                        ? new Date(
                            `${inv.due_date}T00:00:00`
                          ).toLocaleDateString("nl-NL")
                        : "—"}
                    </td>

                    <td className="p-4 text-sm text-gray-600">
                      {inv.quote_id ? "Offerte" : "Handmatig"}
                    </td>

                    <td className="p-4">
                      <Link
                        className="underline"
                        href={`/app/invoices/${inv.id}`}
                      >
                        Open
                      </Link>
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
