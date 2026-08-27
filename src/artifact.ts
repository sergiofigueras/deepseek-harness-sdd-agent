import { createHash } from 'node:crypto'

import type {
  ActionRisk,
  CapabilityArtifact,
  CapabilityStep,
  InputParameterDefinition,
  JsonPrimitive,
  TenantOverlay,
  ValueExpression,
} from './contracts.js'
import { containsSensitiveText } from './redaction.js'

export type DiscoveredValue = JsonPrimitive | ValueExpression

export interface DiscoveredCapabilityStep extends Omit<CapabilityStep, 'value'> {
  readonly value?: DiscoveredValue
}

export interface CapabilityArtifactDraft
  extends Omit<CapabilityArtifact, 'steps' | 'contentHash' | 'appliedOverlay'> {
  readonly steps: readonly DiscoveredCapabilityStep[]
}

export interface ObservedInputBinding {
  readonly name: string
  readonly value: JsonPrimitive
}

export class ArtifactValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}

export function compileCapabilityArtifact(
  draft: CapabilityArtifactDraft,
  observedInputs: readonly ObservedInputBinding[],
): CapabilityArtifact {
  assertDraftInvariants(draft)
  const bindings = createBindingMap(draft.inputs, observedInputs)

  const steps: CapabilityStep[] = draft.steps.map(step => {
    const { value, ...withoutValue } = step
    return value === undefined
      ? withoutValue
      : { ...withoutValue, value: parameterizeValue(value, draft.inputs, bindings) }
  })

  const withoutHash: Omit<CapabilityArtifact, 'contentHash'> = {
    ...draft,
    steps,
  }
  assertObservedValuesAbsent(withoutHash, observedInputs)
  return withContentHash(withoutHash)
}

export function applyTenantOverlay(base: CapabilityArtifact, overlay: TenantOverlay): CapabilityArtifact {
  if (!verifyCapabilityContentHash(base)) {
    throw new ArtifactValidationError('Base capability content hash is invalid.')
  }
  assertOverlayShape(overlay)
  if (overlay.capabilityId !== base.id || overlay.capabilityVersion !== base.version) {
    throw new ArtifactValidationError('Tenant overlay targets a different capability or version.')
  }
  if (overlay.expectedBaseFingerprint !== base.application.driftFingerprint) {
    throw new ArtifactValidationError('Tenant overlay base fingerprint does not match the capability.')
  }
  if (overlay.driftFingerprint.length < 8) {
    throw new ArtifactValidationError('Tenant overlay drift fingerprint is too short.')
  }

  const stepOverrides = new Map(overlay.locatorOverrides.map(entry => [entry.stepId, entry.locator]))
  if (stepOverrides.size !== overlay.locatorOverrides.length) {
    throw new ArtifactValidationError('Tenant overlay contains duplicate step overrides.')
  }
  for (const stepId of stepOverrides.keys()) {
    const step = base.steps.find(candidate => candidate.id === stepId)
    if (step === undefined) throw new ArtifactValidationError(`Tenant overlay references unknown step: ${stepId}`)
    if (step.target === undefined) {
      throw new ArtifactValidationError(`Tenant overlay cannot add a locator to targetless step: ${stepId}`)
    }
  }

  const outputOverrides = new Map(
    (overlay.outputLocatorOverrides ?? []).map(entry => [entry.outputName, entry.locator]),
  )
  if (outputOverrides.size !== (overlay.outputLocatorOverrides ?? []).length) {
    throw new ArtifactValidationError('Tenant overlay contains duplicate output overrides.')
  }
  for (const outputName of outputOverrides.keys()) {
    if (!base.outputs.some(output => output.name === outputName)) {
      throw new ArtifactValidationError(`Tenant overlay references unknown output: ${outputName}`)
    }
  }

  const { contentHash: verifiedBaseHash, ...baseWithoutHash } = base
  void verifiedBaseHash
  const specialized: Omit<CapabilityArtifact, 'contentHash'> = {
    ...baseWithoutHash,
    application: {
      ...base.application,
      baseUrlPattern: overlay.baseUrlPattern ?? base.application.baseUrlPattern,
      driftFingerprint: overlay.driftFingerprint,
    },
    steps: base.steps.map(step => {
      const target = stepOverrides.get(step.id)
      return target === undefined ? step : { ...step, target }
    }),
    outputs: base.outputs.map(output => {
      const locator = outputOverrides.get(output.name)
      return locator === undefined ? output : { ...output, locator }
    }),
    appliedOverlay: {
      overlayId: overlay.overlayId,
      tenantId: overlay.tenantId,
      appVersion: overlay.appVersion,
    },
  }
  return withContentHash(specialized)
}

