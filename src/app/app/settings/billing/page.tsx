import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../../lib/supabase/server";

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

export default async function BillingSettingsPage() {
  const sb = await supabaseServer();

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await sb
    .from("profiles")
    .select(
      "company_name,company_email,phone,address_line1,address_line2,postal_code,city,country,vat_number,chamber_of_commerce"
    )
    .eq("id", user.id)
    .single();

  const { data: billing } = await sb
    .from("billing_settings")
    .select(
      "currency,default_vat_rate,prices_include_vat,quote_footer,iban,invoice_footer,payment_terms_days"
    )
    .eq("user_id", user.id)
    .single();

  async function save(formData: FormData) {
    "use server";

    const sb2 = await supabaseServer();
    const {
      data: { user: u },
    } = await sb2.auth.getUser();

    if (!u) redirect("/login");

    // profile
    const company_name = String(formData.get("company_name") || "").trim();
    const company_email =
      String(formData.get("company_email") || "").trim() || null;
    const phone = String(formData.get("phone") || "").trim() || null;

    const address_line1 =
      String(formData.get("address_line1") || "").trim() || null;
    const address_line2 =
      String(formData.get("address_line2") || "").trim() || null;
    const postal_code =
      String(formData.get("postal_code") || "").trim() || null;
    const city = String(formData.get("city") || "").trim() || null;
    const country = String(formData.get("country") || "").trim() || "NL";

    const vat_number = String(formData.get("vat_number") || "").trim() || null;
    const chamber_of_commerce =
      String(formData.get("chamber_of_commerce") || "").trim() || null;

    // billing
    const currency = String(formData.get("currency") || "EUR").trim() || "EUR";
    const default_vat_rate = toNumber(formData.get("default_vat_rate"));
    const prices_include_vat = formData.get("prices_include_vat") === "on";

    const payment_terms_days = Number(
      formData.get("payment_terms_days") ?? 14
    );

    const quote_footer =
      String(formData.get("quote_footer") || "").trim() || null;
    const invoice_footer =
      String(formData.get("invoice_footer") || "").trim() || null;

    const iban = String(formData.get("iban") || "").trim() || null;

    // profiles: PK is id = user.id
    const { error: pErr } = await sb2.from("profiles").upsert(
      {
        id: u.id,
        company_name: company_name || null,
        company_email,
        phone,
        address_line1,
        address_line2,
        postal_code,
        city,
        country,
        vat_number,
        chamber_of_commerce,
      },
      { onConflict: "id" }
    );

    if (pErr) throw new Error(pErr.message);

    // billing_settings: PK is user_id
    const { error: bErr } = await sb2.from("billing_settings").upsert(
      {
        user_id: u.id,
        currency,
        default_vat_rate: Number.isFinite(default_vat_rate)
          ? default_vat_rate
          : 21,
        prices_include_vat,
        payment_terms_days: Number.isFinite(payment_terms_days)
          ? payment_terms_days
          : 14,
        quote_footer,
        invoice_footer,
        iban,
      },
      { onConflict: "user_id" }
    );

    if (bErr) throw new Error(bErr.message);

    redirect("/app/settings/billing");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturatie instellingen</h1>
          <p className="text-gray-600">Deze info komt in je PDF (“Van”).</p>
        </div>

        <Link className="underline" href="/app/settings">
          Terug
        </Link>
      </div>

      <form action={save} className="rounded-2xl border bg-white p-6 space-y-6">
        {/* Contact + betaal */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Bedrijfsnaam
            </label>
            <input
              name="company_name"
              defaultValue={profile?.company_name ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="BuildaroQ Installaties"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Bedrijfsmail
            </label>
            <input
              name="company_email"
              defaultValue={profile?.company_email ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="info@..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Telefoon</label>
            <input
              name="phone"
              defaultValue={profile?.phone ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="+31..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              IBAN
            </label>
            <input
              name="iban"
              defaultValue={billing?.iban ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="NL.."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Betaaltermijn (dagen)
            </label>
            <input
              name="payment_terms_days"
              defaultValue={(billing?.payment_terms_days ?? 14).toString()}
              className="w-full rounded-xl border px-3 py-2"
              inputMode="numeric"
              placeholder="14"
            />
          </div>
        </div>

        {/* Adres */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Adres regel 1
            </label>
            <input
              name="address_line1"
              defaultValue={profile?.address_line1 ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Straat 1"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Adres regel 2
            </label>
            <input
              name="address_line2"
              defaultValue={profile?.address_line2 ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Toevoeging"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Postcode</label>
            <input
              name="postal_code"
              defaultValue={profile?.postal_code ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="1234 AB"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Plaats</label>
            <input
              name="city"
              defaultValue={profile?.city ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Amsterdam"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Land</label>
            <input
              name="country"
              defaultValue={profile?.country ?? "NL"}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="NL"
            />
          </div>
        </div>

        {/* Bedrijfsgegevens */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1">
              BTW nummer
            </label>
            <input
              name="vat_number"
              defaultValue={profile?.vat_number ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="NL..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">KvK</label>
            <input
              name="chamber_of_commerce"
              defaultValue={profile?.chamber_of_commerce ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="..."
            />
          </div>
        </div>

        {/* Financieel */}
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Valuta</label>
            <select
              name="currency"
              defaultValue={billing?.currency ?? "EUR"}
              className="w-full rounded-xl border px-3 py-2"
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Standaard BTW %
            </label>
            <input
              name="default_vat_rate"
              defaultValue={(billing?.default_vat_rate ?? 21).toString()}
              className="w-full rounded-xl border px-3 py-2"
              inputMode="decimal"
            />
          </div>

          <div className="flex items-center gap-2 pt-7 md:col-span-2">
            <input
              id="prices_include_vat"
              name="prices_include_vat"
              type="checkbox"
              defaultChecked={!!billing?.prices_include_vat}
              className="h-4 w-4"
            />
            <label htmlFor="prices_include_vat" className="text-sm font-semibold">
              Prijzen incl. BTW
            </label>
          </div>
        </div>

        {/* Footers */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Offerte footer
            </label>
            <textarea
              name="quote_footer"
              defaultValue={billing?.quote_footer ?? ""}
              className="w-full rounded-xl border px-3 py-2 min-h-[120px]"
              placeholder="Bijv. Dank voor je aanvraag..."
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Factuur footer
            </label>
            <textarea
              name="invoice_footer"
              defaultValue={billing?.invoice_footer ?? ""}
              className="w-full rounded-xl border px-3 py-2 min-h-[120px]"
              placeholder="Bijv. Gelieve binnen 14 dagen te betalen..."
            />
          </div>
        </div>

        <button className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
          Opslaan
        </button>
      </form>
    </div>
  );
}
