import { writeFile } from 'node:fs/promises'
import { portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'

// Generated fixture, not a second implementation of Jest verdict handling.
const runner = portableVerificationTemplates({
  canGenerateVerification: true, framework: 'jest', projectPath: '.',
  testArgs: ['--config', 'test/bth/jest.config.cjs', '--ci', '--no-cache']
})[0]
await writeFile(new URL('../benchmarks/public-backend-v1/fixtures/nest/verify-jest.mjs', import.meta.url), runner.content)
