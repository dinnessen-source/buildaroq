export default function BillingForm({
  profile,
  billing,
  errMsg,
  okMsg,
}: any) {
  return (
    <form
      action="/app/settings/billing/save"
      method="post"
      encType="multipart/form-data"
      className="rounded-2xl border bg-white p-6 space-y-8"
    >
      {errMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errMsg}
        </div>
      )}

      {okMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      )}

      {/* ================= LOGO ================= */}
      <div>
        <label className="block text-sm font-semibold mb-2">Offerte logo</label>

        <input
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="w-full rounded-xl border px-3 py-2"
        />

        <p className="text-xs text-gray-500 mt-1">PNG / JPG / WebP – max 2MB</p>

        {billing?.logo_path && (
          <>
            <p className="text-xs text-gray-600 mt-2">
              Huidig: <span className="font-mono">{billing.logo_path}</span>
            </p>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="remove_logo" value="1" />
              Geen logo gebruiken (verwijder huidig logo)
            </label>
          </>
        )}
      </div>

      {/* ================= CONTACT ================= */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1">Bedrijfsnaam</label>
          <input
            name="company_name"
            defaultValue={profile?.company_name ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Bedrijfsmail</label>
          <input
            name="company_email"
            defaultValue={profile?.company_email ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Telefoon</label>
          <input
            name="phone"
            defaultValue={profile?.phone ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">IBAN</label>
          <input
            name="iban"
            defaultValue={billing?.iban ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>
      </div>

      {/* ================= ADRES ================= */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1">Adres regel 1</label>
          <input
            name="address_line1"
            defaultValue={profile?.address_line1 ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Adres regel 2</label>
          <input
            name="address_line2"
            defaultValue={profile?.address_line2 ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Postcode</label>
          <input
            name="postal_code"
            defaultValue={profile?.postal_code ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Plaats</label>
          <input
            name="city"
            defaultValue={profile?.city ?? ""}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-semibold mb-1">Land</label>
          <input
            name="country"
            defaultValue={profile?.country ?? "NL"}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>
      </div>

      {/* ================= FINANCIEEL ================= */}
      <div className="grid gap-4 md:grid-cols-2">
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
          <label className="block text-sm font-semibold mb-1">Standaard BTW %</label>
          <input
            name="default_vat_rate"
            defaultValue={(billing?.default_vat_rate ?? 21).toString()}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>
      </div>

      {/* ================= FOOTERS ================= */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1">
            Offerte footer (onderaan offerte PDF)
          </label>
          <textarea
            name="quote_footer"
            defaultValue={billing?.quote_footer ?? ""}
            className="w-full rounded-xl border px-3 py-2 min-h-[120px]"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">
            Factuur footer (onderaan factuur PDF)
          </label>
          <textarea
            name="invoice_footer"
            defaultValue={billing?.invoice_footer ?? ""}
            className="w-full rounded-xl border px-3 py-2 min-h-[120px]"
          />
        </div>
      </div>

      <button
        type="submit"
        className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
      >
        Opslaan
      </button>
    </form>
  );
}