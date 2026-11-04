"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
const links = [["/presentation", "Presentation"], ["/architecture", "Architecture"], ["/room", "Room"], ["/lab", "Lab"], ["/runs", "Runs"], ["/results", "Results"], ["/team", "Team"]] as const;
export default function AppNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { setDestination(null); }, [pathname]);
  // Clear feedback after a cancelled navigation, while server authorization still owns the destination.
  useEffect(() => {
    if (!destination) return;
    const timer = setTimeout(() => setDestination(null), 15000);
    return () => clearTimeout(timer);
  }, [destination]);
  // Dynamic member routes read authorization on the server. Avoid eager prefetch
  // of every tab competing with the requested page for the five DB connections.
  return <nav aria-label={mobile ? "Mobile navigation" : "Main navigation"} aria-busy={!!destination} className={mobile ? "app-nav mobile-nav sm:hidden" : "app-nav hidden sm:flex"}>
    {links.map(([href, label]) => <Link key={href} href={href} prefetch={false} aria-current={pathname === href ? "page" : undefined} onClick={event => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0 && pathname !== href) setDestination(href);
    }}><NavLabel label={label} immediate={destination === href} /></Link>)}
    {destination && <span role="status" className="sr-only">Opening {links.find(([href]) => href === destination)?.[1]}…</span>}
  </nav>;
}
function NavLabel({ label, immediate }: { label: string; immediate: boolean }) {
  const { pending } = useLinkStatus();
  const loading = immediate || pending;
  return <span className={loading ? "text-ink" : undefined} style={loading ? { opacity: .65 } : undefined}>{label}{loading && <span className="nav-pending" aria-label="Loading" />}</span>;
}
