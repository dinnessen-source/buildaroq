"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../../../lib/supabase/browser";

export function EditCustomerForm(props: {
  customer: { id: string; name: string; email: string | null; phone: string | null; address: string | null };
}) {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [name, setName] = useState(props.customer.name);
  const [email, setEmail] = useState(props.customer.email ?? "");
  const [phone, setPhone] = useState(props.customer.phone ?? "");
  const [address, setAddress] = useState(props.customer.address ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await sb
      .from("customers")
      .update({
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
      })
      .eq("id", props.customer.id);

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/app/customers");
    router.refresh();
  }

  async function remove() {
    if (!confirm("Klant verwijderen?")) return;

    setLoading(true);
    setError(null);

    const { error } = await sb.from("customers").delete().eq("id", props.customer.id);

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/app/customers");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="text-sm font-semibold">Naam *</label>
        <input className="mt-1 w-full p-3 rounded-xl border" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold">Email</label>
          <input className="mt-1 w-full p-3 rounded-xl border" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </div>
        <div>
          <label className="text-sm font-semibold">Telefoon</label>
          <input className="mt-1 w-full p-3 rounded-xl border" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold">Adres</label>
        <textarea className="mt-1 w-full p-3 rounded-xl border" value={address} onChange={(e) => setAddress(e.target.value)} rows={3} />
      </div>

      {error ? (
        <div className="p-3 rounded-xl border bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button className="px-4 py-3 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-50" disabled={loading} type="submit">
          {loading ? "Opslaan..." : "Opslaan"}
        </button>

        <button
          className="px-4 py-3 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
          disabled={loading}
          type="button"
          onClick={remove}
        >
          Verwijderen
        </button>
      </div>
    </form>
  );
}
