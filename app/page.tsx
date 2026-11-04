import Link from "next/link";
import { getCtx } from "@/lib/auth/guard";

export default async function Home() {
  const ctx = await getCtx().catch(() => null);
  return <div className="home-page">
    <section className="home-hero">
      <h1>Understand what your<br className="hidden sm:block" /> sensors can’t see.</h1>
      <p>Investigate hidden faults. Test an intervention. Review the outcome. All in a simulated lab.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={ctx ? "/lab" : "/sign-in"} className="btn btn-primary">{ctx ? "Open the lab" : "Open demo"}<span aria-hidden="true">↗</span></Link>
        <Link href={ctx ? "/results" : "/sign-up"} className="btn">{ctx ? "View evaluation" : "Create account"}</Link>
      </div>
    </section>

  </div>;
}