export function validateInvocationInputs(
  artifact: CapabilityArtifact,
  value: unknown,
): Readonly<Record<string, JsonPrimitive>> {
  if (!isRecord(value)) throw new ArtifactValidationError('Invocation inputs must be an object.')
  const definitions = new Map(artifact.inputs.map(definition => [definition.name, definition]))
  const unknownNames = Object.keys(value).filter(name => !definitions.has(name))
  if (unknownNames.length > 0) {
    throw new ArtifactValidationError(`Invocation contains unknown inputs: ${unknownNames.join(', ')}`)
  }

  const validated: Record<string, JsonPrimitive> = {}
  for (const definition of artifact.inputs) {
    const candidate = value[definition.name]
    if (candidate === undefined) {
      if (definition.required) throw new ArtifactValidationError(`Required input is missing: ${definition.name}`)
      continue
    }
    if (!isJsonPrimitive(candidate) || candidate === null || typeof candidate !== definition.type) {
      throw new ArtifactValidationError(`Input ${definition.name} must be a ${definition.type}.`)
    }
    if (typeof candidate === 'string' && definition.pattern !== undefined) {
      const expression = compileSafePattern(definition.pattern, definition.name)
      if (!expression.test(candidate)) throw new ArtifactValidationError(`Input ${definition.name} has an invalid format.`)
    }
    if (typeof candidate === 'number') {
      if (definition.minimum !== undefined && candidate < definition.minimum) {
        throw new ArtifactValidationError(`Input ${definition.name} is below its minimum.`)
      }
      if (definition.maximum !== undefined && candidate > definition.maximum) {
        throw new ArtifactValidationError(`Input ${definition.name} is above its maximum.`)
      }
    }
    validated[definition.name] = candidate
  }
  return validated
}

export function resolveValueExpression(
  expression: ValueExpression,
  inputs: Readonly<Record<string, JsonPrimitive>>,
): JsonPrimitive {
  if (expression.source === 'literal') return expression.value
  if (!(expression.name in inputs)) {
    throw new ArtifactValidationError(`No invocation value was provided for input: ${expression.name}`)
  }
  return inputs[expression.name] ?? null
}

export function computeCapabilityContentHash(
  artifact: Omit<CapabilityArtifact, 'contentHash'>,
): string {
  return `sha256:${createHash('sha256').update(canonicalize(artifact)).digest('hex')}`
}

export function verifyCapabilityContentHash(artifact: CapabilityArtifact): boolean {
  const { contentHash, ...hashable } = artifact
  return contentHash === computeCapabilityContentHash(hashable)
}

export function approveCapabilityArtifact(artifact: CapabilityArtifact, reviewer: string): CapabilityArtifact {
  if (!verifyCapabilityContentHash(artifact)) throw new ArtifactValidationError('Cannot approve an artifact with an invalid content hash.')
  if (reviewer.trim() === '') throw new ArtifactValidationError('Artifact approval requires a reviewer identity.')
  if (artifact.declaredRisk === 'irreversible') throw new ArtifactValidationError('Irreversible capabilities cannot be approved for unattended replay.')
  const { contentHash: _contentHash, ...hashable } = artifact
  return withContentHash({
    ...hashable,
    review: { status: 'approved', reviewedBy: reviewer.trim(), reviewedAt: new Date().toISOString() },
  })
}

function withContentHash(artifact: Omit<CapabilityArtifact, 'contentHash'>): CapabilityArtifact {
  return {
    ...artifact,
    contentHash: computeCapabilityContentHash(artifact),
  }
}

function parameterizeValue(
  value: DiscoveredValue,
  definitions: readonly InputParameterDefinition[],
  bindings: ReadonlyMap<string, JsonPrimitive>,
): ValueExpression {
  if (isValueExpression(value)) {
    if (value.source === 'input' && !definitions.some(definition => definition.name === value.name)) {
      throw new ArtifactValidationError(`Step references an undeclared input: ${value.name}`)
    }
    if (value.source === 'literal' && typeof value.value === 'string' && containsSensitiveText(value.value)) {
      throw new ArtifactValidationError('Artifact contains an unbound sensitive literal.')
    }
    return value
  }

  const matches = [...bindings.entries()].filter(([, observed]) => Object.is(observed, value))
  if (matches.length > 1) {
    throw new ArtifactValidationError('Observed value maps to more than one input; parameterization is ambiguous.')
  }
  if (matches.length === 1) return { source: 'input', name: matches[0]?.[0] ?? '' }
  if (typeof value === 'string' && containsSensitiveText(value)) {
    throw new ArtifactValidationError('Artifact contains an unbound sensitive literal.')
  }
  return { source: 'literal', value }
}

function createBindingMap(
  definitions: readonly InputParameterDefinition[],
  bindings: readonly ObservedInputBinding[],
): ReadonlyMap<string, JsonPrimitive> {
  const byName = new Map<string, JsonPrimitive>()
  for (const binding of bindings) {
    if (byName.has(binding.name)) throw new ArtifactValidationError(`Duplicate observed input: ${binding.name}`)
    const definition = definitions.find(candidate => candidate.name === binding.name)
    if (definition === undefined) throw new ArtifactValidationError(`Observed input is not declared: ${binding.name}`)
    if (binding.value === null || typeof binding.value !== definition.type) {
      throw new ArtifactValidationError(`Observed input ${binding.name} must be a ${definition.type}.`)
    }
    byName.set(binding.name, binding.value)
  }
  return byName
}

