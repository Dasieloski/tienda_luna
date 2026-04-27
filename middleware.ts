import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/jwt";
import { LOCAL_ADMIN_STORE_ID, STATIC_ADMIN_JWT_SUB } from "@/lib/static-admin-auth";

const COOKIE = "tl_session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const claims = await verifySessionToken(token);
  if (!claims || claims.typ !== "user" || claims.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Bloquear sesión legacy `static-admin` fuera del placeholder local.
  if (claims.sub === STATIC_ADMIN_JWT_SUB && claims.storeId !== LOCAL_ADMIN_STORE_ID) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // Si el token marca MFA requerido, exigirlo también a nivel de navegación.
  if (claims.mfaRequired === true && claims.mfa !== true) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
