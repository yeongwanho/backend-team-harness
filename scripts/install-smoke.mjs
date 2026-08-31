import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await mkdtemp(join(tmpdir(), 'bth-install-'))

function run(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 120_000, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n').slice(-8192))
  return result.stdout.trim()
}

try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const packed = run(npm, ['pack', '--silent', '--pack-destination', workspace], root).split(/\r?\n/).at(-1)
  run(npm, ['init', '-y'], workspace)
  run(npm, ['install', '--ignore-scripts', join(workspace, packed)], workspace)
  const packageDocument = JSON.parse(await readFile(join(workspace, 'node_modules', 'backend-team-harness', 'package.json'), 'utf8'))
  if (packageDocument.bin?.bth !== './src/cli.mjs') throw new Error('Packed bth binary contract is missing.')
  const version = run(process.execPath, [join(workspace, 'node_modules', 'backend-team-harness', 'src', 'cli.mjs'), 'version'], workspace)
  if (version !== packageDocument.version) throw new Error('Installed CLI version does not match package metadata.')
  const adapter = pathToFileURL(join(workspace, 'node_modules/backend-team-harness/src/adapters/java-preservation.mjs')).href
  run(process.execPath, ['--input-type=module', '-e', [
    'const { compareJavaPreservation } = await import(process.argv[1]);',
    'const base = "class Customer { @OneToMany List<Order> orders; void add(Order o) { if(o.isNew()) orders.add(o); } }";',
    'if (compareJavaPreservation(base, base.replace("if(o.isNew())", "")).status !== "review-required") throw new Error("Installed portable Java grammar did not detect guard drift");'
  ].join('\n'), adapter], workspace)
  await readFile(join(workspace, 'node_modules/backend-team-harness/vendor/tree-sitter-java/LICENSE'), 'utf8')
  run(npm, ['audit', '--omit=dev', '--audit-level=low'], workspace)
  console.log('Installed package smoke passed for backend-team-harness@' + version)
} finally {
  await rm(workspace, { recursive: true, force: true })
}
