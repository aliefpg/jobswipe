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
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (loginError || !data.user) {
      setBusy(false);
      setError(loginError?.message ?? "Login gagal. Periksa email dan password.");
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    setBusy(false);
    if (profileError) {
      setError(`Login berhasil, tetapi role akun gagal dibaca: ${profileError.message}`);
      return;
    }
    if (profile?.role === "admin") {
      router.replace("/admin");
      router.refresh();
      return;
    }
    if (profile?.role === "reviewer") {
      router.replace("/review");
      router.refresh();
      return;
    }
    setError("Profil akun belum memiliki role admin/reviewer. Minta Admin memeriksa tabel profiles di Supabase.");
  }

  return (
    <main className="login panel stack">
      <div><div className="brand">Job<span>Swipe</span></div><p className="muted">Masuk untuk melanjutkan seleksi lowongan.</p></div>
      <form onSubmit={submit} className="stack">
        <label className="stack">Email<input className="field" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="stack">Password<input className="field" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? "Memproses..." : "Login"}</button>
      </form>
    </main>
  );
}
