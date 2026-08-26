import { readFileSync } from 'node:fs'

const WORKFLOW_MARKER = 'Pass the following plain JavaScript body as `script`.'

export function extractWorkflowScript(skillPath) {
  const markdown = readFileSync(skillPath, 'utf8')
  const markerIndex = markdown.indexOf(WORKFLOW_MARKER)
  if (markerIndex < 0) throw new Error('workflow script marker not found')
  const match = markdown.slice(markerIndex).match(/```javascript\n([\s\S]*?)\n```/)
  if (!match) throw new Error('workflow JavaScript block not found')
  return match[1]
}

export function assertHarnessSchemaSubset(schema, location = 'schema') {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf'])
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`${location} must be an object`)
  }
  for (const [key, value] of Object.entries(schema)) {
    if (!allowed.has(key)) throw new Error(`${location} uses unsupported keyword ${key}`)
    if (key === 'properties') {
      for (const [name, child] of Object.entries(value)) assertHarnessSchemaSubset(child, `${location}.properties.${name}`)
    } else if (key === 'items') {
      assertHarnessSchemaSubset(value, `${location}.items`)
    } else if (key === 'oneOf') {
      value.forEach((child, index) => assertHarnessSchemaSubset(child, `${location}.oneOf[${index}]`))
    }
  }
}

export async function runWorkflowSimulation({ script, args, responses }) {
  const calls = []
  const phases = []
  const queue = [...responses]
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const execute = new AsyncFunction('args', 'agent', 'phase', 'log', script)
  const result = await execute(
    args,
    async (prompt, options) => {
      calls.push({ prompt, options })
      if (options?.schema) assertHarnessSchemaSubset(options.schema)
      if (queue.length === 0) throw new Error('simulation response queue exhausted')
      return queue.shift()
    },
    title => phases.push(title),
    () => {}
  )
  if (queue.length > 0) throw new Error(`simulation left ${queue.length} unused response(s)`)
  return { result, calls, phases }
}
