import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold underline">Document- bedrijfsinstellingen</h1>
        <p className="text-gray-600">Beheer je bedrijf en facturatie.</p>
      </div>

      <div className="rounded-2xl border bg-white p-6 space-y-3">
        <div className="font-semibold"></div>
        <Link className="underline" href="/app/settings/billing">
          Ga naar document en bedrijfsinstellingen →
        </Link>
      </div>
    </div>
  );
}
