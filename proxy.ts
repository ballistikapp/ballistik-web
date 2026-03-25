import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildAuthRedirectPath,
  getSafeRedirectPath,
} from "@/lib/utils/auth-redirect";

const publicRoutes = ["/", "/auth", "/api/trpc", "/api/webhooks/"];

export function proxy(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/auth") && token) {
    const redirectTarget = getSafeRedirectPath(searchParams.get("redirect"));
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  }

  const isPublicRoute = publicRoutes.some((route) =>
    route === "/" ? pathname === "/" : pathname.startsWith(route)
  );

  if (isPublicRoute) {
    return NextResponse.next();
  }

  if (!token) {
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(
      new URL(buildAuthRedirectPath(returnTo), request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|.*\\..*).*)",
  ],
};
