import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCtx } from "@/lib/auth/guard";

export const metadata = { title: "Create account — Blindspot" };

export default async function SignUp() {
  if (await getCtx()) redirect("/runs");
  return <AuthForm mode="sign-up" />;
}
