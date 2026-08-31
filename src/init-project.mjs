import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sharedTemplates } from './templates.mjs'
import { defaultVerificationConfig } from './config/verification.mjs'
import { inspectJvmBuild } from './core/jvm-build-discovery.mjs'
import { scanProjectManifest } from './core/project-manifest.mjs'
import { harnessGitAttributesTemplate, inspectPortableTestBuild, portableVerificationTemplates } from './core/portable-test-discovery.mjs'
import {
  assertNoSymlinkSegments,
  resolveExistingProjectRoot,
  resolveSafeProjectPath,
  statPath
} from './fs-safety.mjs'

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

async function atomicReplace(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function initProject(inputPath = '.', options = {}) {
  const root = await resolveExistingProjectRoot(inputPath, {
    allowUnversioned: options.allowUnversioned,
    homeDirectory: options.homeDirectory
  })
  const harnessRoot = resolve(root, '.backend-harness')
  await assertNoSymlinkSegments(root, harnessRoot)

  const created = []
  const updated = []
  const skipped = []
  const backups = []
  const backupStamp = timestampForPath(options.now?.() ?? new Date()) + '-' + (options.backupSuffix ?? randomUUID().slice(0, 8))
  const writes = []
  const manifest = await scanProjectManifest(root, {
    maxDepth: 12,
    maxEntries: 100_000,
    onLimit: 'throw',
    onReadError: 'throw'
  })
  const detection = await inspectJvmBuild(root, manifest, {
    inspectRuntime: false,
    preferredSystem: options.preferredSystem
  })
  const portableDetection = detection.canGenerateVerification
    ? null
    : await inspectPortableTestBuild(root, manifest)
  const activeDetection = detection.canGenerateVerification ? detection : portableDetection
  const detectedVerification = await defaultVerificationConfig(root, { manifest, detection, portableDetection })
  const detectedTemplates = sharedTemplates.map((template) => {
    if (template.path === '.backend-harness/implementation.json' && portableDetection?.canGenerateVerification && portableDetection.uv) {
      const document = JSON.parse(template.content)
      document.workspacePreparation = { kind: 'uv-sync-offline', projectPath: portableDetection.projectPath, timeoutMs: 180000 }
      return { ...template, content: JSON.stringify(document, null, 2) + '\n' }
    }
    if (template.path === '.backend-harness/implementation.json' &&
        ['jest', 'vitest'].includes(portableDetection?.framework)) {
      const prefix = portableDetection.projectPath === '.' ? '' : portableDetection.projectPath + '/'
      if (portableDetection.buildInputs.includes(prefix + 'package-lock.json')) {
        const document = JSON.parse(template.content)
        document.workspacePreparation = { kind: 'npm-ci-offline', projectPath: portableDetection.projectPath, timeoutMs: 180000 }
        return { ...template, content: JSON.stringify(document, null, 2) + '\n' }
      }
    }
    if (template.path !== '.backend-harness/project.md') return template
    return {
      ...template,
      content: template.content
        .replace('framework: unknown', 'framework: ' + activeDetection.framework)
        .replace('build: unknown', 'build: ' + activeDetection.label)
    }
  })
  const portableTemplates = portableVerificationTemplates(portableDetection)
  const gitAttributes = harnessGitAttributesTemplate()
  if (!portableTemplates.some(template => template.path === gitAttributes.path)) {
    detectedTemplates.push(gitAttributes)
  }
  for (const gate of detectedVerification?.gates ?? []) {
    gate.inputs = [...new Set([...(gate.inputs ?? []), gitAttributes.path])]
  }
  const templates = detectedVerification
    ? [...detectedTemplates, ...portableTemplates, {
        path: '.backend-harness/verification.json',
        content: JSON.stringify(detectedVerification, null, 2) + '\n'
      }]
    : detectedTemplates

  for (const template of templates) {
    const target = await resolveSafeProjectPath(root, template.path)
    const parent = dirname(target)
    await assertNoSymlinkSegments(root, parent)
    await assertNoSymlinkSegments(root, target)
    const existing = await statPath(target)

    if (existing?.isSymbolicLink()) {
      throw new Error('Refusing to replace a symbolic link: ' + target)
    }
    if (existing && !existing.isFile()) {
      throw new Error('Expected a regular file but found another filesystem entry: ' + target)
    }
    if (!options.force && existing) {
      skipped.push(template.path)
      continue
    }

    let backup = null
    if (existing) {
      const backupRelative = join(
        '.backend-harness/local/backups',
        backupStamp,
        relative('.backend-harness', template.path)
      )
      backup = await resolveSafeProjectPath(root, backupRelative)
    }
    writes.push({ template, target, parent, existing, backup })
  }

  for (const write of writes) {
    await mkdir(write.parent, { recursive: true })
    if (write.existing) {
      const backup = write.backup
      await mkdir(dirname(backup), { recursive: true })
      await writeFile(backup, await readFile(write.target), { flag: 'wx' })
      backups.push(relative(root, backup))
      await atomicReplace(write.target, write.template.content)
      if (write.template.executable) await chmod(write.target, 0o755)
      updated.push(write.template.path)
    } else {
      await writeFile(write.target, write.template.content, { encoding: 'utf8', flag: 'wx' })
      if (write.template.executable) await chmod(write.target, 0o755)
      created.push(write.template.path)
    }
  }

  return {
    root,
    created,
    updated,
    skipped,
    backups,
    detection: {
      status: activeDetection.status,
      system: activeDetection.system,
      build: activeDetection.label,
      framework: activeDetection.framework,
      productionModules: activeDetection.productionModules ?? [],
      testModules: activeDetection.testModules ?? (activeDetection.projectPath ? [activeDetection.projectPath] : []),
      wrapper: activeDetection.wrapper ?? null,
      diagnostics: activeDetection.diagnostics
    }
  }
}
