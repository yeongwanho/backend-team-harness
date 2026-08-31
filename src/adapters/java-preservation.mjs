import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Parser, Language } from 'web-tree-sitter'

const grammar = await readFile(new URL('../../vendor/tree-sitter-java/tree-sitter-java.wasm', import.meta.url))
if (createHash('sha256').update(grammar).digest('hex') !== '4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4') throw new Error('Java grammar integrity mismatch')
await Parser.init()
const language = await Language.load(grammar)
const operations = new Set(['add', 'addAll', 'remove', 'removeAll', 'retainAll', 'clear', 'set'])
const nestedScopes = new Set(['class_declaration', 'lambda_expression', 'object_creation_expression'])
const comments = new Set(['line_comment', 'block_comment'])
const field = (node, name) => node?.childForFieldName(name)
const contains = (outer, inner) => outer && outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
const result = (status, findings = [], guards = 0) => ({ status, findings, recognizedGuards: guards })

function descendants(node, type, skipScopes = false) {
  const found = [], pending = [node]
  while (pending.length) {
    const current = pending.pop()
    if (!current) continue
    if (skipScopes && current !== node && nestedScopes.has(current.type)) continue
    if (current.type === type) found.push(current)
    pending.push(...current.namedChildren)
  }
  return found.sort((a, b) => a.startIndex - b.startIndex)
}

function tokens(node) {
  if (!node || comments.has(node.type)) return []
  if (node.childCount === 0) return [node.text]
  return node.children.flatMap(tokens)
}

function inspect(source, inherited = new Map()) {
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  try {
    if (!tree || tree.rootNode.hasError) throw new Error('unsupported-java')
    const classes = new Map(), writes = []
    for (const declaration of descendants(tree.rootNode, 'class_declaration')) {
      const className = field(declaration, 'name').text
      if (classes.has(className)) throw new Error('ambiguous-class')
      const members = field(declaration, 'body').namedChildren
      const fields = new Set(inherited.get(className) ?? [])
      for (const member of members.filter(node => node.type === 'field_declaration')) {
        const annotations = [...descendants(member, 'marker_annotation'), ...descendants(member, 'annotation')]
        if (annotations.some(node => ['OneToMany', 'ManyToMany', 'ElementCollection'].includes(field(node, 'name')?.text.split('.').at(-1)))) {
          for (const variable of member.childrenForFieldName('declarator')) fields.add(field(variable, 'name').text)
        }
      }
      classes.set(className, fields)
      if (!fields.size) continue
      const methods = members.filter(node => node.type === 'method_declaration')
      const getters = new Map()
      for (const method of methods) {
        if (field(method, 'parameters')?.namedChildCount !== 0) continue
        const body = tokens(field(method, 'body'))
        for (const name of fields) {
          if ([['{', 'return', name, ';', '}'], ['{', 'return', 'this', '.', name, ';', '}']].some(value => JSON.stringify(value) === JSON.stringify(body))) getters.set(field(method, 'name').text, name)
        }
      }
      for (const method of methods) {
        for (const statement of descendants(field(method, 'body'), 'expression_statement', true)) {
          const call = statement.namedChildren.find(node => !comments.has(node.type))
          if (call?.type !== 'method_invocation' || !operations.has(field(call, 'name')?.text)) continue
          const object = field(call, 'object')
          let collection
          if (object?.type === 'identifier' && fields.has(object.text)) collection = object.text
          else if (object?.type === 'field_access' && field(object, 'object')?.type === 'this' && fields.has(field(object, 'field')?.text)) collection = field(object, 'field').text
          else if (object?.type === 'method_invocation' && (!field(object, 'object') || field(object, 'object').type === 'this') && field(object, 'arguments')?.namedChildCount === 0) collection = getters.get(field(object, 'name').text)
          if (!collection) continue
          const args = field(call, 'arguments').namedChildren.filter(node => !comments.has(node.type))
          const item = args.length === 1 && args[0].type === 'identifier' ? args[0].text : null
          const guards = []
          for (let ancestor = statement.parent; ancestor && ancestor.id !== method.id; ancestor = ancestor.parent) {
            if (ancestor.type !== 'if_statement') continue
            const branch = contains(field(ancestor, 'consequence'), statement) ? 'then' : contains(field(ancestor, 'alternative'), statement) ? 'else' : null
            if (branch) guards.push(JSON.stringify([branch, tokens(field(ancestor, 'condition')).map(token => item && token === item ? '$item' : token)]))
          }
          writes.push({ key: className + ':' + collection + ':' + field(call, 'name').text, guards, line: statement.startPosition.row + 1 })
        }
      }
    }
    return { classes, writes }
  } finally { tree?.delete(); parser.delete() }
}

// Structural review signal only: no semantic, authorization, caller ownership,
// cross-file alias or complete collection-write analysis is claimed.
export function compareJavaPreservation(before, after) {
  try {
    const baseline = inspect(before)
    const groups = new Map()
    for (const write of baseline.writes) {
      if (!groups.has(write.key)) groups.set(write.key, [])
      groups.get(write.key).push(write)
    }
    for (const [key, writes] of groups) if (writes.some(write => !write.guards.length)) groups.delete(key)
    if (!groups.size) return result('not-applicable')
    const candidate = inspect(after, baseline.classes)
    const findings = []
    for (const write of candidate.writes) {
      const originals = groups.get(write.key)
      if (!originals || originals.some(original => original.guards.every(guard => write.guards.includes(guard)))) continue
      findings.push({ code: 'relationship_guard_drift', line: write.line, baselineLine: originals[0].line })
    }
    return result(findings.length ? 'review-required' : 'clear', findings.slice(0, 16), groups.size)
  } catch {
    return result('incomplete', [{ code: 'java_structure_unavailable', line: null, baselineLine: null }])
  }
}
