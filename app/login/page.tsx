import LoginForm from "@/components/login-form";
import SetupRequired from "@/components/setup-required";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!getSupabasePublicConfig()) return <SetupRequired />;
  return <LoginForm />;
}
