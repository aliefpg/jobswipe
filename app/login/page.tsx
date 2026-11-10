"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
export default function LoginPage() {
  const supabase = createClient(), router = useRouter();
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const {error}=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(error){setError(error.message);return}router.replace("/");router.refresh()}
  return <main className="login panel stack"><div><div className="brand">Job<span>Swipe</span></div><p className="muted">Masuk untuk melanjutkan seleksi lowongan.</p></div><form onSubmit={submit} className="stack"><label className="stack">Email<input className="field" type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label className="stack">Password<input className="field" type="password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>{error&&<div className="error">{error}</div>}<button className="btn primary" disabled={busy}>{busy?"Memproses...":"Login"}</button></form></main>;
}
