import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminDashboard from "@/components/admin-dashboard";
export default async function AdminPage() {
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
  if(!user) redirect("/login");
  const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
  if(profile?.role!=="admin") redirect("/");
  const {data:stats}=await supabase.rpc("admin_job_stats");
  return <AdminDashboard email={user.email??""} stats={stats?.[0]??{total:0,pending:0,taken:0,rejected:0}}/>;
}
