// Evaluator-owned fixture. Run only in disposable public acceptance clones.
const { spawnSync } = require('node:child_process')
const { mkdirSync, copyFileSync } = require('node:fs')
const { resolve } = require('node:path')

const root = process.cwd()
const args = ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']
const installation = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')] : args,
  { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
if (installation.error || installation.signal || installation.status !== 0) process.exit(installation.status || 1)
const result = spawnSync(process.execPath, ['test/bth/verify-jest.mjs'],
  { cwd: root, stdio: 'inherit', shell: false, windowsHide: true })
if (result.error || result.signal) process.exit(1)
mkdirSync(resolve(root, 'coverage'), { recursive: true })
try {
  copyFileSync(resolve(root, '.backend-harness/local/reports/tests/junit.xml'), resolve(root, 'coverage/bth-junit.xml'))
} catch {
  // Compiler/setup failures cannot become a behavioral regression or success.
  process.exit(1)
}
process.exit(result.status ?? 1)
