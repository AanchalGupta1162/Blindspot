import { redirect } from "next/navigation";
import { demoEnabled } from "@/lib/auth/demo";
import AuthForm from "@/components/AuthForm";
import { getCtx } from "@/lib/auth/guard";

export const metadata = { title: "Sign in — Blindspot" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCtx()) redirect("/runs");
  return <AuthForm demo={demoEnabled()} mode="sign-in" next={(await searchParams).next} />;
}
