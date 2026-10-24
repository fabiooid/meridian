import { authorizeAdmin, readBearer } from '@/lib/auth'
import { applyEditionAction, listEditionsForAdmin, parseEditionAction } from '@/lib/pipeline/publish'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = authorizeAdmin(readBearer(request.headers.get('authorization')))
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  const rows = await listEditionsForAdmin()
  return Response.json({ editions: rows })
}

export async function POST(request: Request) {
  const auth = authorizeAdmin(readBearer(request.headers.get('authorization')))
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    editionWeek?: string
    action?: string
    note?: string
  }

  const action = parseEditionAction(body.action)
  const editionWeek = body.editionWeek?.trim()
  if (!action || !editionWeek) {
    return Response.json(
      { error: 'Send editionWeek and action (approve, reject, or changes)' },
      { status: 400 },
    )
  }

  const result = await applyEditionAction({
    editionWeek,
    action,
    channel: 'admin',
    note: typeof body.note === 'string' ? body.note : undefined,
  })

  if (!result.ok) {
    const status = result.status === 'missing' ? 404 : 409
    return Response.json({ error: result.error, status: result.status }, { status })
  }

  return Response.json(result)
}
