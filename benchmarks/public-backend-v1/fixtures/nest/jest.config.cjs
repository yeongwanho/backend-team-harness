const { resolve } = require('node:path')
module.exports = {
  rootDir: resolve(__dirname, '../..'),
  testMatch: ['<rootDir>/test/bth/file-flow.spec.ts'],
  testEnvironment: 'node',
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs', target: 'es2021', experimentalDecorators: true,
        emitDecoratorMetadata: true, esModuleInterop: true, strictNullChecks: true,
        skipLibCheck: true, sourceMap: false, incremental: false,
        types: ['jest', 'node'], baseUrl: resolve(__dirname, '../..')
      }
    }]
  },
  testTimeout: 10000
}
