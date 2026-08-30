import { readFile } from 'node:fs/promises'
import { isAbsolute, posix } from 'node:path'

const SHA = /^[a-f0-9]{40}$/
const ID = /^[a-z][a-z0-9-]{2,95}$/
const LANGUAGES = new Set(['java', 'kotlin', 'typescript', 'javascript', 'python'])

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object.')
  return value
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(label + ' is invalid.')
  return value
}

function safePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error(label + ' is invalid.')
  const portable = value.replaceAll('\\', '/')
  if (isAbsolute(portable) || /^[A-Za-z]:\//.test(portable) || portable.split('/').some((part) => !part || part === '..')) {
    throw new Error(label + ' must stay inside the repository.')
  }
  return posix.normalize(portable.replace(/^\.\//, ''))
}

function exactKeys(value, expected, label) {
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(label + ' contains unknown key ' + key + '.')
}

export function parseEvaluationCorpus(text, source = '<inline>') {
  let parsed
  try { parsed = JSON.parse(text) } catch (error) { throw new Error(source + ': invalid JSON: ' + error.message) }
  object(parsed, source)
  exactKeys(parsed, new Set(['schemaVersion', 'id', 'description', 'repositories']), source)
  if (parsed.schemaVersion !== 1) throw new Error(source + ': schemaVersion must be 1.')
  const corpusId = identifier(parsed.id, source + '.id')
  if (typeof parsed.description !== 'string' || parsed.description.length < 20 || parsed.description.length > 2000) {
    throw new Error(source + '.description must contain 20-2000 characters.')
  }
  if (!Array.isArray(parsed.repositories) || parsed.repositories.length < 1 || parsed.repositories.length > 16) {
    throw new Error(source + '.repositories must contain 1-16 repositories.')
  }
  const repositoryIds = new Set(), taskIds = new Set()
  const repositories = parsed.repositories.map((repository, repositoryIndex) => {
    const label = source + '.repositories[' + repositoryIndex + ']'
    object(repository, label)
    exactKeys(repository, new Set(['id', 'language', 'url', 'license', 'tasks']), label)
    const id = identifier(repository.id, label + '.id')
    if (repositoryIds.has(id)) throw new Error(source + ': duplicate repository id ' + id + '.')
    repositoryIds.add(id)
    if (!LANGUAGES.has(repository.language)) throw new Error(label + '.language is unsupported.')
    let url
    try { url = new URL(repository.url) } catch { throw new Error(label + '.url is invalid.') }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.endsWith('.git')) {
      throw new Error(label + '.url must be an HTTPS github.com Git URL.')
    }
    if (typeof repository.license !== 'string' || !/^[A-Za-z0-9-.+]{2,64}$/.test(repository.license)) {
      throw new Error(label + '.license must be a bounded SPDX-style identifier.')
    }
    if (!Array.isArray(repository.tasks) || repository.tasks.length < 1 || repository.tasks.length > 64) {
      throw new Error(label + '.tasks must contain 1-64 tasks.')
    }
    const tasks = repository.tasks.map((task, taskIndex) => {
      const taskLabel = label + '.tasks[' + taskIndex + ']'
      object(task, taskLabel)
      exactKeys(task, new Set(['id', 'requirement', 'baseSha', 'targetSha', 'goldPaths']), taskLabel)
      const taskId = identifier(task.id, taskLabel + '.id')
      if (taskIds.has(taskId)) throw new Error(source + ': duplicate task id ' + taskId + '.')
      taskIds.add(taskId)
      if (typeof task.requirement !== 'string' || task.requirement.length < 20 || task.requirement.length > 4000) {
        throw new Error(taskLabel + '.requirement must contain 20-4000 characters.')
      }
      if (!SHA.test(task.baseSha) || !SHA.test(task.targetSha) || task.baseSha === task.targetSha) {
        throw new Error(taskLabel + ' must contain distinct full Git SHAs.')
      }
      if (!Array.isArray(task.goldPaths) || task.goldPaths.length < 1 || task.goldPaths.length > 256) {
        throw new Error(taskLabel + '.goldPaths must contain 1-256 paths.')
      }
      const goldPaths = [...new Set(task.goldPaths.map((path, pathIndex) => safePath(path, taskLabel + '.goldPaths[' + pathIndex + ']')))].sort()
      if (goldPaths.length !== task.goldPaths.length) throw new Error(taskLabel + '.goldPaths contains duplicates.')
      return { id: taskId, requirement: task.requirement.trim(), baseSha: task.baseSha, targetSha: task.targetSha, goldPaths }
    })
    return { id, language: repository.language, url: url.toString(), license: repository.license, tasks }
  })
  return {
    schemaVersion: 1,
    id: corpusId,
    description: parsed.description.trim(),
    repositoryCount: repositories.length,
    taskCount: repositories.reduce((sum, repository) => sum + repository.tasks.length, 0),
    repositories
  }
}

export async function loadEvaluationCorpus(path) {
  return parseEvaluationCorpus(await readFile(path, 'utf8'), path)
}
