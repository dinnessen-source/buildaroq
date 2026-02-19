"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../lib/supabase/browser";

export function LogoutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        const sb = supabaseBrowser();
        await sb.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
    >
      Logout
    </button>
  );
}
