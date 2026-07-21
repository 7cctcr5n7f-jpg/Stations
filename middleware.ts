import { NextRequest, NextResponse } from "next/server"
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/admin-auth"

const PUBLIC_API_GET_PATTERNS = [
  /^\/api\/rooms$/,
  /^\/api\/rooms\/\d+$/,
  /^\/api\/rooms\/\d+\/schedule$/,
  /^\/api\/videos$/,
  /^\/api\/schedules$/,
  // Room displays stream videos through the same-origin proxy (public R2 has no
  // CORS), so it must be reachable without admin auth like the schedule API.
  /^\/api\/video-proxy$/,
]

function isPublicApiRequest(request: NextRequest): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false
  return PUBLIC_API_GET_PATTERNS.some((pattern) => pattern.test(request.nextUrl.pathname))
}

function isSessionRoute(pathname: string): boolean {
  return pathname === "/api/admin/session"
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isSessionRoute(pathname)) {
    return NextResponse.next()
  }

  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/")
  const isApiRoute = pathname.startsWith("/api/")

  if (!isAdminPage && !(isApiRoute && !isPublicApiRequest(request))) {
    return NextResponse.next()
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const session = await verifyAdminSessionToken(token)
  if (session.ok && session.role === "admin") {
    return NextResponse.next()
  }

  if (isApiRoute) {
    const status = session.ok ? 403 : 401
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status },
    )
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/"
  loginUrl.searchParams.set("next", pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
}
