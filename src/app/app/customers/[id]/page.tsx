import Link from "next/link";
import { supabaseServer } from "../../../../lib/supabase/server";
import { EditCustomerForm } from "./EditCustomerForm";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sb = await supabaseServer();

  const { data: customer, error } = await sb
    .from("customers")
    .select("id,name,email,phone,address")
    .eq("id", id)
    .single();

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <Link className="underline" href="/app/customers">
          Terug
        </Link>
        <div className="p-4 rounded-xl border bg-red-50 text-red-700">
          Klant niet gevonden of geen toegang.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Klant bewerken</h1>
          <p className="text-gray-600">{customer.name}</p>
        </div>
        <Link className="underline" href="/app/customers">
          Terug
        </Link>
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <EditCustomerForm customer={customer} />
      </div>
    </div>
  );
}
