export const ADMIN_SESSION_COOKIE = "stations_admin_session"
const SESSION_VERSION = "v1"
const SESSION_TTL_SECONDS = 60 * 60 * 12

export type AdminSessionRole = "admin" | "viewer"

type VerifiedSession =
  | { ok: true; role: AdminSessionRole; issuedAt: number }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "invalid-signature" }

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "1708"
}

function getAdminSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.DATABASE_URL ||
    process.env.R2_SECRET_ACCESS_KEY ||
    "stations-admin-session-fallback"
  )
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function signSession(role: AdminSessionRole, issuedAt: number): Promise<string> {
  return sha256Hex(`${SESSION_VERSION}|${role}|${issuedAt}|${getAdminSessionSecret()}`)
}

export async function createAdminSessionToken(role: AdminSessionRole = "admin"): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const signature = await signSession(role, issuedAt)
  return `${SESSION_VERSION}.${role}.${issuedAt}.${signature}`
}

export async function verifyAdminSessionToken(token: string | undefined | null): Promise<VerifiedSession> {
  if (!token) return { ok: false, reason: "missing" }

  const [version, role, issuedAtRaw, signature] = token.split(".")
  if (
    version !== SESSION_VERSION ||
    (role !== "admin" && role !== "viewer") ||
    !issuedAtRaw ||
    !signature
  ) {
    return { ok: false, reason: "malformed" }
  }

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt)) {
    return { ok: false, reason: "malformed" }
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt
  if (ageSeconds < 0 || ageSeconds > SESSION_TTL_SECONDS) {
    return { ok: false, reason: "expired" }
  }

  const expected = await signSession(role, issuedAt)
  if (expected !== signature) {
    return { ok: false, reason: "invalid-signature" }
  }

  return { ok: true, role, issuedAt }
}

export async function authenticateAdminPassword(password: string): Promise<boolean> {
  return password === getAdminPassword()
}

type CookieRequestContext = {
  nextUrl?: {
    protocol?: string
    hostname?: string
  }
  headers?: {
    get(name: string): string | null
  }
}

function shouldUseSecureAdminCookie(request?: CookieRequestContext): boolean {
  const forwardedProto = request?.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim()
  if (forwardedProto === "https") {
    return true
  }

  const protocol = request?.nextUrl?.protocol?.replace(":", "")
  if (protocol === "https") {
    return true
  }

  const hostname = request?.nextUrl?.hostname
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return false
  }

  return process.env.NODE_ENV === "production"
}

export function getAdminSessionCookieOptions(request?: CookieRequestContext) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureAdminCookie(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  }
}
