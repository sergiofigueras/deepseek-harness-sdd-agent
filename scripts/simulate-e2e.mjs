import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { extractWorkflowScript, runWorkflowSimulation } from './lib/workflow-contract.mjs'

const script = extractWorkflowScript(resolve(import.meta.dirname, '../.dsh/skills/sdd-code-agent/SKILL.md'))
const architectureReady = {
  status: 'ready', runId: 'run-demo-001', summary: 'Decision-complete spec',
  artifacts: ['docs/sdd/PLAN.md', 'docs/sdd/SPEC.md', 'docs/sdd/status.json'],
  acceptanceCriteria: ['AC-001'], questions: [], allowedPaths: ['src/', 'tests/']
}
const implementationDone = {
  status: 'implemented', runId: 'run-demo-001', summary: 'Implemented AC-001',
  changedFiles: ['src/example.ts', 'tests/example.test.ts'], acceptanceCriteriaPlanned: ['AC-001'], acceptanceCriteriaImplemented: ['AC-001'],
  checks: [{ command: 'npm test', status: 'passed', evidence: 'exit 0' }], blocker: ''
}
const verificationDone = {
  status: 'verified', runId: 'run-demo-001', verdict: 'Ready for human review',
  changedFiles: ['src/example.ts', 'tests/example.test.ts'], acceptanceCriteriaVerified: ['AC-001'],
  checks: [{ command: 'npm test', status: 'passed', evidence: 'exit 0' }], remainingRisks: [], blocker: ''
}

const supervised = await runWorkflowSimulation({
  script, args: { request: 'Implement the sample', mode: 'supervised' }, responses: [architectureReady]
})
assert.equal(supervised.result.status, 'awaiting-approval')
assert.equal(supervised.calls.length, 1)

const noApproval = await runWorkflowSimulation({
  script, args: { request: 'Implement the sample', mode: 'resume' }, responses: []
})
assert.equal(noApproval.result.stage, 'approval')

const resumed = await runWorkflowSimulation({
  script, args: { request: 'Implement the sample', mode: 'resume', approval: 'Approved' },
  responses: [implementationDone, verificationDone]
})
assert.equal(resumed.result.status, 'completed')
assert.deepEqual(resumed.phases, ['Implementation', 'Verification'])

const autonomous = await runWorkflowSimulation({
  script, args: { request: 'Implement the sample', mode: 'autonomous' },
  responses: [architectureReady, implementationDone, verificationDone]
})
assert.equal(autonomous.result.status, 'completed')
assert.deepEqual(autonomous.phases, ['Plan and spec', 'Implementation', 'Verification'])
assert.deepEqual(autonomous.calls.map(call => call.options.model), ['gpt-5.5', 'gpt-5.3-codex', 'gpt-5.5'])

console.log('Offline E2E simulation passed: supervised gate, approval refusal, resume, structured schemas, and autonomous routing.')
