import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth/guard";
import DemoPresentation from "@/components/DemoPresentation";
export const metadata={title:"Presentation — Blindspot"};
export default async function PresentationPage(){const ctx=await getCtx();if(!ctx)redirect('/sign-in?next=/presentation');if(!ctx.orgId)redirect('/workspace');return <DemoPresentation />;}
