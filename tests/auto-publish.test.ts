import { describe, expect, it } from 'vitest'
import { publishDefaults } from '../config/publish'
import { decideCompileStatus, historyMeetsAutoThresholds } from '../src/lib/pipeline/auto-publish'

const requires = publishDefaults.autoRequires

function clean(count: number) {
  return Array.from({ length: count }, () => ({ evalPassed: true, edited: false }))
}

describe('PUBLISH_MODE=auto thresholds', () => {
  it('keeps a passing edition in review in manual mode', () => {
    const result = decideCompileStatus({
      mode: 'manual',
      killSwitch: false,
      checksPassed: true,
      history: clean(8),
    })
    expect(result).toMatchObject({ status: 'in_review', autoPublished: false, reason: 'manual mode' })
  })

  it('never auto-publishes when blocking checks fail', () => {
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: false,
      history: clean(8),
    })
    expect(result).toMatchObject({ status: 'draft', autoPublished: false })
  })

  it('falls back to human review when the kill switch is on', () => {
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: true,
      checksPassed: true,
      history: clean(8),
    })
    expect(result).toMatchObject({ status: 'in_review', autoPublished: false, reason: 'kill switch on' })
  })

  it('falls back to human review before there are enough prior editions', () => {
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: true,
      history: clean(3),
    })
    expect(result.status).toBe('in_review')
    expect(result.autoPublished).toBe(false)
    expect(result.reason).toMatch(/need 8 prior editions/)
  })

  it('publishes only when the configured eval thresholds are met', () => {
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: true,
      history: clean(8),
    })
    expect(result).toMatchObject({ status: 'published', autoPublished: true, reason: 'eval thresholds met' })
  })

  it('falls back when too many of the last editions were edited', () => {
    const history = clean(8)
    history[0] = { evalPassed: true, edited: true }
    history[1] = { evalPassed: true, edited: true }
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: true,
      history,
    })
    expect(result.status).toBe('in_review')
    expect(result.autoPublished).toBe(false)
    expect(result.reason).toMatch(/edited/)
  })

  it('falls back when the last N editions were not clean', () => {
    const history = clean(8)
    history[0] = { evalPassed: false, edited: false }
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: true,
      history,
    })
    expect(result.status).toBe('in_review')
    expect(result.reason).toMatch(/not clean/)
  })

  it('stays draft when fallback is off and thresholds fail', () => {
    const result = decideCompileStatus({
      mode: 'auto',
      killSwitch: false,
      checksPassed: true,
      autoFallbackToReview: false,
      history: clean(2),
    })
    expect(result).toMatchObject({ status: 'draft', autoPublished: false })
  })

  it('counts passing editions only inside the window', () => {
    const history = [
      ...Array.from({ length: 2 }, () => ({ evalPassed: false, edited: false })),
      ...clean(6),
    ]
    expect(historyMeetsAutoThresholds(history, requires).ok).toBe(false)
  })
})
