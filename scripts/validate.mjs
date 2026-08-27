import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Ajv from 'ajv'
import YAML from 'yaml'
import { assertHarnessSchemaSubset, extractWorkflowScript } from './lib/workflow-contract.mjs'

const root = resolve(import.meta.dirname, '..')
const requiredFiles = [
  '.dsh/skills/sdd-code-agent/SKILL.md',
  '.env.example',
  '.github/workflows/ci.yml',
  '.gitignore',
  'AGENTS.md',
  'CHANGELOG.md',
  'REPORT.md',
  'LICENSE',
  'LINKEDIN_POST.md',
  'README.md',
  'TUTORIAL_LINKEDIN.md',
  'config/settings.yaml',
  'contracts/sdd/architecture.schema.json',
  'contracts/sdd/implementation.schema.json',
  'contracts/sdd/manifest.schema.json',
  'contracts/sdd/status.schema.json',
  'contracts/sdd/verification.schema.json',
  'contracts/capability.schema.json',
  'contracts/intervention.schema.json',
  'contracts/policy.schema.json',
  'contracts/run-result.schema.json',
  'docs/ARCHITECTURE.md',
  'docs/EVALUATION.md',
  'docs/sdd/PLAN.md',
  'docs/sdd/SPEC.md',
  'docs/sdd/status.json',
  'evidence/README.md',
  'evidence/live-example-capability.json',
  'evidence/offline-demo-result.json',
  'evals/cases.jsonl',
  'examples/sample-request.md',
  'package-lock.json',
  'scripts/bootstrap.sh',
  'scripts/launch.sh',
  'scripts/simulate-e2e.mjs',
  'scripts/validate-sdd.mjs',
  'src/artifact.ts',
  'src/cli.ts',
  'src/contracts.ts',
  'src/demo/server.ts',
  'src/discovery.ts',
  'src/evidence.ts',
  'src/handoff.ts',
  'src/model.ts',
  'src/policy.ts',
  'src/redaction.ts',
  'src/replay.ts',
  'src/surface/playwright-surface.ts',
  'src/surface/types.ts',
  'tests/computer-use.test.ts',
  'tests/domain-policy.test.ts',
  'tsconfig.json',
]

const failures = []
const existing = []
for (const file of requiredFiles) {
  const path = resolve(root, file)
  try {
    if (!statSync(path).isFile()) failures.push(`${file}: not a file`)
    else existing.push(file)
  } catch {
    failures.push(`${file}: missing`)
  }
}

const read = file => readFileSync(resolve(root, file), 'utf8')
if (existing.includes('.dsh/skills/sdd-code-agent/SKILL.md')) {
  const skill = read('.dsh/skills/sdd-code-agent/SKILL.md')
  if (!skill.startsWith('---\nname: sdd-code-agent\n')) failures.push('skill: invalid frontmatter/name')
  for (const expected of ["provider: 'openai-architecture'", "model: 'gpt-5.3-codex'", "model: 'gpt-5.5'", 'schema: architectureSchema', 'schema: implementationSchema', 'schema: verificationSchema']) {
    if (!skill.includes(expected)) failures.push(`skill: missing ${expected}`)
  }
  try {
    const script = extractWorkflowScript(resolve(root, '.dsh/skills/sdd-code-agent/SKILL.md'))
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    new AsyncFunction('args', 'agent', 'phase', 'log', script)
    const declarations = script.slice(0, script.indexOf('let architecture = null'))
    for (const name of ['architectureSchema', 'implementationSchema', 'verificationSchema']) {
      const capture = new AsyncFunction('args', `${declarations}\nreturn ${name}`)
      assertHarnessSchemaSubset(await capture({ request: 'validation' }))
    }
  } catch (error) {
    failures.push(`skill workflow: ${error.message}`)
  }
}

if (existing.includes('config/settings.yaml')) {
  try {
    const settings = YAML.parse(read('config/settings.yaml'))
    const providers = settings?.['llm-pi-ai']?.providers
    if (providers?.['openai-architecture']?.reasoning !== 'xhigh') failures.push('settings: xhigh architecture route missing')
    if (providers?.['openai-implementation']?.reasoning !== 'high') failures.push('settings: high implementation route missing')
    if (providers?.['openai-architecture']?.apiKeyEnv !== 'OPENAI_API_KEY') failures.push('settings: environment credential reference missing')
    if (providers?.['openai-implementation']?.apiKeyEnv !== 'OPENAI_API_KEY') failures.push('settings: implementation environment credential reference missing')
  } catch (error) {
    failures.push(`settings YAML: ${error.message}`)
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
ajv.addFormat('date-time', value => Number.isFinite(Date.parse(value)))
for (const file of existing.filter(file => file.startsWith('contracts/') && file.endsWith('.json'))) {
  try {
    ajv.compile(JSON.parse(read(file)))
  } catch (error) {
    failures.push(`${file}: ${error.message}`)
  }
}

const gitFiles = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
const repositoryFiles = gitFiles.status === 0
  ? gitFiles.stdout.trim().split('\n').filter(Boolean)
  : collectProjectFiles(root)
const textFiles = repositoryFiles.filter(file => /\.(md|yaml|yml|sh|json|jsonl|mjs|ts)$/.test(file))
const trackedText = textFiles.map(read).join('\n')
if (/\bsk-[A-Za-z0-9_-]{12,}\b/.test(trackedText)) failures.push('security: possible API key in tracked content')

function collectProjectFiles(directory) {
  const ignored = new Set(['.git', 'node_modules', '.dsh-home', '.serena'])
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectProjectFiles(absolute))
    else if (entry.isFile()) files.push(relative(root, absolute))
  }
  return files
}

for (const script of ['scripts/bootstrap.sh', 'scripts/launch.sh']) {
  if (!existing.includes(script)) continue
  const result = spawnSync('bash', ['-n', resolve(root, script)], { encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${script}: ${result.stderr.trim()}`)
}

if (failures.length > 0) {
  console.error('Validation failed:')
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Validation passed: ${requiredFiles.length} files, YAML, schemas, workflow syntax, Harness schema subset, shell syntax, and secret scan.`)
