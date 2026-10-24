import { timingSafeEqual } from 'node:crypto'

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function readBearer(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || header.trim()
}

/** Admin and trigger routes fail closed if the key is missing. */
export function authorizeAdmin(provided: string | null): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.ADMIN_API_KEY
  if (!expected) {
    return { ok: false, status: 503, error: 'Admin access is not configured' }
  }
  if (!provided || !safeEqual(expected, provided)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  return { ok: true }
}

export function authorizeCron(provided: string | null): { ok: true } | { ok: false; status: number; error: string } {
  const cron = process.env.CRON_SECRET
  if (cron && provided && safeEqual(cron, provided)) {
    return { ok: true }
  }
  return authorizeAdmin(provided)
}
