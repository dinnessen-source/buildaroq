import Link from "next/link";
import { supabaseServer } from "../../../lib/supabase/server";
export default async function CustomersPage() {
  const sb = await supabaseServer();

  const { data, error } = await sb
    .from("customers")
    .select("id,name,email,phone,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="p-6 rounded-2xl border bg-white">
        <div className="text-red-700 font-semibold">Fout</div>
        <div className="text-sm text-red-700 mt-2">{error.message}</div>
      </div>
    );
  }

  const customers = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold underline">Klanten</h1>
          <p className="text-gray-600">Beheer je klanten.</p>
        </div>

        <Link
          href="/app/customers/new"
          className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
        >
          + Nieuwe klant
        </Link>
      </div>

      {customers.length === 0 ? (
        <div className="p-6 rounded-2xl border bg-white">
          <div className="font-bold">Nog geen klanten</div>
          <div className="text-gray-600 mt-1">Voeg je eerste klant toe.</div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left p-4">Naam</th>
                <th className="text-left p-4">Email</th>
                <th className="text-left p-4">Telefoon</th>
                <th className="text-left p-4">Acties</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: { id: string; name: string; email: string | null; phone: string | null }) => (
                <tr key={c.id} className="border-t">
                  <td className="p-4 font-semibold">{c.name}</td>
                  <td className="p-4 text-gray-700">{c.email ?? "—"}</td>
                  <td className="p-4 text-gray-700">{c.phone ?? "—"}</td>
                  <td className="p-4">
                    <Link className="underline" href={`/app/customers/${c.id}`}>
                      Bewerken
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
