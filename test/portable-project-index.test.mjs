import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileProjectConventions } from '../src/core/convention-compiler.mjs'
import { scanProjectManifest } from '../src/core/project-manifest.mjs'
import { inspectPortableProject } from '../src/core/portable-project-index.mjs'

test('portable source conventions cite repeated TypeScript layers and adjacent tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-portable-conventions-'))
  await mkdir(join(root, 'src/orders'), { recursive: true })
  await writeFile(join(root, 'src/orders/orders.service.ts'), 'export class OrdersService {}\n')
  await writeFile(join(root, 'src/orders/orders.service.spec.ts'), "describe('OrdersService', () => {})\n")
  await writeFile(join(root, 'src/orders/payments.service.ts'), 'export class PaymentsService {}\n')
  await writeFile(join(root, 'src/orders/orders.controller.ts'), "export class OrdersController { @Get('/orders') list() {} }\n")

  const manifest = await scanProjectManifest(root)
  const indexed = await inspectPortableProject(root, manifest)
  const conventions = compileProjectConventions(indexed)

  assert.equal(conventions.status, 'observed')
  assert.equal(conventions.layers.find((layer) => layer.role === 'service').naming[0].status, 'repeated')
  assert.equal(conventions.layers.find((layer) => layer.role === 'service').naming[0].suffix, 'Service')
  assert.ok(conventions.tests.pairs.some((pair) => pair.production.endsWith('orders.service.ts') && pair.test.endsWith('orders.service.spec.ts')))
  assert.equal(conventions.contracts.routes.methods.includes('GET'), true)
  assert.ok(conventions.layers.flatMap((layer) => layer.examples).every((example) => /^[a-f0-9]{64}$/.test(example.contentSha256)))
})

test('portable source conventions observe Python API and table declarations without runtime claims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-portable-python-'))
  await mkdir(join(root, 'backend/app/api/routes'), { recursive: true })
  await mkdir(join(root, 'backend/app/models'), { recursive: true })
  await writeFile(join(root, 'backend/app/api/routes/users.py'), "@router.get('/users')\ndef users():\n    return []\n")
  await writeFile(join(root, 'backend/app/models/user.py'), "class User:\n    __tablename__ = 'users'\n")

  const indexed = await inspectPortableProject(root, await scanProjectManifest(root))
  const conventions = compileProjectConventions(indexed)

  assert.equal(conventions.modules.includes('backend'), true)
  assert.deepEqual(conventions.contracts.tables.names, ['users'])
  assert.equal(conventions.contracts.routes.count, 1)
  assert.equal(conventions.authority.verdictAuthority, false)
})

test('portable source conventions observe TypeORM object-form tables and unpaired e2e tests truthfully', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-portable-typeorm-'))
  await mkdir(join(root, 'src/users/entities'), { recursive: true })
  await mkdir(join(root, 'test/admin'), { recursive: true })
  await writeFile(
    join(root, 'src/users/entities/user.entity.ts'),
    "@Entity({\n  name: 'user',\n})\nexport class UserEntity {}\n"
  )
  await writeFile(join(root, 'test/admin/users.e2e-spec.ts'), "describe('users', () => {})\n")

  const indexed = await inspectPortableProject(root, await scanProjectManifest(root))
  const conventions = compileProjectConventions(indexed)

  assert.deepEqual(conventions.contracts.tables.names, ['user'])
  assert.equal(conventions.tests.status, 'observed')
  assert.equal(conventions.tests.count, 1)
  assert.deepEqual(conventions.tests.pairs, [])
})

test('portable project index can stay inside a detected nested backend instead of learning frontend rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-portable-scope-'))
  await mkdir(join(root, 'backend/app/api'), { recursive: true })
  await mkdir(join(root, 'frontend/src'), { recursive: true })
  await writeFile(join(root, 'backend/app/api/users.py'), "@router.get('/users')\ndef users(): return []\n")
  await writeFile(join(root, 'frontend/src/users.service.ts'), 'export class UsersService {}\n')

  const indexed = await inspectPortableProject(root, await scanProjectManifest(root), { projectPath: 'backend' })
  const conventions = compileProjectConventions(indexed)

  assert.deepEqual(conventions.modules, ['backend'])
  assert.equal(conventions.layers.some((layer) => layer.role === 'service'), false)
  assert.equal(indexed.authority.projectPath, 'backend')
})
