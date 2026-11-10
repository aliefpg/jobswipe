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

function formatDescription(raw: string) {
  const normalized = (raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[–—]/g, "-")
    .replace(/\s+Job Desc\s*:/gi, "\nJob Desc:")
    .replace(/\s+Requirement\s*:/gi, "\nRequirement:")
    .replace(/\s+Persyaratan\s*:/gi, "\nPersyaratan:");

  const sections: { heading: string; items: string[] }[] = [];
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(Requirement|Persyaratan|Job Desc|Deskripsi Pekerjaan)\s*:\s*/i);
    let heading = "Deskripsi";
    let body = line;

    if (match) {
      heading = /^requirement$/i.test(match[1]) ? "Requirement"
        : /^persyaratan$/i.test(match[1]) ? "Persyaratan"
        : /^job desc$/i.test(match[1]) ? "Job Description"
        : "Deskripsi Pekerjaan";
      body = line.slice(match[0].length);
    }

    // Source Excel commonly stores list entries as " - item - item".
    const items = body
      .split(/\s+-\s+/)
      .map((part) => part.replace(/^\s*[-•]\s*/, "").trim())
      .filter(Boolean);

    if (!items.length) continue;
    const existing = sections.find((section) => section.heading === heading);
    if (existing) existing.items.push(...items);
    else sections.push({ heading, items });
  }

  if (!sections.length) {
    const fallback = normalized.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    sections.push({ heading: "Deskripsi Pekerjaan", items: fallback.length ? fallback : [raw] });
  }

  return sections;
}

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

    // Re-check the remaining history. Keep Undo enabled while older
    // decisions still exist for this reviewer.
    const { data: undoAvailable, error: undoStatusError } =
      await supabase.rpc("reviewer_can_undo");
    if (!undoStatusError) {
      setCanUndo(Boolean(undoAvailable));
    } else {
      // Avoid disabling Undo just because the status refresh failed.
      setCanUndo(true);
    }

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
  const descriptionSections = job ? formatDescription(job.job_description || "") : [];

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

      <section
        className="panel progress-panel"
        aria-label="Progress review"
        style={{ padding: "20px 24px", borderRadius: 18, display: "grid", gap: 12 }}
      >
        <div className="row spread progress-heading" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <strong style={{ display: "block", fontSize: 16 }}>Progress Review</strong>
            <span className="muted" style={{ fontSize: 14 }}>
              {reviewed.toLocaleString("id-ID")} dari {stats.total.toLocaleString("id-ID")} lowongan selesai
            </span>
          </div>
          <strong style={{ fontSize: 22, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{progress}%</strong>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Persentase lowongan selesai direview"
          style={{
            width: "100%",
            height: 12,
            background: "#e8edf5",
            borderRadius: 999,
            overflow: "hidden"
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              minWidth: progress > 0 ? 8 : 0,
              background: "linear-gradient(90deg, #2563eb, #16a34a)",
              borderRadius: 999,
              transition: "width 350ms ease"
            }}
          />
        </div>
        <div className="row spread muted progress-caption" style={{ fontSize: 13 }}>
          <span>✓ {reviewed.toLocaleString("id-ID")} selesai</span>
          <span>{stats.pending.toLocaleString("id-ID")} tersisa</span>
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
            <div className="description" style={{ marginTop: 22, lineHeight: 1.65 }}>
              {descriptionSections.length ? descriptionSections.map((section, sectionIndex) => (
                <section key={`${section.heading}-${sectionIndex}`} style={{ marginBottom: 16 }}>
                  <strong style={{ display: "block", marginBottom: 8, color: "#172554" }}>
                    {section.heading}
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 6 }}>
                    {section.items.map((item, itemIndex) => (
                      <li key={`${sectionIndex}-${itemIndex}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              )) : <p>Tidak ada deskripsi pekerjaan.</p>}
            </div>
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
