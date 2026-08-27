export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type PrimitiveType = 'string' | 'number' | 'boolean'

export type ActionRisk = 'safe' | 'risky' | 'irreversible'

export type SurfaceActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'read'
  | 'wait'
  | 'complete'
  | 'escalate'

export type ExecutableActionType = Exclude<SurfaceActionType, 'complete' | 'escalate'>

export interface RoleLocator {
  readonly strategy: 'role'
  readonly role: string
  readonly name?: string
  readonly exact?: boolean
}

export interface LabelLocator {
  readonly strategy: 'label'
  readonly text: string
  readonly exact?: boolean
}

export interface TextLocator {
  readonly strategy: 'text'
  readonly text: string
  readonly exact?: boolean
}

export interface CssLocator {
  readonly strategy: 'css'
  readonly selector: string
}

export interface CoordinateLocator {
  readonly strategy: 'coordinate'
  readonly x: number
  readonly y: number
  readonly referenceFingerprint: string
}

export type LocatorCandidate =
  | RoleLocator
  | LabelLocator
  | TextLocator
  | CssLocator
  | CoordinateLocator

export interface LocatorBundle {
  readonly candidates: readonly LocatorCandidate[]
  readonly framePath?: readonly LocatorCandidate[]
  readonly robustnessNote: string
}

export interface InputReference {
  readonly source: 'input'
  readonly name: string
}

export interface LiteralValue {
  readonly source: 'literal'
  readonly value: JsonPrimitive
}

export type ValueExpression = InputReference | LiteralValue

export interface UrlMatchesAssertion {
  readonly kind: 'url_matches'
  readonly pattern: string
}

export interface VisibleAssertion {
  readonly kind: 'visible'
  readonly locator: LocatorBundle
}

export interface TextMatchesAssertion {
  readonly kind: 'text_matches'
  readonly locator: LocatorBundle
  readonly pattern: string
}

export interface OutputEqualsAssertion {
  readonly kind: 'output_equals'
  readonly outputName: string
  readonly expected: ValueExpression
}

export type Assertion =
  | UrlMatchesAssertion
  | VisibleAssertion
  | TextMatchesAssertion
  | OutputEqualsAssertion

export interface InputParameterDefinition {
  readonly name: string
  readonly type: PrimitiveType
  readonly description: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly pattern?: string
  readonly minimum?: number
  readonly maximum?: number
}

export interface OutputDefinition {
  readonly name: string
  readonly type: PrimitiveType
  readonly description: string
  readonly required: boolean
  readonly locator: LocatorBundle
  readonly extraction: 'text' | 'value' | 'attribute'
  readonly attributeName?: string
}

export interface CapabilityStep {
  readonly id: string
  readonly action: ExecutableActionType
  readonly risk: ActionRisk
  readonly description: string
  readonly target?: LocatorBundle
  readonly value?: ValueExpression
  readonly outputName?: string
  readonly durationMs?: number
  readonly timeoutMs: number
  readonly postcondition?: Assertion
  readonly recoveryIds?: readonly string[]
}

export interface BusinessOutcomeDefinition {
  readonly code: string
  readonly description: string
  readonly condition: Assertion
  readonly data?: JsonObject
}

export interface RecoveryRule {
  readonly id: string
  readonly condition:
    | 'known_dialog'
    | 'transient_load'
    | 'known_interstitial'
    | 'temporary_unavailable'
  readonly maxAttempts: number
  readonly backoffMs: number
  readonly action?: CapabilityStep
}

export interface ApplicationIdentity {
  readonly vendor: string
  readonly product: string
  readonly baseUrlPattern: string
  readonly compatibleVersionRange: string
  readonly driftFingerprint: string
}

export interface CapabilityProvenance {
  readonly discoveredAt: string
  readonly model: string
  readonly sourceTarget: string
  readonly evidenceRunId: string
}

export interface ArtifactReview {
  readonly status: 'draft' | 'approved' | 'rejected'
  readonly reviewedBy?: string
  readonly reviewedAt?: string
}

export interface AppliedTenantOverlay {
  readonly overlayId: string
  readonly tenantId: string
  readonly appVersion: string
}

export interface CapabilityArtifact {
  readonly schemaVersion: '1.0.0'
  readonly id: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly application: ApplicationIdentity
  readonly inputs: readonly InputParameterDefinition[]
  readonly outputs: readonly OutputDefinition[]
  readonly steps: readonly CapabilityStep[]
  readonly checkpoint: Assertion
  readonly businessOutcomes: readonly BusinessOutcomeDefinition[]
  readonly recoveries: readonly RecoveryRule[]
  readonly declaredRisk: ActionRisk
  readonly provenance: CapabilityProvenance
  readonly review: ArtifactReview
  readonly appliedOverlay?: AppliedTenantOverlay
  readonly contentHash: string
}

export interface TenantLocatorOverride {
  readonly stepId: string
  readonly locator: LocatorBundle
}

export interface TenantOutputLocatorOverride {
  readonly outputName: string
  readonly locator: LocatorBundle
}

