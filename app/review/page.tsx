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

  if (profile?.role !== "reviewer") redirect("/");

  return <Reviewer email={user.email ?? ""} />;
}
