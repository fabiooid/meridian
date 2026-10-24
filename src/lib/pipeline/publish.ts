import { desc, eq } from 'drizzle-orm'
import { siteUrl } from '../../../config/site'
import { getDb } from '../db'
import { approvals, editions } from '../db/schema'
import { id } from '../ids'

export type EditionAction = 'approve' | 'reject' | 'changes'
export type ApprovalChannel = 'admin'

export function parseEditionAction(value: unknown): EditionAction | null {
  if (value === 'approve' || value === 'reject' || value === 'changes') return value
  return null
}

export function editionPreviewUrl(token: string): string {
  return `${siteUrl()}/preview/${token}`
}

export function applyEditionActionState(
  status: string,
  action: EditionAction,
): { ok: true; nextStatus: string } | { ok: false; status: string; error: string } {
  if (action === 'approve') {
    if (status !== 'in_review' && status !== 'draft' && status !== 'held') {
      return { ok: false, status, error: 'This edition cannot be approved in its current state' }
    }
    return { ok: true, nextStatus: 'published' }
  }
  if (action === 'reject') {
    return { ok: true, nextStatus: 'rejected' }
  }
  return { ok: true, nextStatus: 'draft' }
}

export async function listEditionsForAdmin(): Promise<
  {
    editionWeek: string
    status: string
    previewUrl: string
    approvedBy: string | null
    approvedAt: Date | null
    publishedAt: Date | null
  }[]
> {
  const db = await getDb()
  const rows = await db.select().from(editions).orderBy(desc(editions.editionWeek))
  return rows.map((row) => ({
    editionWeek: row.editionWeek,
    status: row.status,
    previewUrl: editionPreviewUrl(row.previewToken),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    publishedAt: row.publishedAt,
  }))
}

export async function applyEditionAction(input: {
  editionWeek: string
  action: EditionAction
  channel?: ApprovalChannel
  note?: string
}): Promise<{ ok: boolean; status: string; previewUrl?: string; error?: string }> {
  const db = await getDb()
  const rows = await db.select().from(editions).where(eq(editions.editionWeek, input.editionWeek))
  const edition = rows[0]
  if (!edition) return { ok: false, status: 'missing', error: 'Edition not found' }

  const channel = input.channel || 'admin'
  const next = applyEditionActionState(edition.status, input.action)
  if (!next.ok) return { ok: false, status: next.status, error: next.error }

  if (input.action === 'approve') {
    await db
      .update(editions)
      .set({
        status: 'published',
        approvedBy: channel,
        approvedAt: new Date(),
        publishedAt: new Date(),
      })
      .where(eq(editions.id, edition.id))
  } else if (input.action === 'reject') {
    await db
      .update(editions)
      .set({ status: 'rejected', approvedBy: channel, approvedAt: new Date() })
      .where(eq(editions.id, edition.id))
  } else {
    await db.update(editions).set({ status: 'draft' }).where(eq(editions.id, edition.id))
  }

  await db.insert(approvals).values({
    id: id('appr'),
    editionId: edition.id,
    channel,
    action: input.action === 'changes' ? 'request_changes' : input.action,
    note: input.note,
  })

  return {
    ok: true,
    status: next.nextStatus,
    previewUrl: editionPreviewUrl(edition.previewToken),
  }
}
