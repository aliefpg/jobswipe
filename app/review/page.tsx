import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Reviewer from "@/components/reviewer";
export default async function ReviewPage(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");const {data:p}=await supabase.from("profiles").select("role").eq("id",user.id).single();if(p?.role!=="reviewer")redirect("/");return <Reviewer email={user.email??""}/>;}
