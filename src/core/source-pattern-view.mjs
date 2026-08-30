// Bounded callers use this lexical view to ignore examples in strings/comments.
// This is deliberately not an AST or proof of runtime wiring. Dynamic template
// expressions and malformed/unterminated literals are not interpreted.
export function javascriptSourceView(text) {
  const literals = []
  const code = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (value, offset) => {
    if (/^["'`]/.test(value)) literals.push({ offset, end: offset + value.length, value: value.slice(1, -1) })
    return value.replace(/[^\r\n]/g, ' ')
  })
  return /["'`]/.test(code) ? { code: '', literals: [] } : { code, literals }
}

export function pythonCodeView(text) {
  const code = text.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|#[^\r\n]*/g,
    value => value.replace(/[^\r\n]/g, ' '))
  return /["']/.test(code) ? '' : code
}
