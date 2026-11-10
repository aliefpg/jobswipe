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
type ReviewResult = { job: Job | null; stats: Stats };

const emptyStats: Stats = { total: 0, pending: 0, taken: 0, rejected: 0 };

export default function Reviewer({ email }: { email: string }) {
  const supabase = createClient();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [swipeDirection, setSwipeDirection] = useState<"taken" | "rejected" | null>(null);
  const pointerStartX = useRef<number | null>(null);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError("");
    const [claimResult, statsResult, undoStatusResult] = await Promise.all([
      supabase.rpc("claim_next_job"),
      supabase.rpc("reviewer_job_stats"),
      supabase.rpc("reviewer_can_undo")
    ]);
    if (!undoStatusResult.error) setCanUndo(Boolean(undoStatusResult.data));

    if (statsResult.error) {
      setError(`Gagal memuat statistik. Pastikan SQL optimasi sudah dijalankan: ${statsResult.error.message}`);
    } else if (statsResult.data?.[0]) {
      setStats(statsResult.data[0] as Stats);
    }

    if (claimResult.error) {
      setError(claimResult.error.message);
      setJob(null);
    } else {
      const rows = claimResult.data as Job[] | null;
      setJob(rows?.[0] ?? null);
    }
    if (showLoader) setLoading(false);
  }, [supabase]);

  const decide = useCallback(async (decision: "taken" | "rejected") => {
    if (!job || busy) return;
    const currentJob = job;
    setBusy(true);
    setError("");
    setSwipeDirection(decision);

    // One database round-trip: save the decision, claim the next job, and return fresh stats.
    let { data, error: reviewError } = await supabase.rpc("review_and_claim_next_job", {
      p_job_id: currentJob.id,
      p_decision: decision
    });

    // Compatibility: if the combined RPC has not been installed yet, use
    // the original review_job + claim_next_job + reviewer_job_stats RPCs.
    const missingCombinedRpc =
      reviewError?.code === "PGRST202" ||
      reviewError?.code === "42883" ||
      /review_and_claim_next_job.*(not found|does not exist|schema cache)/i.test(reviewError?.message ?? "");

    if (reviewError && missingCombinedRpc) {
      const legacyReview = await supabase.rpc("review_job", {
        p_job_id: currentJob.id,
        p_decision: decision
      });

      if (!legacyReview.error) {
        const [nextResult, statsResult] = await Promise.all([
          supabase.rpc("claim_next_job"),
          supabase.rpc("reviewer_job_stats")
        ]);

        if (nextResult.error) {
          reviewError = nextResult.error;
        } else if (statsResult.error) {
          reviewError = statsResult.error;
        } else {
          data = {
            job: (nextResult.data as Job[] | null)?.[0] ?? null,
            stats: (statsResult.data as Stats[] | null)?.[0] ?? emptyStats
          };
          reviewError = null;
        }
      } else {
        reviewError = legacyReview.error;
      }
    }

    if (reviewError) {
      setSwipeDirection(null);
      setBusy(false);
      setError(`Pilihan belum berhasil disimpan: ${reviewError.message}`);
      await load(false);
      return;
    }

    const result = data as ReviewResult;
    setDone((count) => count + 1);
    setCanUndo(true);
    if (result?.stats) setStats(result.stats);
    setJob(result?.job ?? null);
    setSwipeDirection(null);
    setBusy(false);
  }, [busy, job, load, supabase]);

  const undo = useCallback(async () => {
    if (busy || !canUndo) return;
    setBusy(true);
    setError("");
    const { data, error: undoError } = await supabase.rpc("undo_last_review");
    if (undoError) {
      setBusy(false);
      setError(undoError.message);
      return;
    }
    const result = data as ReviewResult;
    setJob(result?.job ?? null);
    if (result?.stats) setStats(result.stats);
    setDone((count) => Math.max(0, count - 1));
    setCanUndo(false);
    setSwipeDirection(null);
    setBusy(false);
  }, [busy, canUndo, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") void decide("taken");
      if (event.key === "ArrowLeft") void decide("rejected");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decide, undo]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.replace("/login");
  }

  const reviewed = stats.taken + stats.rejected;
  const progress = stats.total > 0 ? Math.min(100, Math.round((reviewed / stats.total) * 100)) : 0;

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
        <span className="pill">Sesi ini: {done.toLocaleString("id-ID")}</span>
      </div>

      <section className="grid reviewer-stats" aria-label="Statistik lowongan">
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

      <section className="panel progress-panel" aria-label="Progress review">
        <div className="row spread progress-heading">
          <strong>Progress Review</strong>
          <strong>{progress}%</strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Persentase lowongan selesai direview"
        >
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="row spread muted progress-caption">
          <span>{reviewed.toLocaleString("id-ID")} selesai direview</span>
          <span>{stats.total.toLocaleString("id-ID")} total lowongan</span>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <div className="panel loading-card"><span className="spinner" /> Menyiapkan antrean lowongan...</div>
      ) : job ? (
        <>
          <article
            className={`job-card${swipeDirection ? ` swipe-${swipeDirection}` : ""}`}
            onPointerDown={(event) => { pointerStartX.current = event.clientX; }}
            onPointerUp={(event) => {
              if (pointerStartX.current === null) return;
              const distance = event.clientX - pointerStartX.current;
              pointerStartX.current = null;
              if (Math.abs(distance) > 90) void decide(distance > 0 ? "taken" : "rejected");
            }}
            onPointerCancel={() => { pointerStartX.current = null; }}
          >
            <span className="pill">LOWONGAN BERIKUTNYA</span>
            <h1>{job.title}</h1>
            <strong>{job.company_name || "Perusahaan tidak dicantumkan"}</strong>
            <div className="row muted job-meta">
              <span>📍 {job.location_label || "Lokasi tidak tersedia"}</span>
              <span>💰 {job.salary_label || "Gaji tidak dicantumkan"}</span>
            </div>
            <div className="description">{job.job_description || "Tidak ada deskripsi pekerjaan."}</div>
            {busy && <div className="saving-indicator"><span className="spinner" /> Menyimpan pilihan...</div>}
          </article>

          <div className="swipe-actions">
            <button className="btn secondary" disabled={busy || !canUndo} onClick={() => void undo()} title="Batalkan pilihan terakhir (Ctrl+Z)">↶ Undo</button>
            <button className="action danger" disabled={busy} onClick={() => void decide("rejected")}>
              ← Buang
            </button>
            <button className="action success" disabled={busy} onClick={() => void decide("taken")}>
              Ambil →
            </button>
          </div>
          <p className="muted shortcut-hint">Shortcut: ← buang · → ambil · Ctrl+Z undo pilihan terakhir</p>
        </>
      ) : (
        <div className="panel empty-state">
          <h2>Antrean selesai atau sedang kosong</h2>
          <p className="muted">Tidak ada lowongan yang tersedia untuk diseleksi saat ini.</p>
          <button className="btn secondary" onClick={() => void load()} disabled={loading}>Periksa lagi</button>
        </div>
      )}
    </main>
  );
}
