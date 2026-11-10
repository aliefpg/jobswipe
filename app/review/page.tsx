import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Reviewer from "@/components/reviewer";
import SetupRequired from "@/components/setup-required";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  if (!getSupabasePublicConfig()) return <SetupRequired />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "reviewer") {
    return <main className="shell"><div className="panel stack"><h1>Akun ini bukan Reviewer</h1><p className="muted">Role akun yang terbaca: {profile?.role ?? "belum ada"}. Minta Admin memeriksa role akun pada tabel profiles di Supabase. Halaman tidak akan diarahkan berulang-ulang.</p></div></main>;
  }
  return <Reviewer email={user.email ?? ""} />;
}
