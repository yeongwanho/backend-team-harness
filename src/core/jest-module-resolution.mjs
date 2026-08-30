import { readFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { redactString } from './redaction.mjs'

const overrides = ['modulePaths', 'moduleNameMapper', 'moduleDirectories', 'modulePathIgnorePatterns', 'resolver', 'preset', 'projects', 'globals']
const externalConfigs = ['js', 'ts', 'mjs', 'cjs', 'json', 'cts', 'mts'].map(extension => 'jest.config.' + extension)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const under = (directory, path) => directory === '.' ? path : directory + '/' + path

// A bounded addition to NEW generated gates, not a replacement for Jest's or
// TypeScript's resolver. Never execute configs, infer aliases, or edit a gate.
export async function inspectJestModuleSearch(root, projectPath, document, testArgs) {
  try {
    const jest = document.jest
    if (testArgs.length || !object(jest) || overrides.some(key => key in jest) ||
        !object(jest.transform) || !Object.values(jest.transform).length ||
        !Object.values(jest.transform).every(value => value === 'ts-jest')) return null
    for (const config of externalConfigs) {
      if (await statPath(await resolveSafeProjectPath(root, under(projectPath, config)))) return null
    }
    const source = under(projectPath, 'tsconfig.json')
    const file = await resolveSafeProjectPath(root, source)
    const metadata = await statPath(file)
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 65536) return null
    const text = await readFile(file, 'utf8')
    if (Buffer.byteLength(text) > 65536) return null
    const config = JSON.parse(text)
    if (!object(config) || 'extends' in config || !object(config.compilerOptions) || 'paths' in config.compilerOptions) return null
    const baseUrl = config.compilerOptions.baseUrl
    if (typeof baseUrl !== 'string' || !baseUrl || baseUrl.length > 384 ||
        !/^[A-Za-z0-9_./ -]+$/.test(baseUrl) || baseUrl.startsWith('/') ||
        baseUrl.split('/').includes('..') || redactString(baseUrl).count > 0) return null
    const path = posix.normalize(baseUrl).replace(/\/$/, '') || '.'
    const directory = await resolveSafeProjectPath(root, under(projectPath, path))
    const target = await statPath(directory)
    if (!target?.isDirectory() || target.isSymbolicLink()) return null
    return { path, source }
  } catch { return null }
}

// Enumeration and verification use the same declared addition. Absolute paths
// are resolved at execution so Windows and packages with spaces use one argv.
export function jestModuleSearchArgs(detection, project) {
  return detection.moduleSearchPath === undefined ? [] : ['--modulePaths=' + resolve(project, detection.moduleSearchPath)]
}
