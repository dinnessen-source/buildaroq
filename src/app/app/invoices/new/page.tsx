import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../../lib/supabase/server";

export default async function NewInvoicePage() {
  const sb = await supabaseServer();

  const { data: customers, error } = await sb
    .from("customers")
    .select("id,name")
    .order("created_at", { ascending: false });

  async function createInvoice(formData: FormData) {
    "use server";

    const sb2 = await supabaseServer();

    const {
      data: { user },
    } = await sb2.auth.getUser();

    if (!user) redirect("/login");

    const customer_id = String(formData.get("customer_id") || "");
    if (!customer_id) {
      throw new Error("Kies een klant.");
    }

    // 1) Payment terms ophalen (default 14)
    const { data: bs, error: bsErr } = await sb2
      .from("billing_settings")
      .select("payment_terms_days")
      .eq("user_id", user.id)
      .single();

    if (bsErr) {
      // niet hard falen, we vallen terug op 14
      console.warn("billing_settings load error (payment_terms_days):", bsErr.message);
    }

    const days = Number(bs?.payment_terms_days ?? 14);
    const safeDays = Number.isFinite(days) && days > 0 ? days : 14;

    // 2) due_date = vandaag + betaaltermijn
    const due = new Date();
    due.setDate(due.getDate() + safeDays);
    const due_date = due.toISOString().slice(0, 10); // YYYY-MM-DD

    // 3) Insert invoice (✅ draft zonder factuurnummer)
    const { data: inserted, error: insErr } = await sb2
      .from("invoices")
      .insert({
        user_id: user.id,
        customer_id,
        invoice_number: null, // ✅ nummer pas bij "sent"
        status: "draft",
        due_date,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("INVOICE INSERT ERROR:", insErr);
      throw new Error(insErr?.message ?? "Factuur aanmaken mislukt.");
    }

    redirect(`/app/invoices/${inserted.id}`);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link className="underline" href="/app/invoices">
          Terug
        </Link>
        <div className="p-6 rounded-2xl border bg-white">
          <div className="text-red-700 font-semibold">Fout</div>
          <div className="text-sm text-red-700 mt-2">{error.message}</div>
        </div>
      </div>
    );
  }

  const list = customers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Nieuwe factuur</h1>
          <p className="text-gray-600">Kies een klant en maak een draft factuur.</p>
        </div>

        <Link className="underline" href="/app/invoices">
          Terug
        </Link>
      </div>

      <form action={createInvoice} className="rounded-2xl border bg-white p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Klant</label>
          <select
            name="customer_id"
            className="w-full rounded-xl border px-3 py-2"
            defaultValue=""
          >
            <option value="" disabled>
              Selecteer een klant…
            </option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {list.length === 0 ? (
            <p className="text-sm text-gray-600 mt-2">
              Je hebt nog geen klanten. Maak eerst een klant aan.
            </p>
          ) : null}
        </div>

        <button
          disabled={list.length === 0}
          className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-50"
        >
          Factuur aanmaken
        </button>
      </form>
    </div>
  );
}