import type {
  AutomationPolicy,
  PolicyAuthorizationRequest,
  PolicyDecision,
  RiskApproval,
  SurfaceActionType,
} from './contracts.js'

export type Clock = () => number

export class PolicyEngine {
  readonly #policy: AutomationPolicy
  readonly #clock: Clock
  readonly #allowedOrigins: ReadonlySet<string>

  public constructor(policy: AutomationPolicy, clock: Clock = Date.now) {
    validatePolicy(policy)
    this.#policy = policy
    this.#clock = clock
    this.#allowedOrigins = new Set(policy.allowedOrigins.map(normalizeOrigin))
  }

  public authorize(request: PolicyAuthorizationRequest): PolicyDecision {
    const url = parseHttpUrl(request.targetUrl)
    if (url === null) return deny('invalid_url', 'The target URL is not a valid HTTP(S) URL.', true)

    if (!this.#allowedOrigins.has(url.origin)) {
      return deny('origin_not_allowed', 'The target origin is outside the configured allowlist.', true)
    }

    if (!this.#policy.allowedRoutes.some(pattern => matchesRoute(url.pathname, pattern))) {
      return deny('route_not_allowed', 'The target route is outside the configured allowlist.', true)
    }

    if (!this.#policy.allowedActions.includes(request.action)) {
      return deny('action_not_allowed', 'The action type is outside the configured allowlist.', true)
    }

    if (request.text !== undefined && request.text.length > this.#policy.maximumTextLength) {
      return deny('text_too_long', 'The action text exceeds the configured maximum length.', true)
    }

    if (request.risk === 'irreversible') {
      return deny(
        'irreversible_action_denied',
        'Irreversible actions are denied by policy and cannot be enabled by model output.',
        true,
      )
    }

    if (request.risk === 'safe') {
      return this.#policy.risk.safe === 'allow'
        ? allow('The action is allowlisted and classified as safe.')
        : deny('safe_action_denied', 'Safe actions are disabled by the active policy.', true)
    }

    if (this.#policy.risk.risky === 'deny') {
      return deny('approval_required', 'Risky actions are denied by the active policy.', true)
    }

    if (request.approval === undefined) {
      return deny('approval_required', 'A run-bound approval is required for this risky action.', true)
    }

    if (!this.#isValidApproval(request.approval, request.runId, request.action)) {
      return deny('approval_invalid', 'The supplied approval is expired or not valid for this run and action.', true)
    }

    return allow('The risky action is allowlisted and covered by a valid run-bound approval.')
  }

  #isValidApproval(approval: RiskApproval, runId: string, action: SurfaceActionType): boolean {
    const issuedAt = Date.parse(approval.issuedAt)
    const expiresAt = Date.parse(approval.expiresAt)
    const now = this.#clock()
    return (
      approval.runId === runId &&
      approval.actionTypes.includes(action) &&
      Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      issuedAt <= now &&
      expiresAt > now &&
      expiresAt > issuedAt &&
      expiresAt - issuedAt <= this.#policy.approvalTtlMs
    )
  }
}

export function createDefaultPolicy(origin: string): AutomationPolicy {
  return {
    schemaVersion: '1.0.0',
    allowedOrigins: [normalizeOrigin(origin)],
    allowedRoutes: ['/**'],
    allowedActions: ['navigate', 'click', 'type', 'read', 'wait', 'complete', 'escalate'],
    maximumTextLength: 512,
    risk: {
      safe: 'allow',
      risky: 'require_approval',
      irreversible: 'deny',
    },
    sensitiveFields: ['memberId', 'accountId'],
    approvalTtlMs: 15 * 60 * 1_000,
  }
}

function validatePolicy(policy: AutomationPolicy): void {
  if (policy.allowedOrigins.length === 0) throw new Error('Policy must allow at least one origin.')
  if (policy.allowedRoutes.length === 0) throw new Error('Policy must allow at least one route pattern.')
  if (policy.allowedActions.length === 0) throw new Error('Policy must allow at least one action type.')
  if (!Number.isInteger(policy.maximumTextLength) || policy.maximumTextLength < 0) {
    throw new Error('Policy maximumTextLength must be a non-negative integer.')
  }
  if (!Number.isInteger(policy.approvalTtlMs) || policy.approvalTtlMs <= 0) {
    throw new Error('Policy approvalTtlMs must be a positive integer.')
  }
  if (policy.risk.irreversible !== 'deny') {
    throw new Error('Policy must deny irreversible actions.')
  }
  for (const origin of policy.allowedOrigins) normalizeOrigin(origin)
  for (const route of policy.allowedRoutes) {
    if (!route.startsWith('/')) throw new Error(`Policy route must start with '/': ${route}`)
  }
}

function normalizeOrigin(value: string): string {
  const url = parseHttpUrl(value)
  if (url === null || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(`Invalid policy origin: ${value}`)
  }
  return url.origin
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function matchesRoute(pathname: string, pattern: string): boolean {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === undefined) continue
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  source += '$'
  return new RegExp(source).test(pathname)
}

function allow(reason: string): PolicyDecision {
  return { allowed: true, code: 'allowed', reason }
}

function deny(
  code: Exclude<PolicyDecision, { readonly allowed: true }>['code'],
  reason: string,
  requiresIntervention: boolean,
): PolicyDecision {
  return { allowed: false, code, reason, requiresIntervention }
}
