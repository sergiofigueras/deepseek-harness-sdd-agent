import type { JsonValue } from './contracts.js'

export interface RedactionOptions {
  readonly sensitiveFields?: readonly string[]
  readonly replacementPrefix?: string
}

const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'secret',
  'apiKey',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'setCookie',
  'credential',
  'credentials',
  'memberId',
  'accountId',
  'routingNumber',
  'socialSecurityNumber',
  'ssn',
  'email',
] as const

const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:member|account|routing|ssn)(?:\s+(?:id|number))?\s*[:#=-]?\s*\d{4,}\b/gi,
  /\b\d{8,}\b/g,
]

const normalizeFieldName = (field: string): string => field.replace(/[^a-z0-9]/gi, '').toLowerCase()

const replacementFor = (label: string, prefix: string): string =>
  `[${prefix}:${label.replace(/[^A-Za-z0-9_-]/g, '_')}]`

export function isSensitiveField(field: string, configuredFields: readonly string[] = []): boolean {
  const normalized = normalizeFieldName(field)
  const sensitive = [...DEFAULT_SENSITIVE_FIELDS, ...configuredFields].map(normalizeFieldName)
  return sensitive.some(candidate => normalized === candidate || normalized.endsWith(candidate))
}

export function containsSensitiveText(value: string): boolean {
  return SECRET_TEXT_PATTERNS.some(pattern => {
    pattern.lastIndex = 0
    return pattern.test(value)
  })
}

export function redactText(value: string, replacement = '[REDACTED:text]'): string {
  let redacted = value
  for (const pattern of SECRET_TEXT_PATTERNS) {
    pattern.lastIndex = 0
    redacted = redacted.replace(pattern, replacement)
  }
  return redacted
}

export function redactValue(value: unknown, options: RedactionOptions = {}): JsonValue {
  const prefix = options.replacementPrefix ?? 'REDACTED'
  const configuredFields = options.sensitiveFields ?? []
  const visited = new WeakSet<object>()

  const visit = (current: unknown): JsonValue => {
    if (current === null) return null
    if (typeof current === 'string') return redactText(current, replacementFor('text', prefix))
    if (typeof current === 'number') return Number.isFinite(current) ? current : String(current)
    if (typeof current === 'boolean') return current
    if (typeof current === 'bigint') return current.toString()
    if (typeof current !== 'object') return `[${prefix}:omitted]`

    if (visited.has(current)) return `[${prefix}:circular]`
    visited.add(current)

    if (Array.isArray(current)) return current.map(visit)

    const redacted: Record<string, JsonValue> = {}
    for (const [key, nested] of Object.entries(current)) {
      redacted[key] = isSensitiveField(key, configuredFields)
        ? replacementFor(key, prefix)
        : visit(nested)
    }
    return redacted
  }

  return visit(value)
}

export function containsSensitiveValue(value: unknown, sensitiveFields: readonly string[] = []): boolean {
  const original = safeStringify(value)
  const redacted = safeStringify(redactValue(value, { sensitiveFields }))
  return original !== redacted
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[unserializable]'
  }
}
