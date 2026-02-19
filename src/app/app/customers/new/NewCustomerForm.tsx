"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../../../lib/supabase/browser";

export function NewCustomerForm() {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: userRes } = await sb.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setLoading(false);
      setError("Niet ingelogd.");
      return;
    }

    const { error } = await sb.from("customers").insert({
      user_id: user.id,
      name,
      email: email || null,
      phone: phone || null,
      address: address || null,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/app/customers");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="text-sm font-semibold">Naam *</label>
        <input
          className="mt-1 w-full p-3 rounded-xl border"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold">Email</label>
          <input
            className="mt-1 w-full p-3 rounded-xl border"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
        </div>
        <div>
          <label className="text-sm font-semibold">Telefoon</label>
          <input
            className="mt-1 w-full p-3 rounded-xl border"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold">Adres</label>
        <textarea
          className="mt-1 w-full p-3 rounded-xl border"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
        />
      </div>

      {error ? (
        <div className="p-3 rounded-xl border bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <button
        className="px-4 py-3 rounded-xl bg-black text-white hover:opacity-90 disabled:opacity-50"
        disabled={loading}
        type="submit"
      >
        {loading ? "Opslaan..." : "Klant opslaan"}
      </button>
    </form>
  );
}
