import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth/guard";
import RoomModel from "@/components/RoomModel";
export const metadata = { title: "Room — Blindspot" };
export default async function RoomPage() {
  const ctx = await getCtx();
  if (!ctx) redirect("/sign-in?next=/room");
  if (!ctx.orgId) redirect("/workspace");
  return <RoomModel />;
}
