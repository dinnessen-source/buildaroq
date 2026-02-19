import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../../lib/supabase/server";

export default async function NewQuotePage() {
  const sb = await supabaseServer();

  const { data: customers, error } = await sb
    .from("customers")
    .select("id,name")
    .order("created_at", { ascending: false });

async function createQuote(formData: FormData) {
  "use server";

  const sb2 = await supabaseServer();

  const {
    data: { user },
  } = await sb2.auth.getUser();

  if (!user) {
    return redirect("/login");
  }

  const customer_id = String(formData.get("customer_id") || "");
  if (!customer_id) {
    throw new Error("Kies een klant.");
  }

  const { data: quoteNumber, error: numErr } = await sb2.rpc("next_quote_number");
  if (numErr || !quoteNumber) {
    console.error("RPC next_quote_number error:", numErr);
    throw new Error(numErr?.message ?? "Kon geen offertenummer genereren.");
  }

  const { data: inserted, error: insErr } = await sb2
    .from("quotes")
    .insert({
      user_id: user.id,
      customer_id,
      quote_number: quoteNumber,
      status: "draft",
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("QUOTE INSERT ERROR:", insErr);
    throw new Error(insErr?.message ?? "Offerte aanmaken mislukt.");
  }

  redirect(`/app/quotes/${inserted.id}`);
}


  if (error) {
    return (
      <div className="space-y-4">
        <Link className="underline" href="/app/quotes">
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
          <h1 className="text-2xl font-bold">Nieuwe offerte</h1>
          <p className="text-gray-600">Kies een klant en maak een draft offerte.</p>
        </div>

        <Link className="underline" href="/app/quotes">
          Terug
        </Link>
      </div>

      <form action={createQuote} className="rounded-2xl border bg-white p-6 space-y-4">
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
          Offerte aanmaken
        </button>
      </form>
    </div>
  );
}
