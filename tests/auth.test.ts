import { afterEach, describe, expect, it } from 'vitest'
import { authorizeAdmin, authorizeCron } from '../src/lib/auth'

const original = { ...process.env }

afterEach(() => {
  process.env.ADMIN_API_KEY = original.ADMIN_API_KEY
  process.env.CRON_SECRET = original.CRON_SECRET
})

describe('fail-closed admin', () => {
  it('rejects every request when ADMIN_API_KEY is unset', () => {
    delete process.env.ADMIN_API_KEY
    expect(authorizeAdmin(undefined as unknown as string)).toMatchObject({ ok: false, status: 503 })
    expect(authorizeAdmin(null)).toMatchObject({ ok: false })
  })

  it('rejects a wrong key', () => {
    process.env.ADMIN_API_KEY = 'secret'
    expect(authorizeAdmin('nope')).toMatchObject({ ok: false, status: 401 })
    expect(authorizeAdmin('secret')).toMatchObject({ ok: true })
  })

  it('lets cron callers through with CRON_SECRET, but not as a stand-in for admin approval', () => {
    process.env.ADMIN_API_KEY = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    expect(authorizeCron('cron-secret')).toMatchObject({ ok: true })
    expect(authorizeAdmin('cron-secret')).toMatchObject({ ok: false, status: 401 })
    expect(authorizeAdmin('admin-secret')).toMatchObject({ ok: true })
  })
})
