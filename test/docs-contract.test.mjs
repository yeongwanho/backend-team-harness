import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { HELP_LINES } from '../src/cli/help.mjs'
import { parseImplementationConfig } from '../src/config/implementation.mjs'

test('documented CLI commands match the executable help contract', async () => {
  const reference = await readFile(new URL('../docs/CLI-REFERENCE.md', import.meta.url), 'utf8')
  const commands = HELP_LINES.filter((line) => line.startsWith('  bth ')).map((line) => line.trim())
  assert.ok(commands.length > 20)
  for (const command of commands) assert.match(reference, new RegExp('^' + command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'))
  const documented = [...reference.matchAll(/^bth .+$/gm)].map((match) => match[0])
  assert.deepEqual(documented, commands)
})

test('documented project-formatting fragment is accepted by the actual config parser', async () => {
  const guide = await readFile(new URL('../docs/PROJECT-FORMATTING.md', import.meta.url), 'utf8')
  const json = guide.match(/```json\n([\s\S]*?)\n```/)[1]
  const config = parseImplementationConfig(JSON.stringify({ schemaVersion: 2, adapter: null, ...JSON.parse(json) }))
  assert.equal(config.formatting.network, false)
  assert.equal(config.formatting.command[0], './mvnw')
  assert.deepEqual(config.formatting.inputs, ['.editorconfig', 'pom.xml'])
  assert.match(guide, /verification.json/)
  assert.match(guide, /32 MiB/)
  assert.match(guide, /OS 네트워크 차단이 아닙니다/)
})
