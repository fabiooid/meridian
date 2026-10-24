import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { GET, POST } from '../src/app/api/admin/editions/route'
import { closeDb, execScript, getDb } from '../src/lib/db'
import { editions } from '../src/lib/db/schema'
import {
  applyEditionAction,
  applyEditionActionState,
  parseEditionAction,
} from '../src/lib/pipeline/publish'

process.env.PGLITE_PATH = `.data/test-admin-approval-${process.pid}`
delete process.env.DATABASE_URL
process.env.ADMIN_API_KEY = 'admin-test-key'
process.env.SITE_URL = 'https://meridian.test'

async function insertEdition(week: string, status: string) {
  const db = await getDb()
  await db.insert(editions).values({
    id: `edn_${week}`,
    editionWeek: week,
    windowStart: new Date('2026-10-13T00:00:00.000Z'),
    windowEnd: new Date('2026-10-20T00:00:00.000Z'),
    status,
    previewToken: `preview-${week}`,
  })
}

function adminRequest(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: 'Bearer admin-test-key',
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
}

describe('admin approval without Telegram', () => {
  beforeAll(async () => {
    await closeDb()
    const sql = await readFile(path.join(process.cwd(), 'drizzle/migrations/0000_init.sql'), 'utf8')
    await execScript(sql)
    await insertEdition('2026-W42', 'in_review')
    await insertEdition('2026-W43', 'in_review')
    await insertEdition('2026-W40', 'published')
  })

  afterAll(async () => {
    await closeDb()
  })

  it('parses only approve, reject, and changes', () => {
    expect(parseEditionAction('approve')).toBe('approve')
    expect(parseEditionAction('reject')).toBe('reject')
    expect(parseEditionAction('changes')).toBe('changes')
    expect(parseEditionAction('telegram')).toBeNull()
    expect(parseEditionAction('publish')).toBeNull()
  })

  it('keeps a passing edition in review until an admin approves it', () => {
    expect(applyEditionActionState('in_review', 'approve')).toEqual({ ok: true, nextStatus: 'published' })
    expect(applyEditionActionState('published', 'approve')).toMatchObject({ ok: false })
    expect(applyEditionActionState('in_review', 'reject')).toEqual({ ok: true, nextStatus: 'rejected' })
    expect(applyEditionActionState('in_review', 'changes')).toEqual({ ok: true, nextStatus: 'draft' })
  })

  it('publishes an in-review edition through the admin action', async () => {
    const result = await applyEditionAction({
      editionWeek: '2026-W42',
      action: 'approve',
      channel: 'admin',
    })
    expect(result).toMatchObject({
      ok: true,
      status: 'published',
      previewUrl: 'https://meridian.test/preview/preview-2026-W42',
    })

    const db = await getDb()
    const [row] = await db.select().from(editions).where(eq(editions.editionWeek, '2026-W42'))
    expect(row.status).toBe('published')
    expect(row.approvedBy).toBe('admin')
    expect(row.publishedAt).toBeTruthy()
  })

  it('refuses the admin API without ADMIN_API_KEY', async () => {
    const missing = await POST(
      new Request('http://localhost/api/admin/editions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ editionWeek: '2026-W43', action: 'approve' }),
      }),
    )
    expect(missing.status).toBe(401)

    const wrong = await POST(
      adminRequest('http://localhost/api/admin/editions', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
        body: JSON.stringify({ editionWeek: '2026-W43', action: 'approve' }),
      }),
    )
    expect(wrong.status).toBe(401)
  })

  it('approves and rejects through the admin HTTP route', async () => {
    const bad = await POST(
      adminRequest('http://localhost/api/admin/editions', {
        method: 'POST',
        body: JSON.stringify({ editionWeek: '2026-W43' }),
      }),
    )
    expect(bad.status).toBe(400)

    const list = await GET(adminRequest('http://localhost/api/admin/editions'))
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { editions: { editionWeek: string; status: string; previewUrl: string }[] }
    expect(listed.editions.some((row) => row.editionWeek === '2026-W43' && row.status === 'in_review')).toBe(true)
    expect(listed.editions.find((row) => row.editionWeek === '2026-W43')?.previewUrl).toBe(
      'https://meridian.test/preview/preview-2026-W43',
    )

    const approved = await POST(
      adminRequest('http://localhost/api/admin/editions', {
        method: 'POST',
        body: JSON.stringify({ editionWeek: '2026-W43', action: 'approve' }),
      }),
    )
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ ok: true, status: 'published' })

    const again = await POST(
      adminRequest('http://localhost/api/admin/editions', {
        method: 'POST',
        body: JSON.stringify({ editionWeek: '2026-W43', action: 'approve' }),
      }),
    )
    expect(again.status).toBe(409)

    const rejected = await POST(
      adminRequest('http://localhost/api/admin/editions', {
        method: 'POST',
        body: JSON.stringify({ editionWeek: '2026-W40', action: 'reject', note: 'hold this one' }),
      }),
    )
    expect(rejected.status).toBe(200)
    expect(await rejected.json()).toMatchObject({ ok: true, status: 'rejected' })
  })
})
