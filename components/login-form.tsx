"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const supabase = createClient();
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    setBusy(false);
    if (loginError) {
      setError(loginError.message);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login panel stack">
      <div>
        <div className="brand">Job<span>Swipe</span></div>
        <p className="muted">Masuk untuk melanjutkan seleksi lowongan.</p>
      </div>
      <form onSubmit={submit} className="stack">
        <label className="stack">
          Email
          <input
            className="field"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="stack">
          Password
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Memproses..." : "Login"}
        </button>
      </form>
    </main>
  );
}
