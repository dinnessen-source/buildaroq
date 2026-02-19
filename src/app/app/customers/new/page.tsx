import Link from "next/link";
import { NewCustomerForm } from "./NewCustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Nieuwe klant</h1>
          <p className="text-gray-600">Voeg klantgegevens toe.</p>
        </div>
        <Link className="underline" href="/app/customers">
          Terug
        </Link>
      </div>

      <div className="rounded-2xl border bg-white p-6">
        <NewCustomerForm />
      </div>
    </div>
  );
}
