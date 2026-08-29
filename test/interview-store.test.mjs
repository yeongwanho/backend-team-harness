import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { createInterview, loadInterview, recordInterviewAnswer } from '../src/core/interview-store.mjs'
import { createTask } from '../src/core/task-store.mjs'

async function project(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await initProject(root)
  await createTask(root, { id: 'STORE-1', context: 'Requirement' })
  return root
}

function input() {
  return {
    taskId: 'STORE-1',
    requirement: 'Add an endpoint.',
    actor: 'developer',
    sourceBinding: { fingerprint: 'a'.repeat(64) },
    contextSnapshot: { schemaVersion: 1, fact: 'deterministic' }
  }
}

test('interview store replays its hash-chained event log', async () => {
  const root = await project('bth-interview-store-')
  await createInterview(root, input())
  await recordInterviewAnswer(root, 'STORE-1', {
    questionId: 'acceptance',
    text: '200 and 404 are covered.',
    actor: 'developer'
  })

  const loaded = await loadInterview(root, 'STORE-1')
  assert.equal(loaded.events.length, 2)
  assert.equal(loaded.record.revision, 1)
  assert.equal(loaded.progress.currentQuestion.id, 'scope')
})

test('interview event and context tampering is detected', async () => {
  const root = await project('bth-interview-tamper-')
  await createInterview(root, input())
  const interviewDir = join(root, '.backend-harness/tasks/STORE-1/interview')
  const eventPath = join(interviewDir, 'events.jsonl')
  const events = await readFile(eventPath, 'utf8')
  await writeFile(eventPath, events.replace('COLLECTING', 'FINALIZED'), 'utf8')
  await assert.rejects(loadInterview(root, 'STORE-1'), /hash chain is inconsistent/)

  const root2 = await project('bth-interview-context-tamper-')
  await createInterview(root2, input())
  await writeFile(
    join(root2, '.backend-harness/tasks/STORE-1/interview/context-snapshot.json'),
    '{"schemaVersion":1,"fact":"changed"}\n',
    'utf8'
  )
  await assert.rejects(loadInterview(root2, 'STORE-1'), /snapshot has been altered/)
})

test('interview storage rejects a symlinked interview directory', async () => {
  const root = await project('bth-interview-symlink-')
  const outside = await mkdtemp(join(tmpdir(), 'bth-interview-outside-'))
  const taskDir = join(root, '.backend-harness/tasks/STORE-1')
  await mkdir(outside, { recursive: true })
  await symlink(outside, join(taskDir, 'interview'))

  await assert.rejects(createInterview(root, input()), /symbolic link/)
})
