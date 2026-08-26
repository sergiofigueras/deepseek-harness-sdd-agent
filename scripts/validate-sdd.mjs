import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const targetRoot = resolve(rootIndex >= 0 ? args[rootIndex + 1] : '.')
const required = args.includes('--required')
const projectRoot = resolve(import.meta.dirname, '..')
const statusPath = resolve(targetRoot, 'docs/sdd/status.json')

if (!existsSync(statusPath)) {
  if (required) {
    console.error(`SDD validation failed: required status missing at ${statusPath}`)
    process.exit(1)
  }
  console.log(`No SDD status found at ${statusPath}; nothing to validate.`)
  process.exit(0)
}

const parse = path => JSON.parse(readFileSync(path, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const statusSchema = parse(resolve(projectRoot, 'contracts/sdd/status.schema.json'))
const manifestSchema = parse(resolve(projectRoot, 'contracts/sdd/manifest.schema.json'))
const status = parse(statusPath)
const validateStatus = ajv.compile(statusSchema)

const failures = []
if (!validateStatus(status)) failures.push(`status.json: ${ajv.errorsText(validateStatus.errors)}`)

const ids = status.acceptanceCriteria?.map(item => item.id) ?? []
if (new Set(ids).size !== ids.length) failures.push('status.json: acceptance-criterion ids must be unique')
if (status.status === 'verified') {
  for (const criterion of status.acceptanceCriteria ?? []) {
    if (criterion.implementedBy.length === 0) failures.push(`${criterion.id}: missing implementation evidence`)
    if (criterion.verifiedBy.length === 0) failures.push(`${criterion.id}: missing verification evidence`)
  }
  const verificationPath = resolve(targetRoot, 'docs/sdd/VERIFICATION.md')
  if (!existsSync(verificationPath)) failures.push('verified status requires docs/sdd/VERIFICATION.md')
  else {
    const verification = readFileSync(verificationPath, 'utf8')
    for (const id of ids) if (!verification.includes(id)) failures.push(`VERIFICATION.md: missing ${id}`)
  }
}

const manifestPath = resolve(targetRoot, '.sdd-runs', status.runId ?? '', 'manifest.json')
if (!existsSync(manifestPath)) failures.push(`manifest missing: ${manifestPath}`)
else {
  const manifest = parse(manifestPath)
  const validateManifest = ajv.compile(manifestSchema)
  if (!validateManifest(manifest)) failures.push(`manifest.json: ${ajv.errorsText(validateManifest.errors)}`)
  if (manifest.runId !== status.runId) failures.push('manifest.json: runId does not match status.json')
}

if (failures.length > 0) {
  console.error('SDD validation failed:')
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`SDD validation passed for run ${status.runId} (${ids.length} acceptance criteria).`)
