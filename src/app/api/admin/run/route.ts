import { authorizeCron, readBearer } from '@/lib/auth'
import { compileEdition } from '@/lib/pipeline/compile'
import { ingestSources } from '@/lib/pipeline/ingest'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = authorizeCron(readBearer(request.headers.get('authorization')))
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as { job?: string; mock?: boolean }
  const job = body.job || new URL(request.url).searchParams.get('job')

  if (job === 'ingest') {
    const result = await ingestSources({ mock: body.mock })
    return Response.json(result)
  }

  if (job === 'compile') {
    const result = await compileEdition({ mock: body.mock })
    return Response.json(result)
  }

  return Response.json({ error: 'Unknown job' }, { status: 400 })
}

export async function GET() {
  return Response.json({ error: 'Use POST' }, { status: 405 })
}
