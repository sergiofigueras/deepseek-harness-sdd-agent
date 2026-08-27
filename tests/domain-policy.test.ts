import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { Ajv } from 'ajv'

import {
  applyTenantOverlay,
  ArtifactValidationError,
  compileCapabilityArtifact,
  type CapabilityArtifactDraft,
  validateInvocationInputs,
  verifyCapabilityContentHash,
} from '../src/artifact.js'
import type {
  AutomationPolicy,
  InterventionRequest,
  LocatorBundle,
  ReplayResult,
  RiskApproval,
  TenantOverlay,
} from '../src/contracts.js'
import { createDefaultPolicy, PolicyEngine } from '../src/policy.js'
import { containsSensitiveText, redactText, redactValue } from '../src/redaction.js'

const memberLocator: LocatorBundle = {
  candidates: [
    { strategy: 'label', text: 'Member number', exact: true },
    { strategy: 'css', selector: 'input[name="member"]' },
  ],
  robustnessNote: 'Stable label first, structural selector only as fallback.',
}

const resultLocator: LocatorBundle = {
  candidates: [{ strategy: 'text', text: 'Member located', exact: true }],
  robustnessNote: 'Declared success text.',
}

function draftWithValue(value: string): CapabilityArtifactDraft {
  return {
    schemaVersion: '1.0.0',
    id: 'northstar.lookup-balance',
    version: '1.0.0',
    name: 'Look up balance',
    description: 'Looks up a synthetic member and reads a balance.',
    application: {
      vendor: 'Northstar',
      product: 'Training Console',
      baseUrlPattern: 'http://127.0.0.1:4317/**',
      compatibleVersionRange: 'demo-v1',
      driftFingerprint: 'northstar-demo-v1',
    },
    inputs: [
      {
        name: 'memberId',
        type: 'string',
        description: 'Synthetic member identifier.',
        required: true,
        sensitive: true,
        pattern: '^[0-9]{5}$',
      },
    ],
    outputs: [
      {
        name: 'savingsBalance',
        type: 'string',
        description: 'Displayed synthetic savings balance.',
        required: true,
        locator: resultLocator,
        extraction: 'text',
      },
    ],
    steps: [
      {
        id: 'enter-member',
        action: 'type',
        risk: 'safe',
        description: 'Enter the invocation member identifier.',
        target: memberLocator,
        value,
        timeoutMs: 2_000,
      },
      {
        id: 'read-balance',
        action: 'read',
        risk: 'safe',
        description: 'Read the synthetic savings balance.',
        target: resultLocator,
        outputName: 'savingsBalance',
        timeoutMs: 2_000,
      },
    ],
    checkpoint: { kind: 'visible', locator: resultLocator },
    businessOutcomes: [
      {
        code: 'member_not_found',
        description: 'No matching synthetic member.',
        condition: {
          kind: 'text_matches',
          locator: resultLocator,
          pattern: '^Record not found$',
        },
        data: { found: false },
      },
    ],
    recoveries: [],
    declaredRisk: 'safe',
    provenance: {
      discoveredAt: '2026-08-27T12:00:00.000Z',
      model: 'fixture-model',
      sourceTarget: 'http://127.0.0.1:4317',
      evidenceRunId: 'run-domain-test',
    },
    review: { status: 'draft' },
  }
}

function approvedRisk(runId: string, action: 'click' | 'type' = 'click'): RiskApproval {
  return {
    approvalId: 'approval-test',
    runId,
    actionTypes: [action],
    issuedAt: '2026-08-27T11:59:00.000Z',
    expiresAt: '2026-08-27T12:04:00.000Z',
  }
}

