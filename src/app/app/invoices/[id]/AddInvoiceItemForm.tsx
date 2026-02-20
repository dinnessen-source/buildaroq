"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../../../lib/supabase/browser";

type VatType =
  | "NL_21"
  | "NL_9_WONING"
  | "NL_REVERSE_CHARGE"
  | "EU_B2B_REVERSE_CHARGE"
  | "NON_EU_OUTSIDE_SCOPE"
  | "FOREIGN_LOCAL_VAT";

const VAT_OPTIONS: Array<{
  value: VatType;
  label: string;
  rate: number; // percentage (NL btw op de regel)
  hint?: string;
}> = [
  { value: "NL_21", label: "NL 21% btw", rate: 21 },
  { value: "NL_9_WONING", label: "NL 9% btw (woning > 2 jaar)", rate: 9 },
  { value: "NL_REVERSE_CHARGE", label: "NL btw verlegd (bouw/onderaanneming)", rate: 0 },
  { value: "EU_B2B_REVERSE_CHARGE", label: "EU B2B btw verlegd (ICP)", rate: 0 },
  { value: "NON_EU_OUTSIDE_SCOPE", label: "Buiten EU: plaats van dienst buiten NL", rate: 0 },
  { value: "FOREIGN_LOCAL_VAT", label: "Buitenlands lokaal btw-tarief (handmatig)", rate: 0 },
];

function defaultVatRateForType(vatType: VatType): number {
  return VAT_OPTIONS.find((o) => o.value === vatType)?.rate ?? 21;
}

export function AddInvoiceItemForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("0");

  const [vatType, setVatType] = useState<VatType>("NL_21");
  const [vatRate, setVatRate] = useState<string>("21"); // string ivm input

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onChangeVatType(next: VatType) {
    setVatType(next);
    const suggested = defaultVatRateForType(next);
    setVatRate(String(suggested));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const desc = description.trim();
    const qtyNum = Number(qty);
    const priceNum = Number(unitPrice);

    const vatRateNum = Number(vatRate);

    if (!desc) {
      setError("Omschrijving is verplicht.");
      setLoading(false);
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Aantal moet groter zijn dan 0.");
      setLoading(false);
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Prijs moet 0 of hoger zijn.");
      setLoading(false);
      return;
    }

    // vatRate is vooral nodig voor NL 9/21 en voor FOREIGN_LOCAL_VAT.
    // Voor verlegd/outside-scope is 0 logisch (maar je mag ’m nog overrulen als je wilt).
    if (!Number.isFinite(vatRateNum) || vatRateNum < 0) {
      setError("BTW % moet 0 of hoger zijn.");
      setLoading(false);
      return;
    }

    const {
      data: { user },
      error: userErr,
    } = await sb.auth.getUser();

    if (userErr || !user) {
      setError("Niet ingelogd.");
      setLoading(false);
      return;
    }

    const { error: insErr } = await sb.from("invoice_items").insert({
      user_id: user.id,
      invoice_id: invoiceId,
      description: desc,
      qty: qtyNum,
      unit: unit.trim() || null,
      unit_price: priceNum,

      // nieuw:
      vat_type: vatType,
      vat_rate: vatRateNum,
    });

    if (insErr) {
      setError(insErr.message);
      setLoading(false);
      return;
    }

    setDescription("");
    setQty("1");
    setUnit("");
    setUnitPrice("0");
    setVatType("NL_21");
    setVatRate("21");
    setLoading(false);

    router.refresh();
  }

  const showManualVatRate = vatType === "FOREIGN_LOCAL_VAT";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error ? (
        <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Omschrijving
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bijv. Arbeid schilderwerk / Materiaal"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Aantal
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2 text-right"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Unit
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="st/uur"
          />
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Prijs (excl.)
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2 text-right"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div className="md:col-span-7">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            BTW type
          </label>
          <select
            className="w-full rounded-xl border px-3 py-2"
            value={vatType}
            onChange={(e) => onChangeVatType(e.target.value as VatType)}
          >
            {VAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-5">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            BTW % {showManualVatRate ? "(handmatig)" : "(auto)"}
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2 text-right"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            inputMode="decimal"
            disabled={!showManualVatRate && (vatType === "NL_REVERSE_CHARGE" || vatType === "EU_B2B_REVERSE_CHARGE" || vatType === "NON_EU_OUTSIDE_SCOPE")}
            title={
              showManualVatRate
                ? "Vul lokaal btw-percentage in"
                : "Wordt automatisch gezet"
            }
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Tip: voor “verlegd” en “buiten EU plaats van dienst” is dit meestal 0%.
          </p>
        </div>
      </div>

      <button
        disabled={loading}
        className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-50"
      >
        + Regel toevoegen
      </button>
    </form>
  );
}
