import { and, desc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import { models } from '../../../config/models'
import { pipelineConfig } from '../../../config/pipeline'
import { getDb } from '../db'
import {
  approvals,
  citations,
  editionStories,
  editions,
  edits,
  evalResults,
  evalRuns,
  items,
  settings,
  sources,
  stories,
  storyItems,
} from '../db/schema'
import { hashId, id, previewToken, slugify } from '../ids'
import { editionPreviewUrl } from './publish'
import {
  decideCompileStatus,
  resolvePublishSettings,
  type HistoryEdition,
} from './auto-publish'
import { runBlockingChecks, type StoryInput } from './checks'
import { rankItems, pickTopStories, type RankableItem } from './rank'
import { writeStories } from './write'
import { freshnessWindow, hongKongDateParts, nextTuesdayEightHkt } from './window'
import { resolveMeridianWeek, snapshotIsoWeek } from './week'

export type CompileOptions = {
  mock?: boolean
  dryRun?: boolean
  publishDemo?: boolean
  compileAt?: Date
  allowShort?: boolean
}

export type CompileResult = {
  editionId: string
  editionWeek: string
  status: string
  previewToken: string
  previewUrl: string
  storyCount: number
  passed: boolean
  autoPublished: boolean
  publishReason: string
  checks: { name: string; passed: boolean; detail: string }[]
}

async function loadPublishSettings() {
  try {
    const db = await getDb()
    const rows = await db.select().from(settings).where(eq(settings.key, 'publish'))
    return resolvePublishSettings(rows[0]?.value)
  } catch {
    return resolvePublishSettings()
  }
}

async function loadEditionHistory(editionWeek: string): Promise<HistoryEdition[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(editions)
    .where(ne(editions.editionWeek, editionWeek))
    .orderBy(desc(editions.createdAt))

  const history: HistoryEdition[] = []
  for (const row of rows) {
    const [run] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.editionId, row.id))
      .orderBy(desc(evalRuns.createdAt))
    const editRows = await db.select().from(edits).where(eq(edits.editionId, row.id))
    const changeRows = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.editionId, row.id), eq(approvals.action, 'request_changes')))
    history.push({
      evalPassed: Boolean(run?.passed),
      edited: editRows.length > 0 || changeRows.length > 0,
    })
  }
  return history
}

