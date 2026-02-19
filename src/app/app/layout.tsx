import Link from "next/link";
import { supabaseServer } from "../../lib/supabase/server";
import { redirect } from "next/navigation";
import { LogoutButton } from "./LogoutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/app" className="font-black tracking-tight">BuildaroQ</Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/app" className="hover:underline">Dashboard</Link>
              <Link href="/app/customers" className="hover:underline">Klanten</Link>
              <Link href="/app/quotes" className="hover:underline">Offertes</Link>
              <Link href="/app/invoices" className="hover:underline">Facturen</Link>
              <Link href="/app/settings" className="hover:underline">Instellingen</Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 hidden sm:inline">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
