"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/browser";
export default function TestPage() {
  const [status, setStatus] = useState("loading...");

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { error } = await sb.auth.getSession();
      setStatus(error ? "error: " + error.message : "ok ✅ supabase connected");
    })();
  }, []);

  return <div style={{ padding: 24, fontFamily: "system-ui" }}>{status}</div>;
}
