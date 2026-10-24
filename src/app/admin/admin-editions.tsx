'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import PageShell from '@/components/page-shell'
import StatusAlert from '@/components/status-alert'
import {
  ADMIN_EDITIONS_PATH,
  actionLabel,
  adminAuthMessage,
  buildAdminActionRequest,
  buildAdminListRequest,
  canApprove,
  canReject,
  canRequestChanges,
  confirmAction,
  readStoredAdminKey,
  splitAdminEditions,
  statusLabel,
  writeStoredAdminKey,
  type AdminEditionRow,
} from '@/lib/admin-ui'
import { formatWeekLabel } from '@/lib/utils'
import type { EditionAction } from '@/lib/pipeline/publish'

function browserSession(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage
}

export default function AdminEditions() {
  const [keyInput, setKeyInput] = useState('')
  const [adminKey, setAdminKey] = useState<string | null>(null)
  const [editions, setEditions] = useState<AdminEditionRow[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)

  async function loadEditions(key: string) {
    const response = await fetch(ADMIN_EDITIONS_PATH, buildAdminListRequest(key))
    const body = (await response.json().catch(() => ({}))) as {
      editions?: AdminEditionRow[]
      error?: string
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 503) {
        writeStoredAdminKey(browserSession(), null)
        setAdminKey(null)
      }
      setError(adminAuthMessage(response.status, body.error))
      setEditions([])
      return false
    }
    setEditions(body.editions || [])
    setError('')
    return true
  }

  useEffect(() => {
    const stored = readStoredAdminKey(browserSession())
    if (!stored) {
      setReady(true)
      return
    }
    setAdminKey(stored)
    loadEditions(stored).finally(() => setReady(true))
  }, [])

  async function onSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = keyInput.trim()
    if (!key) {
      setError('Enter the admin key')
      return
    }
    setBusy('signin')
    setNotice('')
    const ok = await loadEditions(key)
    if (ok) {
      writeStoredAdminKey(browserSession(), key)
      setAdminKey(key)
      setKeyInput('')
    }
    setBusy(null)
  }

  function onSignOut() {
    writeStoredAdminKey(browserSession(), null)
    setAdminKey(null)
    setEditions([])
    setNotes({})
    setNotice('')
    setError('')
  }

  async function onAction(editionWeek: string, action: EditionAction) {
    if (!adminKey) return
    if (!window.confirm(confirmAction(action, editionWeek))) return

    setBusy(`${editionWeek}:${action}`)
    setNotice('')
    const request = buildAdminActionRequest(adminKey, {
      editionWeek,
      action,
      note: notes[editionWeek],
    })
    if ('error' in request) {
      setError(request.error)
      setBusy(null)
      return
    }

    const response = await fetch(ADMIN_EDITIONS_PATH, request)
    const body = (await response.json().catch(() => ({}))) as { error?: string; status?: string }
    if (!response.ok) {
      if (response.status === 401 || response.status === 503) {
        writeStoredAdminKey(browserSession(), null)
        setAdminKey(null)
      }
      setError(adminAuthMessage(response.status, body.error))
      setBusy(null)
      return
    }

    setNotice(`${formatWeekLabel(editionWeek)} is now ${statusLabel(body.status || action)}.`)
    setNotes((current) => ({ ...current, [editionWeek]: '' }))
    await loadEditions(adminKey)
    setBusy(null)
  }

  const { waiting, recent } = splitAdminEditions(editions)

  return (
    <PageShell>
      <header className="max-w-2xl">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Private
        </p>
        <h1 className="mt-3 font-heading text-4xl font-bold tracking-tight md:text-5xl">
          Review editions
        </h1>
        <p className="mt-4 text-lg leading-7 text-muted-foreground">
          Approve publishes the edition. Reject stops it. Request changes sends it back to draft.
          This page is not listed on the public site.
        </p>
      </header>

      {!ready ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading...</p>
      ) : !adminKey ? (
        <Card className="mt-10 max-w-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use the same admin key as the API. It stays in this browser tab only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSignIn} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="admin-key">Admin key</Label>
                <Input
                  id="admin-key"
                  type="password"
                  name="admin-key"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={busy === 'signin'}>
                {busy === 'signin' ? 'Checking...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Signed in for this tab.</p>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      )}

      {error ? <div className="mt-6"><StatusAlert tone="error" title="Could not continue" description={error} /></div> : null}
      {notice ? <div className="mt-6"><StatusAlert title="Updated" description={notice} /></div> : null}

      {adminKey ? (
        <div className="mt-10 flex flex-col gap-12">
          <EditionGroup
            title="Waiting"
            empty="Nothing is waiting. When compile finishes, the draft will show up here."
            editions={waiting}
            notes={notes}
            busy={busy}
            showActions
            onNote={(week, value) => setNotes((current) => ({ ...current, [week]: value }))}
            onAction={onAction}
          />
          <EditionGroup
            title="Recent"
            empty="No published or rejected editions yet."
            editions={recent}
            notes={notes}
            busy={busy}
            showActions={false}
            onNote={(week, value) => setNotes((current) => ({ ...current, [week]: value }))}
            onAction={onAction}
          />
        </div>
      ) : null}
    </PageShell>
  )
}

function EditionGroup({
  title,
  empty,
  editions,
  notes,
  busy,
  showActions,
  onNote,
  onAction,
}: {
  title: string
  empty: string
  editions: AdminEditionRow[]
  notes: Record<string, string>
  busy: string | null
  showActions: boolean
  onNote: (week: string, value: string) => void
  onAction: (week: string, action: EditionAction) => void
}) {
  return (
    <section>
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      {editions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {editions.map((edition) => (
            <EditionCard
              key={edition.editionWeek}
              edition={edition}
              note={notes[edition.editionWeek] || ''}
              busy={busy}
              showActions={showActions}
              onNote={onNote}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function EditionCard({
  edition,
  note,
  busy,
  showActions,
  onNote,
  onAction,
}: {
  edition: AdminEditionRow
  note: string
  busy: string | null
  showActions: boolean
  onNote: (week: string, value: string) => void
  onAction: (week: string, action: EditionAction) => void
}) {
  const locked = Boolean(busy)
  const actions: EditionAction[] = []
  if (showActions && canApprove(edition.status)) actions.push('approve')
  if (showActions && canReject(edition.status)) actions.push('reject')
  if (showActions && canRequestChanges(edition.status)) actions.push('changes')

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{formatWeekLabel(edition.editionWeek)}</CardTitle>
            <CardDescription>{edition.editionWeek}</CardDescription>
          </div>
          <Badge variant={edition.status === 'in_review' ? 'default' : 'secondary'}>
            {statusLabel(edition.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <a
          href={edition.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4 hover:text-foreground"
        >
          Open private preview
        </a>
        {showActions ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor={`note-${edition.editionWeek}`}>Note (optional)</Label>
              <Input
                id={`note-${edition.editionWeek}`}
                value={note}
                onChange={(event) => onNote(edition.editionWeek, event.target.value)}
                placeholder="Why you are rejecting or sending it back"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action}
                  variant={action === 'approve' ? 'default' : action === 'reject' ? 'destructive' : 'outline'}
                  disabled={locked}
                  onClick={() => onAction(edition.editionWeek, action)}
                >
                  {busy === `${edition.editionWeek}:${action}` ? 'Saving...' : actionLabel(action)}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
