"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/app");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl">
        <h1 className="text-2xl font-bold mb-6 text-center">
          {mode === "login" ? "Inloggen" : "Account aanmaken"}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            className="w-full p-3 border rounded-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Wachtwoord"
            className="w-full p-3 border rounded-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}

          <button
            type="submit"
            className="w-full bg-black text-white p-3 rounded-lg hover:opacity-90 transition"
            disabled={loading}
          >
            {loading
              ? "Bezig..."
              : mode === "login"
              ? "Inloggen"
              : "Registreren"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          {mode === "login" ? (
            <>
              Geen account?{" "}
              <button
                onClick={() => setMode("register")}
                className="underline"
              >
                Registreer
              </button>
            </>
          ) : (
            <>
              Al een account?{" "}
              <button
                onClick={() => setMode("login")}
                className="underline"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
