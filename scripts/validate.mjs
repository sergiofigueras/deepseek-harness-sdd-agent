import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const requiredFiles = [
  'README.md',
  'TUTORIAL_LINKEDIN.md',
  'LINKEDIN_POST.md',
  'assets/linkedin-cover.png',
  'AGENTS.md',
  '.dsh/skills/sdd-code-agent/SKILL.md',
  'config/settings.yaml',
  'scripts/bootstrap.sh',
  'scripts/launch.sh',
  'examples/sample-request.md',
  'LICENSE'
]

const failures = []

for (const file of requiredFiles) {
  const path = resolve(root, file)
  try {
    if (!statSync(path).isFile()) failures.push(`${file}: not a file`)
  } catch {
    failures.push(`${file}: missing`)
  }
}

const skill = readFileSync(resolve(root, '.dsh/skills/sdd-code-agent/SKILL.md'), 'utf8')
const settings = readFileSync(resolve(root, 'config/settings.yaml'), 'utf8')
const allTrackedText = requiredFiles
  .filter(file => file.endsWith('.md') || file.endsWith('.yaml') || file.endsWith('.sh'))
  .map(file => readFileSync(resolve(root, file), 'utf8'))
  .join('\n')

if (!skill.startsWith('---\nname: sdd-code-agent\n')) failures.push('skill: invalid frontmatter/name')
if (!skill.includes('provider: \'openai-architecture\'')) failures.push('skill: architecture route missing')
if (!skill.includes("model: 'gpt-5.3-codex'")) failures.push('skill: implementation model missing')
if (!skill.includes("model: 'gpt-5.5'")) failures.push('skill: verification model missing')
if (!settings.includes('reasoning: xhigh')) failures.push('settings: xhigh architecture effort missing')
if (!settings.includes('reasoning: high')) failures.push('settings: high implementation effort missing')
if (!settings.includes('apiKeyEnv: OPENAI_API_KEY')) failures.push('settings: environment credential reference missing')
if (/\bsk-[A-Za-z0-9_-]{12,}\b/.test(allTrackedText)) failures.push('security: possible API key in tracked content')

for (const script of ['scripts/bootstrap.sh', 'scripts/launch.sh']) {
  const result = spawnSync('bash', ['-n', resolve(root, script)], { encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${script}: ${result.stderr.trim()}`)
}

if (failures.length > 0) {
  console.error('Validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Validation passed (${requiredFiles.length} required files, model routes, shell syntax, secret scan).`)
