import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

// Optimistic check only (cookie present). Pages and API routes verify the real session and role.
export function middleware(req: NextRequest) {
  if (!getSessionCookie(req)) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/presentation/:path*", "/architecture/:path*", "/lab/:path*", "/room/:path*", "/results/:path*", "/replay/:path*", "/runs/:path*", "/team/:path*", "/workspace/:path*"] };