function assertDraftInvariants(draft: CapabilityArtifactDraft): void {
  if (draft.schemaVersion !== '1.0.0') throw new ArtifactValidationError('Unsupported capability schema version.')
  assertUnique(draft.inputs.map(input => input.name), 'input name')
  assertUnique(draft.outputs.map(output => output.name), 'output name')
  assertUnique(draft.steps.map(step => step.id), 'step id')
  assertUnique(draft.recoveries.map(recovery => recovery.id), 'recovery id')
  assertUnique(draft.businessOutcomes.map(outcome => outcome.code), 'business outcome code')
  if (draft.steps.length === 0) throw new ArtifactValidationError('Capability must contain at least one step.')
  if (!draft.id || !draft.version || !draft.name) throw new ArtifactValidationError('Capability identity is incomplete.')
  if (riskRank(draft.declaredRisk) !== Math.max(...draft.steps.map(step => riskRank(step.risk)))) {
    throw new ArtifactValidationError('Capability declaredRisk must equal its highest step risk.')
  }
  for (const step of draft.steps) {
    if (!step.id || step.timeoutMs <= 0 || !Number.isInteger(step.timeoutMs)) {
      throw new ArtifactValidationError(`Invalid step contract: ${step.id || '<missing>'}`)
    }
    if (step.target !== undefined && step.target.candidates.length === 0) {
      throw new ArtifactValidationError(`Step locator has no candidates: ${step.id}`)
    }
    for (const recoveryId of step.recoveryIds ?? []) {
      if (!draft.recoveries.some(recovery => recovery.id === recoveryId)) {
        throw new ArtifactValidationError(`Step ${step.id} references unknown recovery: ${recoveryId}`)
      }
    }
  }
}

function assertObservedValuesAbsent(
  artifact: Omit<CapabilityArtifact, 'contentHash'>,
  bindings: readonly ObservedInputBinding[],
): void {
  const serialized = canonicalize(artifact)
  for (const binding of bindings) {
    if (binding.value === null || binding.value === '') continue
    const definition = artifact.inputs.find(input => input.name === binding.name)
    if (definition?.sensitive !== true) continue
    if (typeof binding.value === 'boolean') continue
    const serializedValue = String(binding.value)
    if (serialized.includes(serializedValue)) {
      throw new ArtifactValidationError(`Sensitive observed value was not fully parameterized: ${binding.name}`)
    }
  }
}

function assertOverlayShape(overlay: TenantOverlay): void {
  const allowedKeys = new Set([
    'schemaVersion',
    'overlayId',
    'capabilityId',
    'capabilityVersion',
    'tenantId',
    'appVersion',
    'baseUrlPattern',
    'expectedBaseFingerprint',
    'driftFingerprint',
    'locatorOverrides',
    'outputLocatorOverrides',
  ])
  const unexpected = Object.keys(overlay).filter(key => !allowedKeys.has(key))
  if (unexpected.length > 0) {
    throw new ArtifactValidationError(`Tenant overlay contains forbidden semantic fields: ${unexpected.join(', ')}`)
  }
  if (overlay.schemaVersion !== '1.0.0') throw new ArtifactValidationError('Unsupported tenant overlay version.')
  if (!overlay.overlayId || !overlay.tenantId || !overlay.appVersion) {
    throw new ArtifactValidationError('Tenant overlay identity is incomplete.')
  }
  for (const override of overlay.locatorOverrides) {
    if (override.locator.candidates.length === 0) {
      throw new ArtifactValidationError(`Tenant step override has no locator candidates: ${override.stepId}`)
    }
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new ArtifactValidationError(`Duplicate ${label}.`)
}

function riskRank(risk: ActionRisk): number {
  return risk === 'safe' ? 0 : risk === 'risky' ? 1 : 2
}

function isValueExpression(value: DiscoveredValue): value is ValueExpression {
  if (typeof value !== 'object' || value === null || !('source' in value)) return false
  if (value.source === 'input') return 'name' in value && typeof value.name === 'string'
  return value.source === 'literal' && 'value' in value && isJsonPrimitive(value.value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function compileSafePattern(pattern: string, inputName: string): RegExp {
  try {
    return new RegExp(pattern)
  } catch {
    throw new ArtifactValidationError(`Input ${inputName} has an invalid validation pattern.`)
  }
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ArtifactValidationError('Artifacts cannot contain non-finite numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (!isRecord(value)) throw new ArtifactValidationError('Artifacts must contain only serializable values.')
  const fields = Object.entries(value)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
  return `{${fields.join(',')}}`
}
