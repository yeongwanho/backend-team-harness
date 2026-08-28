import { access, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { sharedTemplates } from './templates.mjs'

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function assertInside(root, target) {
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))) {
    return
  }
  throw new Error('Refusing to write outside the target project: ' + target)
}

export async function initProject(inputPath = '.', options = {}) {
  const root = resolve(inputPath)
  await mkdir(root, { recursive: true })

  const created = []
  const skipped = []

  for (const template of sharedTemplates) {
    const target = resolve(root, template.path)
    assertInside(root, target)
    await mkdir(resolve(target, '..'), { recursive: true })

    if (!options.force && await exists(target)) {
      skipped.push(template.path)
      continue
    }

    await writeFile(target, template.content, {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx'
    })
    created.push(template.path)
  }

  return { root, created, skipped }
}

