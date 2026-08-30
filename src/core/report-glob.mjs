function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

export function reportGlobRegex(pattern) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1
      if (pattern[index + 1] === '/') {
        index += 1
        expression += '(?:.*/)?'
      } else {
        expression += '.*'
      }
    } else if (char === '*') {
      expression += '[^/]*'
    } else if (char === '?') {
      expression += '[^/]'
    } else {
      expression += escapeRegex(char)
    }
  }
  return new RegExp(expression + '$')
}

export function reportGlobBase(pattern) {
  const segments = pattern.split('/')
  const fixed = []
  for (const segment of segments) {
    if (/[*?]/.test(segment)) {
      break
    }
    fixed.push(segment)
  }
  if (fixed.length === segments.length) {
    fixed.pop()
  }
  return fixed.join('/') || '.'
}

function nestedBase(left, right) {
  return left === right || left === '.' || right === '.' || left.startsWith(right + '/') || right.startsWith(left + '/')
}

export function reportPatternsMayOverlap(left, right) {
  if (left === right) {
    return true
  }
  const leftGlob = /[*?]/.test(left)
  const rightGlob = /[*?]/.test(right)
  if (!leftGlob && !rightGlob) {
    return false
  }
  if (leftGlob && !rightGlob) {
    return reportGlobRegex(left).test(right)
  }
  if (!leftGlob && rightGlob) {
    return reportGlobRegex(right).test(left)
  }
  return nestedBase(reportGlobBase(left), reportGlobBase(right))
}
