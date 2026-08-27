import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const validator = resolve(import.meta.dirname, '../scripts/validate-sdd.mjs')
const referenceRun = resolve(import.meta.dirname, 'fixtures/reference-run')
const requirementSdds = [
  'docs/sdd/requirements/01-goal-driven-agent-loop.md',
  'docs/sdd/requirements/02-structured-artifact.md',
  'docs/sdd/requirements/03-deterministic-replay.md',
  'docs/sdd/requirements/04-safety-policy.md',
  'docs/sdd/requirements/05-evidence-observability.md',
  'docs/sdd/requirements/06-human-handoff.md',
  'docs/sdd/requirements/07-heterogeneity-scale.md',
  'docs/sdd/requirements/08-demo-and-deliverables.md'
]

const withRequiredFixture = callback => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'sdd-validator-'))
  cpSync(referenceRun, fixture, { recursive: true })
  mkdirSync(resolve(fixture, 'docs/sdd/requirements'), { recursive: true })
  for (const path of requirementSdds) writeFileSync(resolve(fixture, path), '# Requirement SDD\n')
  try {
    callback(fixture)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

test('required mode fails when generated artifacts are absent', () => {
  const result = spawnSync(
    process.execPath,
    [validator, '--root', resolve(import.meta.dirname, 'fixtures/missing-run'), '--required'],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /required status missing/)
})

test('required mode requires the master plan and specification', () => {
  withRequiredFixture(fixture => {
    rmSync(resolve(fixture, 'docs/sdd/PLAN.md'))
    rmSync(resolve(fixture, 'docs/sdd/SPEC.md'))

    const result = spawnSync(process.execPath, [validator, '--root', fixture, '--required'], { encoding: 'utf8' })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /required SDD artifact missing: docs\/sdd\/PLAN\.md/)
    assert.match(result.stderr, /required SDD artifact missing: docs\/sdd\/SPEC\.md/)
  })
})

test('required mode requires every plannedIn child SDD', () => {
  withRequiredFixture(fixture => {
    const statusPath = resolve(fixture, 'docs/sdd/status.json')
    const status = JSON.parse(readFileSync(statusPath, 'utf8'))
    status.acceptanceCriteria[0].plannedIn = ['docs/sdd/requirements/09-extra-requirement.md']
    writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`)

    const result = spawnSync(process.execPath, [validator, '--root', fixture, '--required'], { encoding: 'utf8' })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /required SDD artifact missing: docs\/sdd\/requirements\/09-extra-requirement\.md/)
  })
})

test('required mode accepts a complete requirement SDD set', () => {
  withRequiredFixture(fixture => {
    const result = spawnSync(process.execPath, [validator, '--root', fixture, '--required'], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /SDD validation passed/)
  })
})
