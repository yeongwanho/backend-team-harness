import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export function projectExecutableForPlatform(command, platform = process.platform) {
  if (platform !== 'win32' || typeof command !== 'string') return command
  const normalized = command.replaceAll('\\', '/')
  if (/(^|\/)gradlew$/i.test(normalized)) return command + '.bat'
  if (/(^|\/)mvnw$/i.test(normalized)) return command + '.cmd'
  return command
}

export function implementationStateDirectory(options = {}) {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const home = options.home ?? homedir()
  const path = platform === 'win32' ? win32 : posix
  const configured = platform === 'win32' ? environment.LOCALAPPDATA : environment.XDG_STATE_HOME
  const fallback = platform === 'win32'
    ? path.join(home, 'AppData', 'Local')
    : path.join(home, '.local', 'state')
  const base = typeof configured === 'string' && configured.trim() && path.isAbsolute(configured)
    ? configured
    : fallback
  return path.resolve(base, 'backend-team-harness')
}
