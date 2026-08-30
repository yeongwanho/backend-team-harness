import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { HELP_LINES } from '../src/cli/help.mjs'

test('documented CLI commands match the executable help contract', async () => {
  const reference = await readFile(new URL('../docs/CLI-REFERENCE.md', import.meta.url), 'utf8')
  const commands = HELP_LINES.filter((line) => line.startsWith('  bth ')).map((line) => line.trim())
  assert.ok(commands.length > 20)
  for (const command of commands) assert.match(reference, new RegExp('^' + command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'))
  const documented = [...reference.matchAll(/^bth .+$/gm)].map((match) => match[0])
  assert.deepEqual(documented, commands)
})
