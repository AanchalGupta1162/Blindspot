import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth/guard";
import ArchitectureDemo from "@/components/ArchitectureDemo";
export const metadata = { title: "Architecture — Blindspot" };
export default async function ArchitecturePage(){const ctx=await getCtx();if(!ctx)redirect('/sign-in?next=/architecture');if(!ctx.orgId)redirect('/workspace');return <ArchitectureDemo />;}