export interface TenantOverlay {
  readonly schemaVersion: '1.0.0'
  readonly overlayId: string
  readonly capabilityId: string
  readonly capabilityVersion: string
  readonly tenantId: string
  readonly appVersion: string
  readonly baseUrlPattern?: string
  readonly expectedBaseFingerprint: string
  readonly driftFingerprint: string
  readonly locatorOverrides: readonly TenantLocatorOverride[]
  readonly outputLocatorOverrides?: readonly TenantOutputLocatorOverride[]
}

export interface EvidenceReference {
  readonly logPath: string
  readonly screenshotPath?: string
  readonly htmlSnapshotPath?: string
}

export interface ReplayResultBase {
  readonly runId: string
  readonly capabilityId: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly evidence: EvidenceReference
}

export interface ReplaySuccess extends ReplayResultBase {
  readonly kind: 'success'
  readonly outputs: Readonly<Record<string, JsonPrimitive>>
  readonly recoveriesApplied: readonly string[]
}

export interface ReplayBusinessOutcome extends ReplayResultBase {
  readonly kind: 'business_outcome'
  readonly outcome: string
  readonly description: string
  readonly data: JsonObject
}

export type ReplayFailureCategory =
  | 'policy_denied'
  | 'invalid_invocation'
  | 'target_missing'
  | 'permission_denied'
  | 'session_expired'
  | 'retry_exhausted'
  | 'checkpoint_mismatch'
  | 'intervention_required'
  | 'internal_error'

export interface ReplayFailureDetail {
  readonly category: ReplayFailureCategory
  readonly message: string
  readonly stepId?: string
  readonly stepIndex?: number
  readonly expected?: string
  readonly observed?: string
  readonly retryable: boolean
}

export interface ReplayFailure extends ReplayResultBase {
  readonly kind: 'failure'
  readonly failure: ReplayFailureDetail
}

export type ReplayResult = ReplaySuccess | ReplayBusinessOutcome | ReplayFailure

export type ControlOwner = 'automation' | 'human' | 'none'

export type HandoffState =
  | 'automation'
  | 'pending_human'
  | 'human'
  | 'completed'
  | 'failed'

export interface ControlLease {
  readonly leaseId: string
  readonly runId: string
  readonly owner: ControlOwner
  readonly issuedAt: string
  readonly expiresAt?: string
}

export interface InterventionRequest {
  readonly schemaVersion: '1.0.0'
  readonly interventionId: string
  readonly runId: string
  readonly capabilityId?: string
  readonly goal: string
  readonly reason:
    | 'agent_stuck'
    | 'unknown_runtime_state'
    | 'policy_denied'
    | 'risky_action_approval'
    | 'replay_failure'
  readonly state: 'pending' | 'claimed' | 'resolved' | 'cancelled'
  readonly currentStepId?: string
  readonly currentStepIndex?: number
  readonly observationFingerprint: string
  readonly screenshotPath?: string
  readonly allowedOperatorActions: readonly SurfaceActionType[]
  readonly requestedAt: string
  readonly requestedBy: 'discovery' | 'replay' | 'policy'
  readonly lease: ControlLease
  readonly resolution?: {
    readonly resolvedAt: string
    readonly resolvedBy: string
    readonly actionSummary: string
    readonly beforeFingerprint: string
    readonly afterFingerprint: string
    readonly resumeAutomation: boolean
  }
}

export interface RiskPolicy {
  readonly safe: 'allow' | 'deny'
  readonly risky: 'require_approval' | 'deny'
  readonly irreversible: 'deny'
}

export interface AutomationPolicy {
  readonly schemaVersion: '1.0.0'
  readonly allowedOrigins: readonly string[]
  readonly allowedRoutes: readonly string[]
  readonly allowedActions: readonly SurfaceActionType[]
  readonly maximumTextLength: number
  readonly risk: RiskPolicy
  readonly sensitiveFields: readonly string[]
  readonly approvalTtlMs: number
}

export interface RiskApproval {
  readonly approvalId: string
  readonly runId: string
  readonly actionTypes: readonly SurfaceActionType[]
  readonly issuedAt: string
  readonly expiresAt: string
}

export interface PolicyAuthorizationRequest {
  readonly runId: string
  readonly action: SurfaceActionType
  readonly risk: ActionRisk
  readonly targetUrl: string
  readonly text?: string
  readonly approval?: RiskApproval
}

export type PolicyDenialCode =
  | 'invalid_url'
  | 'origin_not_allowed'
  | 'route_not_allowed'
  | 'action_not_allowed'
  | 'text_too_long'
  | 'safe_action_denied'
  | 'approval_required'
  | 'approval_invalid'
  | 'irreversible_action_denied'

export type PolicyDecision =
  | {
      readonly allowed: true
      readonly code: 'allowed'
      readonly reason: string
    }
  | {
      readonly allowed: false
      readonly code: PolicyDenialCode
      readonly reason: string
      readonly requiresIntervention: boolean
    }
