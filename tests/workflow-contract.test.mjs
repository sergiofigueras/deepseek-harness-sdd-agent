import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { extractWorkflowScript, runWorkflowSimulation } from '../scripts/lib/workflow-contract.mjs'

const script = extractWorkflowScript(resolve(import.meta.dirname, '../.dsh/skills/sdd-code-agent/SKILL.md'))

test('blocked architecture never reaches implementation', async () => {
  const blocked = {
    status: 'blocked', runId: 'run-blocked-001', summary: 'Decision required', artifacts: [],
    acceptanceCriteria: ['AC-001'], questions: ['Which API version?'], allowedPaths: []
  }
  const simulation = await runWorkflowSimulation({
    script, args: { request: 'Change the API', mode: 'autonomous' }, responses: [blocked]
  })
  assert.equal(simulation.result.status, 'blocked')
  assert.equal(simulation.result.stage, 'plan-and-spec')
  assert.equal(simulation.calls.length, 1)
})

test('run id mismatch blocks verification success', async () => {
  const architecture = {
    status: 'ready', runId: 'run-one-001', summary: 'Ready', artifacts: [],
    acceptanceCriteria: ['AC-001'], questions: [], allowedPaths: ['src/']
  }
  const implementation = {
    status: 'implemented', runId: 'run-two-002', summary: 'Wrong run', changedFiles: [],
    acceptanceCriteriaPlanned: ['AC-001'], acceptanceCriteriaImplemented: [], checks: [], blocker: ''
  }
  const simulation = await runWorkflowSimulation({
    script, args: { request: 'Change code', mode: 'autonomous' }, responses: [architecture, implementation]
  })
  assert.equal(simulation.result.status, 'blocked')
  assert.match(simulation.result.result.blocker, /Run id changed/)
})

test('ready architecture with unresolved questions is blocked', async () => {
  const inconsistent = {
    status: 'ready', runId: 'run-questions-001', summary: 'Not actually ready', artifacts: [],
    acceptanceCriteria: ['AC-001'], questions: ['Choose a compatibility policy'], allowedPaths: ['src/']
  }
  const simulation = await runWorkflowSimulation({
    script, args: { request: 'Change code', mode: 'autonomous' }, responses: [inconsistent]
  })
  assert.equal(simulation.result.stage, 'plan-and-spec')
  assert.match(simulation.result.result.blocker, /no unresolved questions/)
})

test('missing implementation AC coverage blocks verification', async () => {
  const architecture = {
    status: 'ready', runId: 'run-coverage-001', summary: 'Ready', artifacts: [],
    acceptanceCriteria: ['AC-001', 'AC-002'], questions: [], allowedPaths: ['src/']
  }
  const implementation = {
    status: 'implemented', runId: 'run-coverage-001', summary: 'Partial', changedFiles: ['src/a.ts'],
    acceptanceCriteriaPlanned: ['AC-001', 'AC-002'], acceptanceCriteriaImplemented: ['AC-001'], checks: [], blocker: ''
  }
  const simulation = await runWorkflowSimulation({
    script, args: { request: 'Change code', mode: 'autonomous' }, responses: [architecture, implementation]
  })
  assert.equal(simulation.result.stage, 'implementation')
  assert.match(simulation.result.result.blocker, /AC-002/)
})
