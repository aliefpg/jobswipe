"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Stats = { total: number; pending: number; taken: number; rejected: number };

type Job = {
  id: string;
  title: string;
  company_name: string;
  location_label: string;
  salary_label: string;
  job_description: string;
  claim_until: string;
};

export default function Reviewer({ email }: { email: string }) {
  const supabase = createClient();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, taken: 0, rejected: 0 });
  const pointerStartX = useRef<number | null>(null);

  const refreshStats = useCallback(async () => {
    const { data, error: statsError } = await supabase.rpc("reviewer_job_stats");
    if (statsError) {
      setError(`Gagal memuat statistik. Jalankan supabase/optimization.sql di Supabase: ${statsError.message}`);
      return;
    }
    if (data?.[0]) setStats(data[0] as Stats);
  }, [supabase]);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError("");

    const [{ data, error: claimError }] = await Promise.all([
      supabase.rpc("claim_next_job"),
      refreshStats()
    ]);

    if (claimError) {
      setError(claimError.message);
      setJob(null);
    } else {
      const rows = data as Job[] | null;
      setJob(rows?.[0] ?? null);
    }

    if (showLoader) setLoading(false);
  }, [refreshStats, supabase]);

  const decide = useCallback(async (decision: "taken" | "rejected") => {
    if (!job || busy) return;

    setBusy(true);
    setError("");

    const { error: reviewError } = await supabase.rpc("review_job", {
      p_job_id: job.id,
      p_decision: decision
    });

    setBusy(false);

    if (reviewError) {
      setError(reviewError.message);
      await load();
      return;
    }

    setDone((count) => count + 1);
    await load(false);
  }, [busy, job, load, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") void decide("taken");
      if (event.key === "ArrowLeft") void decide("rejected");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decide]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="shell">
      <header className="top">
        <div>
          <div className="brand">Job<span>Swipe</span></div>
          <div className="muted">Reviewer · {email}</div>
        </div>
        <button className="btn secondary" onClick={logout}>Logout</button>
      </header>

      <div className="row spread">
        <div>
          <h2>Seleksi Lowongan</h2>
          <p className="muted">Geser kanan untuk ambil, kiri untuk buang.</p>
        </div>
        <span className="pill">Diproses sesi ini: {done}</span>
      </div>

      <section className="grid" aria-label="Statistik lowongan">
        {[
          ["Total Lowongan", stats.total],
          ["Belum Direview", stats.pending],
          ["Diambil", stats.taken],
          ["Dibuang", stats.rejected]
        ].map(([label, value]) => (
          <div className="panel stat" key={String(label)}>
            <span className="muted">{label}</span>
            <strong>{Number(value).toLocaleString("id-ID")}</strong>
          </div>
        ))}
      </section>
      <p className="muted" style={{ fontSize: 13 }}>
        Progress review: {stats.total ? Math.round(((stats.taken + stats.rejected) / stats.total) * 100) : 0}% selesai
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <div className="panel">Memuat lowongan berikutnya...</div>
      ) : job ? (
        <>
          <article
            className="job-card"
            onPointerDown={(event) => {
              pointerStartX.current = event.clientX;
            }}
            onPointerUp={(event) => {
              if (pointerStartX.current === null) return;
              const distance = event.clientX - pointerStartX.current;
              pointerStartX.current = null;
              if (Math.abs(distance) > 90) {
                void decide(distance > 0 ? "taken" : "rejected");
              }
            }}
            onPointerCancel={() => {
              pointerStartX.current = null;
            }}
          >
            <span className="pill">LOWONGAN BERIKUTNYA</span>
            <h1>{job.title}</h1>
            <strong>{job.company_name || "Perusahaan tidak dicantumkan"}</strong>
            <div className="row muted" style={{ marginTop: 14 }}>
              <span>📍 {job.location_label || "Lokasi tidak tersedia"}</span>
              <span>💰 {job.salary_label || "Gaji tidak dicantumkan"}</span>
            </div>
            <div className="description">
              {job.job_description || "Tidak ada deskripsi pekerjaan."}
            </div>
          </article>

          <div className="swipe-actions">
            <button
              className="action danger"
              disabled={busy}
              onClick={() => void decide("rejected")}
            >
              ← Buang
            </button>
            <button
              className="action success"
              disabled={busy}
              onClick={() => void decide("taken")}
            >
              Ambil →
            </button>
          </div>
          <p className="muted" style={{ textAlign: "center", fontSize: 13 }}>
            Shortcut keyboard: ← buang · → ambil
          </p>
        </>
      ) : (
        <div className="panel" style={{ textAlign: "center", padding: 50 }}>
          <h2>Antrean selesai atau sedang kosong</h2>
          <p className="muted">
            Tidak ada lowongan yang tersedia untuk diseleksi saat ini.
          </p>
          <button className="btn secondary" onClick={() => void load()}>
            Periksa lagi
          </button>
        </div>
      )}
    </main>
  );
}
