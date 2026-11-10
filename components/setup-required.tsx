"use client";

export default function SetupRequired() {
  return (
    <main className="login panel stack">
      <div className="brand">Job<span>Swipe</span></div>
      <h1>Konfigurasi Supabase belum tersedia</h1>
      <p className="muted">
        Website belum menerima URL dan key Supabase yang valid. Tambahkan
        Environment Variables di Vercel, lalu lakukan Redeploy.
      </p>
      <div className="notice">
        <strong>NEXT_PUBLIC_SUPABASE_URL</strong>
        <br />
        Contoh format: https://project-ref.supabase.co
        <br /><br />
        <strong>NEXT_PUBLIC_SUPABASE_ANON_KEY</strong>
        <br />
        Isi dengan Supabase Publishable Key (sb_publishable_...) atau legacy anon key.
      </div>
      <p className="muted">
        Vercel → Project → Settings → Environment Variables.
        Pastikan variabel aktif untuk Production.
      </p>
    </main>
  );
}
