import { migrateProjectConfig } from '../config/migration.mjs'
import { assertPositionalCount, parseArguments, printResult } from './options.mjs'

export async function runConfigCommand(args) {
  const [subcommand, ...rest] = args
  if (subcommand !== 'migrate') throw new Error('Usage: bth config migrate [path] --allow-write [--json]')
  const parsed = parseArguments(rest, { booleans: ['--allow-write', '--json'] })
  assertPositionalCount(parsed.positionals, 0, 1, 'bth config migrate [path] --allow-write [--json]')
  const result = await migrateProjectConfig(parsed.positionals[0] ?? '.', { allowWrite: parsed.flags.has('--allow-write') })
  printResult(result, parsed.flags.has('--json'), () => {
    if (result.changed) {
      console.log('Migrated implementation config schema v' + result.from + ' to v' + result.to + '.')
      console.log('Backup: ' + result.backup)
    } else {
      console.log('Implementation config is already schema v' + result.to + '; no files changed.')
    }
  })
}
