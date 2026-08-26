import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('required mode fails when generated artifacts are absent', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, '../scripts/validate-sdd.mjs'), '--root', resolve(import.meta.dirname, 'fixtures/missing-run'), '--required'],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /required status missing/)
})
