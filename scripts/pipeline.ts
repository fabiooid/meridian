import { eq } from 'drizzle-orm'
import { compileEdition } from '../src/lib/pipeline/compile'
import { ingestSources } from '../src/lib/pipeline/ingest'
import { editionPreviewUrl } from '../src/lib/pipeline/publish'
import { closeDb, getDb } from '../src/lib/db'
import { editions } from '../src/lib/db/schema'

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.env.PIPELINE_MODE === name
}

function jobName(): string {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  return process.env.PIPELINE_JOB || args[0] || 'help'
}

function logReviewQueue(
  rows: { editionWeek: string; previewToken: string; status: string }[],
) {
  if (rows.length === 0) {
    console.log('No editions waiting for review')
    return
  }
  for (const edition of rows) {
    console.log(
      `${edition.editionWeek} is ${edition.status}. Preview: ${editionPreviewUrl(edition.previewToken)}`,
    )
  }
}

async function remind() {
  const db = await getDb()
  const rows = await db.select().from(editions).where(eq(editions.status, 'in_review'))
  logReviewQueue(rows)
}

async function main() {
  const job = jobName()
  const mock = flag('mock') || flag('dry-run') || !process.env.ANTHROPIC_API_KEY
  const dryRun = flag('dry-run')
  const publishDemo = flag('publish-demo')

  if (job === 'help' || job === '--help') {
    console.log(`Usage: tsx scripts/pipeline.ts <ingest|compile|remind|cron> [--mock] [--dry-run]

Railway cron: set PROCESS_ROLE=pipeline and PIPELINE_JOB=ingest|compile
remind lists editions waiting for admin approval. It does not send messages.
`)
    return
  }

  if (job === 'ingest') {
    const result = await ingestSources({ mock: dryRun })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (job === 'compile') {
    const result = await compileEdition({ mock, dryRun, publishDemo })
    console.log(JSON.stringify(result, null, 2))
    if (result.autoPublished) {
      console.log(`Auto-published ${result.editionWeek}: ${result.publishReason}`)
    } else if (!dryRun && !publishDemo) {
      console.log(`Waiting for admin approval: ${result.editionWeek}`)
      console.log(`Preview: ${result.previewUrl}`)
    }
    return
  }

  if (job === 'remind') {
    await remind()
    return
  }

  if (job === 'cron') {
    const jobFromEnv = process.env.PIPELINE_JOB
    if (jobFromEnv) {
      process.argv.push(jobFromEnv)
      await main()
      return
    }
    throw new Error('PIPELINE_JOB is required for cron')
  }

  throw new Error(`Unknown job: ${job}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await closeDb()
  })
