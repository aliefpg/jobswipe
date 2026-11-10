import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetupRequired from "@/components/setup-required";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!getSupabasePublicConfig()) return <SetupRequired />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "reviewer") redirect("/review");

  return (
    <main className="shell">
      <div className="panel stack">
        <h1>Akun belum memiliki role</h1>
        <p className="muted">Hubungi admin untuk memeriksa profil akun Supabase kamu.</p>
      </div>
    </main>
  );
}
