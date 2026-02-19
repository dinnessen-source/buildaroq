import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <h1 className="text-4xl font-bold mb-4">BuildaroQ</h1>
      <p className="text-gray-600 mb-8">
        Slimme offertes & facturatie voor harde werkers.
      </p>

      <div className="flex gap-4">
        <Link
          href="/login"
          className="px-6 py-3 rounded-xl bg-black text-white hover:opacity-90"
        >
          Inloggen
        </Link>

        <Link
          href="/app"
          className="px-6 py-3 rounded-xl border hover:bg-gray-50"
        >
          Naar dashboard
        </Link>
      </div>
    </main>
  );
}
