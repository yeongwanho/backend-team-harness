import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Deliberately not a general shell parser. Only literal argv and one familiar
// shell wrapper are understood; scripts, expansions and redirections are unknown.
function literalWords(source) {
  if (typeof source !== 'string' || source.length > 16384) return null
  const words = []
  let word = '', quote = null, active = false
  for (const char of source) {
    if (/[\n\r\\$`]/.test(char)) return null
    if (quote) {
      if (char === quote) quote = null
      else word += char
    } else if (char === "'" || char === '"') { quote = char; active = true }
    else if (/\s/.test(char)) {
      if (active) { words.push(word); word = ''; active = false }
    } else {
      if (/[;&|<>()#*?{}\[\]]/.test(char)) return null
      word += char; active = true
    }
  }
  if (quote) return null
  if (active) words.push(word)
  return words
}

function observedArgv(command) {
  let words = literalWords(command)
  if (!words) return null
  if (words.length === 3 && /^(?:(?:\/usr)?\/bin\/)?(?:sh|bash|zsh)$/.test(words[0]) && ['-c', '-lc'].includes(words[1])) words = literalWords(words[2])
  if (words?.[0] === 'exec') words = words.slice(1)
  return words
}

// Machine tool events are observations, not a shell sandbox or proof about
// every subcommand. Never infer completion from provider prose.
export function createValidationActivity(commands, cwd) {
  const entries = commands.map(command => {
    const [program, ...args] = command.split(' ')
    const programs = [...new Set([program, program.replace(/^\.\//, ''),
      ...(program.includes('/') ? [resolve(cwd, program).replaceAll('\\', '/')] : [])])]
    return { commandSha256: createHash('sha256').update(command).digest('hex'), started: 0, succeeded: 0, failed: 0,
      programs, args }
  })
  const pending = new Map(), seen = new Set()
  const matches = command => {
    const words = observedArgv(command)
    return words ? entries.filter(entry => entry.programs.includes(words[0]) &&
      words.length === entry.args.length + 1 && entry.args.every((arg, index) => arg === words[index + 1])) : []
  }
  function observe(id, phase, selected, success) {
    const key = typeof id === 'string' ? id + ':' + phase : null
    if (key && seen.has(key)) return
    if (key) { if (seen.size >= 4096) return; seen.add(key) }
    for (const entry of selected) {
      if (phase === 'start') entry.started++
      else if (success === true) entry.succeeded++
      else if (success === false) entry.failed++
    }
    if (typeof id === 'string') {
      if (phase === 'start' && pending.size < 2048) pending.set(id, selected)
      else if (phase === 'end') pending.delete(id)
    }
  }
  return {
    matches(command) { return matches(command).length > 0 },
    observe(document, provider) {
      if (provider === 'codex') {
        const item = document?.item
        if (item?.type !== 'command_execution') return
        const selected = typeof item.command === 'string' ? matches(item.command) : pending.get(item.id) ?? []
        if (document.type === 'item.started') observe(item.id, 'start', selected)
        else if (document.type === 'item.completed') observe(item.id, 'end', selected,
          Number.isInteger(item.exit_code) ? item.exit_code === 0 : null)
      } else if (Array.isArray(document?.message?.content)) {
        for (const block of document.message.content) {
          if (document.type === 'assistant' && block?.type === 'tool_use' && block.name === 'Bash') observe(block.id, 'start', matches(block.input?.command))
          else if (document.type === 'user' && block?.type === 'tool_result') {
            observe(block.tool_use_id, 'end', pending.get(block.tool_use_id) ?? [],
              block.is_error === false ? true : block.is_error === true ? false : null)
          }
        }
      }
    },
    snapshot() {
      return { schemaVersion: 1, authority: 'provider-tool-event-observation',
        complete: entries.length > 0 && entries.every(entry => entry.succeeded > 0),
        commands: entries.map(({ programs, args, ...entry }) => ({ ...entry })) }
    }
  }
}
