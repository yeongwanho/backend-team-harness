// Test-fixture cleanup only. Never infer ownership from image or creation time.
const OWNER = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const ID = /^[a-f0-9]{64}$/
const IMAGE = /^sha256:[a-f0-9]{64}$/
export const MYSQL_OWNER_LABEL = 'bth.mysql.fixture'

function validOwner(owner) {
  if (typeof owner !== 'string' || !OWNER.test(owner)) throw new Error('A unique fixture owner UUID is required.')
}

function checked(runDocker, args, operation) {
  const result = runDocker(args)
  if (result.status !== 0 || result.signal || result.error) throw new Error('Docker ' + operation + ' failed.')
  return result.stdout
}

export function ownedMysqlContainers(owner, runDocker) {
  validOwner(owner)
  const output = checked(runDocker, ['ps', '-aq', '--no-trunc', '--filter', 'label=' + MYSQL_OWNER_LABEL + '=' + owner], 'owned-container listing')
  const ids = [...new Set(output.trim().split('\n').filter(Boolean))]
  if (ids.some(id => !ID.test(id))) throw new Error('Invalid full container ID returned by Docker.')
  return ids
}

export function removeOwnedMysqlContainer(id, owner, image, runDocker) {
  validOwner(owner)
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('A full container ID is required.')
  if (typeof image !== 'string' || !IMAGE.test(image)) throw new Error('An exact expected image ID is required.')
  let inspected
  try { inspected = JSON.parse(checked(runDocker, ['inspect', id], 'inspect')) }
  catch { throw new Error('Docker inspect did not provide verifiable ownership.') }
  if (!Array.isArray(inspected) || inspected.length !== 1 || inspected[0].Id !== id ||
      inspected[0].Image !== image || inspected[0].Config?.Labels?.[MYSQL_OWNER_LABEL] !== owner) {
    throw new Error('Container ownership or image mismatch; refusing removal.')
  }
  checked(runDocker, ['rm', '--force', '--volumes', id], 'owned-container removal')
}
