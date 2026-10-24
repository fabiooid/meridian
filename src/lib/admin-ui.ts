export const ADMIN_KEY_STORAGE = 'meridian.admin.apiKey'
export const ADMIN_EDITIONS_PATH = '/api/admin/editions'

export type EditionAction = 'approve' | 'reject' | 'changes'

function parseUiEditionAction(value: unknown): EditionAction | null {
  if (value === 'approve' || value === 'reject' || value === 'changes') return value
  return null
}

export type AdminEditionRow = {
  editionWeek: string
  status: string
  previewUrl: string
  approvedBy: string | null
  approvedAt: Date | string | null
  publishedAt: Date | string | null
}

export type SessionStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Page and API both fail closed when the env key is missing. */
export function adminPageGate(): { ok: true } | { ok: false; status: number; error: string } {
  if (!process.env.ADMIN_API_KEY) {
    return { ok: false, status: 503, error: 'Admin access is not configured' }
  }
  return { ok: true }
}

export function isWaitingStatus(status: string): boolean {
  return status === 'in_review' || status === 'draft' || status === 'held'
}

export function splitAdminEditions<T extends { status: string }>(editions: T[]): {
  waiting: T[]
  recent: T[]
} {
  const waiting = editions.filter((row) => isWaitingStatus(row.status))
  const recent = editions.filter((row) => !isWaitingStatus(row.status))
  return { waiting, recent }
}

export function statusLabel(status: string): string {
  if (status === 'in_review') return 'In review'
  if (status === 'published') return 'Published'
  if (status === 'rejected') return 'Rejected'
  if (status === 'draft') return 'Draft'
  if (status === 'held') return 'Held'
  return status
}

export function canApprove(status: string): boolean {
  return status === 'in_review' || status === 'draft' || status === 'held'
}

export function canReject(status: string): boolean {
  return status !== 'rejected'
}

export function canRequestChanges(status: string): boolean {
  return status !== 'draft'
}

export function actionLabel(action: EditionAction): string {
  if (action === 'approve') return 'Approve'
  if (action === 'reject') return 'Reject'
  return 'Request changes'
}

export function confirmAction(action: EditionAction, editionWeek: string): string {
  if (action === 'approve') return `Publish ${editionWeek}? This makes the edition live.`
  if (action === 'reject') return `Reject ${editionWeek}?`
  return `Send ${editionWeek} back to draft?`
}

export function readStoredAdminKey(storage: SessionStore | null): string | null {
  if (!storage) return null
  const value = storage.getItem(ADMIN_KEY_STORAGE)?.trim()
  return value || null
}

export function writeStoredAdminKey(storage: SessionStore | null, key: string | null): void {
  if (!storage) return
  const value = key?.trim()
  if (!value) {
    storage.removeItem(ADMIN_KEY_STORAGE)
    return
  }
  storage.setItem(ADMIN_KEY_STORAGE, value)
}

export function buildAdminListRequest(key: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${key}`,
    },
    cache: 'no-store',
  }
}

export function buildAdminActionRequest(
  key: string,
  input: { editionWeek: string; action: string; note?: string },
): RequestInit | { error: string } {
  const action = parseUiEditionAction(input.action)
  const editionWeek = input.editionWeek.trim()
  if (!action || !editionWeek) {
    return { error: 'Send editionWeek and action (approve, reject, or changes)' }
  }

  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      editionWeek,
      action,
      note: input.note?.trim() || undefined,
    }),
  }
}

export function adminAuthMessage(status: number, fallback?: string): string {
  if (status === 503) return 'Admin access is not configured'
  if (status === 401) return 'That key is not accepted'
  return fallback || 'The request failed'
}
