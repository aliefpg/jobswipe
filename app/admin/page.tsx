import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminDashboard from "@/components/admin-dashboard";
import SetupRequired from "@/components/setup-required";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!getSupabasePublicConfig()) return <SetupRequired />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return <main className="shell"><div className="panel stack"><h1>Akun ini bukan Admin</h1><p className="muted">Role akun yang terbaca: {profile?.role ?? "belum ada"}. Minta Admin memeriksa role akun pada tabel profiles di Supabase. Halaman tidak akan diarahkan berulang-ulang.</p></div></main>;
  }

  const { data: stats, error } = await supabase.rpc("admin_job_stats");
  const initialStats = !error && stats?.[0]
    ? stats[0]
    : { total: 0, pending: 0, taken: 0, rejected: 0 };

  return <AdminDashboard email={user.email ?? ""} stats={initialStats} />;
}
