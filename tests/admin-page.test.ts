import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { GET, POST } from '../src/app/api/admin/editions/route'
import robots from '../src/app/robots'
import {
  ADMIN_EDITIONS_PATH,
  ADMIN_KEY_STORAGE,
  actionLabel,
  adminAuthMessage,
  adminPageGate,
  buildAdminActionRequest,
  buildAdminListRequest,
  canApprove,
  confirmAction,
  readStoredAdminKey,
  splitAdminEditions,
  statusLabel,
  writeStoredAdminKey,
} from '../src/lib/admin-ui'
import { closeDb, execScript, getDb } from '../src/lib/db'
import { editions } from '../src/lib/db/schema'

const originalAdminKey = process.env.ADMIN_API_KEY

process.env.PGLITE_PATH = `.data/test-admin-page-${process.pid}`
delete process.env.DATABASE_URL
process.env.ADMIN_API_KEY = 'admin-page-key'
process.env.SITE_URL = 'https://meridian.test'

function memoryStore(start: Record<string, string> = {}) {
  const data = { ...start }
  return {
    getItem(key: string) {
      return key in data ? data[key] : null
    },
    setItem(key: string, value: string) {
      data[key] = value
    },
    removeItem(key: string) {
      delete data[key]
    },
  }
}

describe('admin page gate and helpers', () => {
  afterEach(() => {
    process.env.ADMIN_API_KEY = 'admin-page-key'
  })

  it('fails closed when ADMIN_API_KEY is unset', async () => {
    delete process.env.ADMIN_API_KEY
    expect(adminPageGate()).toEqual({
      ok: false,
      status: 503,
      error: 'Admin access is not configured',
    })
    expect(adminAuthMessage(503)).toBe('Admin access is not configured')
    const closed = await GET(
      new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, buildAdminListRequest('anything')),
    )
    expect(closed.status).toBe(503)
  })

  it('opens only when the server key is set', () => {
    process.env.ADMIN_API_KEY = 'admin-page-key'
    expect(adminPageGate()).toEqual({ ok: true })
  })

  it('keeps the key in session storage only, never in the helper output', () => {
    const storage = memoryStore()
    writeStoredAdminKey(storage, '  secret-key  ')
    expect(readStoredAdminKey(storage)).toBe('secret-key')
    expect(storage.getItem(ADMIN_KEY_STORAGE)).toBe('secret-key')
    writeStoredAdminKey(storage, null)
    expect(readStoredAdminKey(storage)).toBeNull()
    expect(JSON.stringify(buildAdminListRequest('secret-key'))).toContain('Bearer secret-key')
  })

  it('splits editions in review from recent ones', () => {
    const { waiting, recent } = splitAdminEditions([
      { editionWeek: '2026-W43', status: 'in_review' },
      { editionWeek: '2026-W42', status: 'draft' },
      { editionWeek: '2026-W41', status: 'published' },
      { editionWeek: '2026-W40', status: 'rejected' },
    ])
    expect(waiting.map((row) => row.editionWeek)).toEqual(['2026-W43', '2026-W42'])
    expect(recent.map((row) => row.editionWeek)).toEqual(['2026-W41', '2026-W40'])
    expect(statusLabel('in_review')).toBe('In review')
    expect(canApprove('in_review')).toBe(true)
    expect(canApprove('published')).toBe(false)
    expect(actionLabel('changes')).toBe('Request changes')
    expect(confirmAction('approve', '2026-W43')).toContain('Publish 2026-W43')
  })

  it('hides the admin page from crawlers', () => {
    expect(robots().rules[0]?.disallow).toEqual(expect.arrayContaining(['/admin']))
  })
})

