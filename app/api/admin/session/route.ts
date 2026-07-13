import { NextRequest, NextResponse } from "next/server"
import {
  ADMIN_SESSION_COOKIE,
  authenticateAdminPassword,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  verifyAdminSessionToken,
} from "@/lib/admin-auth"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const session = await verifyAdminSessionToken(token)

  if (!session.ok) {
    return NextResponse.json({ authenticated: false, role: null })
  }

  return NextResponse.json({ authenticated: true, role: session.role })
}

export async function POST(request: NextRequest) {
  try {
    const { password } = (await request.json()) as { password?: string }
    if (!password || !(await authenticateAdminPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

    const token = await createAdminSessionToken("admin")
    const response = NextResponse.json({ authenticated: true, role: "admin" })
    response.cookies.set(ADMIN_SESSION_COOKIE, token, getAdminSessionCookieOptions(request))
    return response
  } catch (error) {
    console.error("[auth] Failed to create admin session:", error)
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...getAdminSessionCookieOptions(request),
    maxAge: 0,
  })
  return response
}
