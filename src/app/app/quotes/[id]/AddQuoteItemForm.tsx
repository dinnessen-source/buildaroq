"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../../../lib/supabase/browser";

export function AddQuoteItemForm({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const desc = description.trim();
    const qtyNum = Number(qty);
    const priceNum = Number(unitPrice);

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

    const {
      data: { user },
      error: userErr,
    } = await sb.auth.getUser();

    if (userErr || !user) {
      setError("Niet ingelogd.");
      setLoading(false);
      return;
    }

    const { error: insErr } = await sb.from("quote_items").insert({
      user_id: user.id,
      quote_id: quoteId,
      description: desc,
      qty: qtyNum,
      unit: unit.trim() || null,
      unit_price: priceNum,
    });

    if (insErr) {
      setError(insErr.message);
      setLoading(false);
      return;
    }

    // reset
    setDescription("");
    setQty("1");
    setUnit("");
    setUnitPrice("0");
    setLoading(false);

    // refresh server component data
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error ? (
        <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-6">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Omschrijving
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bijv. Installatie groepenkast"
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

        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Prijs
          </label>
          <input
            className="w-full rounded-xl border px-3 py-2 text-right"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            inputMode="decimal"
          />
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
