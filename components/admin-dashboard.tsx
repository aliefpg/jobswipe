"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

type Stats = {
  total: number;
  pending: number;
  taken: number;
  rejected: number;
};

type RawJob = Record<string, unknown>;

type NormalizedJob = {
  title: string;
  company_name: string;
  location_label: string;
  salary_label: string;
  job_description: string;
};

export default function AdminDashboard({
  email,
  stats: initial
}: {
  email: string;
  stats: Stats;
}) {
  const supabase = createClient();
  const [stats, setStats] = useState<Stats>(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data, error } = await supabase.rpc("admin_job_stats");
    if (error) {
      setMessage(`Gagal memperbarui statistik: ${error.message}`);
      return;
    }
    if (data?.[0]) setStats(data[0] as Stats);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function normalize(row: RawJob): NormalizedJob {
    const get = (...keys: string[]) => {
      for (const key of keys) {
        const found = Object.keys(row).find(
          (column) => column.toLowerCase().trim() === key
        );
        if (found && row[found] !== null && row[found] !== undefined) {
          return String(row[found]).trim();
        }
      }
      return "";
    };

    return {
      title: get("title", "job title", "position", "posisi"),
      company_name: get("company_name", "company", "perusahaan"),
      location_label: get("location_label", "location", "lokasi"),
      salary_label: get("salary_label", "salary", "gaji"),
      job_description: get(
        "job_description",
        "description",
        "deskripsi",
        "job description"
      )
    };
  }

  async function upload(file?: File) {
    if (!file) return;

    setBusy(true);
    setMessage("Membaca Excel...");

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("File Excel tidak memiliki worksheet.");

      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<RawJob>(worksheet, { defval: "" });
      const jobs = rawRows.map(normalize).filter((job) => job.title.length > 0);

      if (jobs.length === 0) {
        throw new Error(
          "Tidak ada lowongan. Pastikan ada kolom title, job title, position, atau posisi."
        );
      }

      const batchSize = 500;
      let imported = 0;
      for (let offset = 0; offset < jobs.length; offset += batchSize) {
        const batch = jobs.slice(offset, offset + batchSize);
        setMessage(`Mengimpor ${Math.min(offset + batch.length, jobs.length)} dari ${jobs.length} lowongan...`);
        const { data, error } = await supabase.rpc("admin_import_jobs", {
          p_jobs: batch
        });
        if (error) throw error;
        imported += Number(data ?? batch.length);
      }

      setMessage(`${imported} lowongan berhasil diimpor.`);
      await refresh();
    } catch (error: unknown) {
      setMessage(
        `Gagal import: ${
          error instanceof Error ? error.message : "Terjadi kesalahan saat import."
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportJobs(status: "taken" | "rejected") {
    setBusy(true);
    setMessage("Menyiapkan Excel...");

    try {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "title,company_name,location_label,salary_label,job_description,reviewed_at"
        )
        .eq("status", status)
        .order("reviewed_at", { ascending: true });

      if (error) throw error;

      const worksheet = XLSX.utils.json_to_sheet(data ?? []);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Jobs");

      const filename =
        status === "taken"
          ? "lowongan-diambil.xlsx"
          : "lowongan-dibuang.xlsx";

      XLSX.writeFile(workbook, filename);
      setMessage(`${data?.length ?? 0} data berhasil diexport.`);
    } catch (error: unknown) {
      setMessage(
        `Gagal export: ${
          error instanceof Error ? error.message : "Terjadi kesalahan saat export."
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="top">
        <div>
          <div className="brand">Job<span>Swipe</span></div>
          <div className="muted">Dashboard Admin · {email}</div>
        </div>
        <button className="btn secondary" onClick={logout}>Logout</button>
      </header>

      <section className="stack">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            Import lowongan, pantau progres reviewer, dan export hasil seleksi.
          </p>
        </div>

        <div className="grid">
          {[
            ["Total Lowongan", stats.total],
            ["Belum Diseleksi", stats.pending],
            ["Diambil", stats.taken],
            ["Dibuang", stats.rejected]
          ].map(([label, value]) => (
            <div className="panel stat" key={String(label)}>
              <span className="muted">{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className="panel stack">
          <h2>Import lowongan dari Excel</h2>
          <p className="muted">
            Pilih file .xlsx atau .xls. Data dimasukkan ke database.
            Kolom yang didukung: title, company_name, location_label,
            salary_label, job_description. Alias umum juga diterima.
          </p>
          <input
            className="field"
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <div className="notice">
            Import menambahkan data baru. Jangan mengunggah file yang sama dua kali
            kecuali memang ingin membuat duplikat.
          </div>
        </div>

        <div className="panel stack">
          <h2>Export hasil seleksi</h2>
          <div className="row">
            <button
              className="btn success"
              disabled={busy}
              onClick={() => void exportJobs("taken")}
            >
              Download Excel Diambil
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => void exportJobs("rejected")}
            >
              Download Excel Dibuang
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => void refresh()}>
              Refresh statistik
            </button>
          </div>
        </div>

        {message && <p className="muted" role="status">{message}</p>}
      </section>
    </main>
  );
}