test('artifact compiler replaces observed sensitive values with typed input references', () => {
  const artifact = compileCapabilityArtifact(draftWithValue('12345'), [
    { name: 'memberId', value: '12345' },
  ])

  assert.deepEqual(artifact.steps[0]?.value, { source: 'input', name: 'memberId' })
  assert.equal(JSON.stringify(artifact).includes('12345'), false)
  assert.match(artifact.contentHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(verifyCapabilityContentHash(artifact), true)
})

test('artifact compiler fails closed on unbound secret-like literals', () => {
  assert.throws(
    () => compileCapabilityArtifact(draftWithValue(['sk', 'proj', 'exampleSecretValue1234'].join('-')), []),
    (error: unknown) =>
      error instanceof ArtifactValidationError && /unbound sensitive literal/.test(error.message),
  )
})

test('invocation validation enforces declared names, types, and patterns', () => {
  const artifact = compileCapabilityArtifact(draftWithValue('12345'), [
    { name: 'memberId', value: '12345' },
  ])
  assert.deepEqual(validateInvocationInputs(artifact, { memberId: '67890' }), { memberId: '67890' })
  assert.throws(() => validateInvocationInputs(artifact, { memberId: 'abc' }), /invalid format/)
  assert.throws(() => validateInvocationInputs(artifact, { memberId: '67890', extra: true }), /unknown inputs/)
})

test('tenant overlay changes only locator and deployment identity fields', () => {
  const artifact = compileCapabilityArtifact(draftWithValue('12345'), [
    { name: 'memberId', value: '12345' },
  ])
  const overlay: TenantOverlay = {
    schemaVersion: '1.0.0',
    overlayId: 'tenant-blue-v1',
    capabilityId: artifact.id,
    capabilityVersion: artifact.version,
    tenantId: 'tenant-blue',
    appVersion: 'demo-v1-blue',
    baseUrlPattern: 'http://127.0.0.1:4318/**',
    expectedBaseFingerprint: artifact.application.driftFingerprint,
    driftFingerprint: 'northstar-blue-v1',
    locatorOverrides: [
      {
        stepId: 'enter-member',
        locator: {
          candidates: [{ strategy: 'label', text: 'Member ID', exact: true }],
          robustnessNote: 'Tenant wording override.',
        },
      },
    ],
  }

  const resolved = applyTenantOverlay(artifact, overlay)
  assert.equal(resolved.steps[0]?.action, artifact.steps[0]?.action)
  assert.equal(resolved.steps[0]?.risk, artifact.steps[0]?.risk)
  assert.equal(resolved.steps[0]?.target?.candidates[0]?.strategy, 'label')
  assert.equal(resolved.application.baseUrlPattern, 'http://127.0.0.1:4318/**')
  assert.equal(resolved.appliedOverlay?.tenantId, 'tenant-blue')
  assert.notEqual(resolved.contentHash, artifact.contentHash)
  assert.equal(verifyCapabilityContentHash(resolved), true)

  const semanticMutation = { ...overlay, risk: 'irreversible' } as unknown as TenantOverlay
  assert.throws(() => applyTenantOverlay(artifact, semanticMutation), /forbidden semantic fields/)
})

test('policy denies origins, routes, action types, and oversized text before execution', () => {
  const policy: AutomationPolicy = {
    ...createDefaultPolicy('http://127.0.0.1:4317'),
    allowedRoutes: ['/legacy/**'],
    allowedActions: ['click', 'type'],
    maximumTextLength: 5,
  }
  const engine = new PolicyEngine(policy, () => Date.parse('2026-08-27T12:00:00.000Z'))

  assert.equal(
    engine.authorize({
      runId: 'run-policy',
      action: 'click',
      risk: 'safe',
      targetUrl: 'https://attacker.invalid/legacy/member',
    }).code,
    'origin_not_allowed',
  )
  assert.equal(
    engine.authorize({
      runId: 'run-policy',
      action: 'click',
      risk: 'safe',
      targetUrl: 'http://127.0.0.1:4317/admin',
    }).code,
    'route_not_allowed',
  )
  assert.equal(
    engine.authorize({
      runId: 'run-policy',
      action: 'navigate',
      risk: 'safe',
      targetUrl: 'http://127.0.0.1:4317/legacy/member',
    }).code,
    'action_not_allowed',
  )
  assert.equal(
    engine.authorize({
      runId: 'run-policy',
      action: 'type',
      risk: 'safe',
      targetUrl: 'http://127.0.0.1:4317/legacy/member',
      text: '123456',
    }).code,
    'text_too_long',
  )
})

test('risky action requires a current run-bound approval and irreversible action always stops', () => {
  const engine = new PolicyEngine(
    createDefaultPolicy('http://127.0.0.1:4317'),
    () => Date.parse('2026-08-27T12:00:00.000Z'),
  )
  const request = {
    runId: 'run-policy',
    action: 'click' as const,
    risk: 'risky' as const,
    targetUrl: 'http://127.0.0.1:4317/legacy/member',
  }

  assert.equal(engine.authorize(request).code, 'approval_required')
  assert.equal(engine.authorize({ ...request, approval: approvedRisk('different-run') }).code, 'approval_invalid')
  assert.deepEqual(engine.authorize({ ...request, approval: approvedRisk('run-policy') }), {
    allowed: true,
    code: 'allowed',
    reason: 'The risky action is allowlisted and covered by a valid run-bound approval.',
  })
  assert.equal(
    engine.authorize({ ...request, risk: 'irreversible', approval: approvedRisk('run-policy') }).code,
    'irreversible_action_denied',
  )
})

test('redaction recursively masks structured and free-text sensitive data', () => {
  const redacted = redactValue(
    {
      memberId: '12345',
      nested: {
        authorization: 'Bearer abcdefghijklmnop',
        note: 'Contact customer@example.com for member 98765',
      },
    },
    { sensitiveFields: ['memberId'] },
  )
  const serialized = JSON.stringify(redacted)
  assert.equal(serialized.includes('12345'), false)
  assert.equal(serialized.includes('abcdefghijklmnop'), false)
  assert.equal(serialized.includes('customer@example.com'), false)
  assert.equal(serialized.includes('98765'), false)
  assert.equal(containsSensitiveText('token=super-secret-value'), true)
  assert.equal(redactText('Bearer abcdefghijklmnop').includes('abcdefghijklmnop'), false)
})

test('JSON contracts validate representative artifacts, outcomes, policies, and interventions', () => {
  const ajv = new Ajv({ allErrors: true, strict: false, formats: { 'date-time': true } })
  const compile = (name: string) =>
    ajv.compile(JSON.parse(readFileSync(resolve(`contracts/${name}.schema.json`), 'utf8')))

  const artifact = compileCapabilityArtifact(draftWithValue('12345'), [
    { name: 'memberId', value: '12345' },
  ])
  const policy = createDefaultPolicy('http://127.0.0.1:4317')
  const result: ReplayResult = {
    kind: 'business_outcome',
    runId: 'run-result',
    capabilityId: artifact.id,
    startedAt: '2026-08-27T12:00:00.000Z',
    finishedAt: '2026-08-27T12:00:01.000Z',
    evidence: { logPath: 'evidence/run-result.jsonl' },
    outcome: 'member_not_found',
    description: 'No matching synthetic member.',
    data: { found: false },
  }
  const intervention: InterventionRequest = {
    schemaVersion: '1.0.0',
    interventionId: 'intervention-1',
    runId: 'run-result',
    capabilityId: artifact.id,
    goal: 'Look up a synthetic member.',
    reason: 'unknown_runtime_state',
    state: 'pending',
    observationFingerprint: 'fingerprint-unknown-dialog',
    allowedOperatorActions: ['click', 'read'],
    requestedAt: '2026-08-27T12:00:00.000Z',
    requestedBy: 'replay',
    lease: {
      leaseId: 'lease-1',
      runId: 'run-result',
      owner: 'automation',
      issuedAt: '2026-08-27T12:00:00.000Z',
    },
  }

  const capabilityValidator = compile('capability')
  const policyValidator = compile('policy')
  const resultValidator = compile('run-result')
  const interventionValidator = compile('intervention')
  assert.equal(capabilityValidator(artifact), true, JSON.stringify(capabilityValidator.errors))
  assert.equal(policyValidator(policy), true, JSON.stringify(policyValidator.errors))
  assert.equal(resultValidator(result), true, JSON.stringify(resultValidator.errors))
  assert.equal(interventionValidator(intervention), true, JSON.stringify(interventionValidator.errors))
})