export async function compileEdition(options: CompileOptions = {}): Promise<CompileResult> {
  const compileAt = options.compileAt || new Date()
  const window = freshnessWindow(compileAt)
  const db = await getDb()
  const hk = hongKongDateParts(compileAt)
  const isoWeek = hk.isoWeek
  const priorEditions = await db
    .select({
      editionWeek: editions.editionWeek,
      configSnapshot: editions.configSnapshot,
    })
    .from(editions)
  const editionWeek = resolveMeridianWeek(
    priorEditions.map((row) => ({
      editionWeek: row.editionWeek,
      isoWeek: snapshotIsoWeek(row.configSnapshot),
    })),
    isoWeek,
  )
  const publishSettings = await loadPublishSettings()
  const mode = publishSettings.mode

  const rows = await db
    .select({
      item: items,
      source: sources,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(
      and(
        isNotNull(items.publishedAt),
        gte(items.publishedAt, window.start),
        lte(items.publishedAt, window.end),
      ),
    )

  const rankable: RankableItem[] = rows
    .filter((row) => row.item.publishedAt)
    .map((row) => ({
      id: row.item.id,
      title: row.item.title,
      region: row.source.region,
      tier: row.source.tier,
      weight: row.source.weight,
      publishedAt: row.item.publishedAt,
      isSignal: row.item.isSignal,
      hnPoints: row.item.hnPoints,
    }))

  const ranked = rankItems(rankable, compileAt)
  const picked = pickTopStories(ranked, pipelineConfig.maxStories)
  const drafted = await writeStories(picked, ranked, { compileAt, mock: options.mock || options.dryRun })

  const storiesWithRealLinks: StoryInput[] = drafted.map((story, index) => {
    const primary = picked[index]
    const row = rows.find((entry) => entry.item.id === primary?.id)
    const support = rows.find((entry) => entry.item.id !== primary?.id && !entry.item.isSignal)
    return {
      ...story,
      citations: [
        {
          title: row?.item.title || story.citations[0]?.title || story.headline,
          url: row?.item.url || story.citations[0]?.url || 'https://example.com',
          isPrimary: true,
          publishedAt: row?.item.publishedAt || primary?.publishedAt || null,
        },
        {
          title: support?.item.title || story.citations[1]?.title || `${story.headline} coverage`,
          url: support?.item.url || story.citations[1]?.url || 'https://example.com/coverage',
          publishedAt: support?.item.publishedAt || primary?.publishedAt || null,
        },
      ].filter((citation, citationIndex, list) => list.findIndex((item) => item.url === citation.url) === citationIndex),
    }
  })

  const checks = await runBlockingChecks(storiesWithRealLinks, window, {
    skipNetwork: Boolean(options.mock || options.dryRun),
    allowShort: options.allowShort,
  })

  const token = previewToken()
  const editionId = hashId('ed', editionWeek)
  const existing = await db.select().from(editions).where(eq(editions.editionWeek, editionWeek))
  const history = await loadEditionHistory(editionWeek)
  const decision = options.publishDemo
    ? { status: 'published' as const, reason: 'demo publish', autoPublished: false }
    : decideCompileStatus({
        mode,
        killSwitch: publishSettings.killSwitch,
        checksPassed: checks.passed,
        autoFallbackToReview: publishSettings.autoFallbackToReview,
        autoRequires: publishSettings.autoRequires,
        history,
      })

  if (existing[0]) {
    const oldStories = await db
      .select({ id: editionStories.id })
      .from(editionStories)
      .where(eq(editionStories.editionId, existing[0].id))
    if (oldStories.length > 0) {
      await db.delete(citations).where(
        inArray(
          citations.editionStoryId,
          oldStories.map((row) => row.id),
        ),
      )
    }
    const oldRuns = await db
      .select({ id: evalRuns.id })
      .from(evalRuns)
      .where(eq(evalRuns.editionId, existing[0].id))
    if (oldRuns.length > 0) {
      await db.delete(evalResults).where(
        inArray(
          evalResults.evalRunId,
          oldRuns.map((row) => row.id),
        ),
      )
    }
    await db.delete(evalRuns).where(eq(evalRuns.editionId, existing[0].id))
    await db.delete(editionStories).where(eq(editionStories.editionId, existing[0].id))
  }

  const status = decision.status
  const publishedAt = status === 'published' ? compileAt : null
  const approvedBy = decision.autoPublished ? 'auto' : options.publishDemo ? 'demo' : null
  const approvedAt = status === 'published' ? compileAt : null

  await db
    .insert(editions)
    .values({
      id: editionId,
      editionWeek,
      windowStart: window.start,
      windowEnd: window.end,
      sendAt: nextTuesdayEightHkt(compileAt),
      status,
      modeUsed: mode,
      previewToken: existing[0]?.previewToken || token,
      lede: checks.surviving.slice(0, 5).map((story) => story.headline),
      publishedAt,
      approvedBy,
      approvedAt,
      configSnapshot: {
        models,
        freshnessDays: pipelineConfig.freshnessDays,
        mock: Boolean(options.mock || options.dryRun),
        isoWeek,
      },
    })
    .onConflictDoUpdate({
      target: editions.editionWeek,
      set: {
        windowStart: window.start,
        windowEnd: window.end,
        status,
        modeUsed: mode,
        lede: checks.surviving.slice(0, 5).map((story) => story.headline),
        publishedAt,
        approvedBy,
        approvedAt,
        configSnapshot: {
          models,
          freshnessDays: pipelineConfig.freshnessDays,
          mock: Boolean(options.mock || options.dryRun),
          isoWeek,
        },
      },
    })

  for (const [index, story] of checks.surviving.entries()) {
    const storyId = id('story')
    const editionStoryId = id('estory')
    const pickedItem = picked[index]
    await db.insert(stories).values({
      id: storyId,
      title: story.headline,
      summary: story.whyItMatters,
      status: 'selected',
    })
    if (pickedItem) {
      try {
        await db.insert(storyItems).values({
          storyId,
          itemId: pickedItem.id,
          role: 'primary',
        })
      } catch {
        // link is optional if the item row is missing in mock runs
      }
    }
    await db.insert(editionStories).values({
      id: editionStoryId,
      editionId,
      storyId,
      position: index + 1,
      section: 'main',
      isAsia: Boolean(story.isAsia),
      slug: uniqueSlug(story.headline, index),
      headline: story.headline,
      body: story.body,
      whyItMatters: story.whyItMatters,
      asiaAngle: story.asiaAngle,
    })
    for (const [citationIndex, citation] of story.citations.entries()) {
      await db.insert(citations).values({
        id: id('cite'),
        editionStoryId,
        sentenceIndex: citationIndex,
        itemId: pickedItem?.id,
        title: citation.title,
        url: citation.url,
        isPrimary: Boolean(citation.isPrimary),
      })
    }
  }

  const runId = id('eval')
  await db.insert(evalRuns).values({
    id: runId,
    editionId,
    stage: 'pre_approval',
    model: models.checks,
    passed: checks.passed,
    scoreTotal: String(checks.results.filter((result) => result.passed).length),
  })
  for (const result of checks.results) {
    await db.insert(evalResults).values({
      id: id('eres'),
      evalRunId: runId,
      checkName: result.name,
      blocking: result.blocking,
      passed: result.passed,
      detail: result.detail,
    })
  }

  const saved = await db.select().from(editions).where(eq(editions.id, editionId))
  const tokenUsed = saved[0]?.previewToken || token
  return {
    editionId,
    editionWeek,
    status: saved[0]?.status || status,
    previewToken: tokenUsed,
    previewUrl: editionPreviewUrl(tokenUsed),
    storyCount: checks.surviving.length,
    passed: checks.passed,
    autoPublished: decision.autoPublished,
    publishReason: decision.reason,
    checks: checks.results.map((result) => ({
      name: result.name,
      passed: result.passed,
      detail: result.detail,
    })),
  }
}

function uniqueSlug(headline: string, index: number): string {
  return `${slugify(headline) || 'story'}-${index + 1}`
}