describe('admin page actions reuse the admin API', () => {
  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'admin-page-key'
    await closeDb()
    const sql = await readFile(path.join(process.cwd(), 'drizzle/migrations/0000_init.sql'), 'utf8')
    await execScript(sql)
    const db = await getDb()
    await db.insert(editions).values([
      {
        id: 'edn_page_w43',
        editionWeek: '2026-W43',
        windowStart: new Date('2026-10-20T00:00:00.000Z'),
        windowEnd: new Date('2026-10-27T00:00:00.000Z'),
        status: 'in_review',
        previewToken: 'preview-page-w43',
      },
      {
        id: 'edn_page_w42',
        editionWeek: '2026-W42',
        windowStart: new Date('2026-10-13T00:00:00.000Z'),
        windowEnd: new Date('2026-10-20T00:00:00.000Z'),
        status: 'in_review',
        previewToken: 'preview-page-w42',
      },
      {
        id: 'edn_page_w41',
        editionWeek: '2026-W41',
        windowStart: new Date('2026-10-06T00:00:00.000Z'),
        windowEnd: new Date('2026-10-13T00:00:00.000Z'),
        status: 'published',
        previewToken: 'preview-page-w41',
      },
    ])
  })

  afterAll(async () => {
    await closeDb()
    process.env.ADMIN_API_KEY = originalAdminKey
  })

  it('refuses list and actions without a matching key', async () => {
    const missing = await GET(new Request(`http://localhost${ADMIN_EDITIONS_PATH}`))
    expect(missing.status).toBe(401)

    const wrong = await GET(
      new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, buildAdminListRequest('nope')),
    )
    expect(wrong.status).toBe(401)
    expect(adminAuthMessage(wrong.status)).toBe('That key is not accepted')

    const action = buildAdminActionRequest('nope', {
      editionWeek: '2026-W43',
      action: 'approve',
    })
    expect('error' in action).toBe(false)
    if ('error' in action) return
    const rejected = await POST(new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, action))
    expect(rejected.status).toBe(401)
  })

  it('lists waiting editions and runs approve, reject, and request changes', async () => {
    const list = await GET(
      new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, buildAdminListRequest('admin-page-key')),
    )
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { editions: { editionWeek: string; status: string; previewUrl: string }[] }
    const { waiting, recent } = splitAdminEditions(listed.editions)
    expect(waiting.some((row) => row.editionWeek === '2026-W43' && row.status === 'in_review')).toBe(true)
    expect(waiting.find((row) => row.editionWeek === '2026-W43')?.previewUrl).toBe(
      'https://meridian.test/preview/preview-page-w43',
    )
    expect(recent.some((row) => row.editionWeek === '2026-W41')).toBe(true)

    const approve = buildAdminActionRequest('admin-page-key', {
      editionWeek: '2026-W43',
      action: 'approve',
    })
    expect('error' in approve).toBe(false)
    if ('error' in approve) return
    const approved = await POST(new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, approve))
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ ok: true, status: 'published' })

    const reject = buildAdminActionRequest('admin-page-key', {
      editionWeek: '2026-W41',
      action: 'reject',
      note: 'hold this one',
    })
    expect('error' in reject).toBe(false)
    if ('error' in reject) return
    const rejected = await POST(new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, reject))
    expect(rejected.status).toBe(200)
    expect(await rejected.json()).toMatchObject({ ok: true, status: 'rejected' })

    const changes = buildAdminActionRequest('admin-page-key', {
      editionWeek: '2026-W42',
      action: 'changes',
      note: 'tighten the lede',
    })
    expect('error' in changes).toBe(false)
    if ('error' in changes) return
    const sentBack = await POST(new Request(`http://localhost${ADMIN_EDITIONS_PATH}`, changes))
    expect(sentBack.status).toBe(200)
    expect(await sentBack.json()).toMatchObject({ ok: true, status: 'draft' })
  })

  it('refuses a bad action payload before it hits the API', () => {
    expect(buildAdminActionRequest('admin-page-key', { editionWeek: '2026-W43', action: 'publish' })).toEqual({
      error: 'Send editionWeek and action (approve, reject, or changes)',
    })
  })
})
