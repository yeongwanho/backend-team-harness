import test from 'node:test'
import assert from 'node:assert/strict'
import { personalizeCodeNodes, tokenizeRetrievalText } from '../src/core/lexical-retrieval.mjs'

const node = (path, qualifiedName, searchTerms = []) => ({ path, qualifiedName, searchTerms })

test('identifier tokenizer splits acronyms and snake_case while retaining exact names', () => {
  const terms = tokenizeRetrievalText('HTTPServer read_account_by_id refundPolicy policies configuration documentation')
  for (const term of ['http', 'server', 'httpserver', 'read', 'account', 'by', 'id', 'read_account_by_id', 'refund', 'policy', 'refundpolicy', 'policies', 'config', 'document']) {
    assert.ok(terms.includes(term), term)
  }
  assert.equal(new Set(terms).size, terms.length)
  assert.deepEqual(tokenizeRetrievalText(null), [])
  assert.ok(tokenizeRetrievalText('고객 주문 조회').includes('고객'))
})

test('tokenizer bounds input and terms, deduplicates repetitions, and removes existing stop words', () => {
  assert.deepEqual(tokenizeRetrievalText('and the for with only'), [])
  assert.deepEqual(tokenizeRetrievalText('invoice '.repeat(8000)), ['invoice'])
  assert.equal(tokenizeRetrievalText(Array.from({ length: 1000 }, (_, index) => 'term' + index).join(' ')).length, 64)
  assert.deepEqual(tokenizeRetrievalText(' '.repeat(64 * 1024) + 'hiddenSuffix'), [])
})

test('ordinary terms retain binary IDF scoring, including qualified namespace metadata', () => {
  const nodes = [
    node('src/one.java', 'billing.account', ['invoice']),
    node('src/two.java', 'billing.payment', ['account']),
    node('src/three.java', 'billing.invoice')
  ]
  const result = personalizeCodeNodes(nodes, 'account invoice')
  assert.deepEqual(result.weights, [0.5, 0.25, 0.25])
  assert.equal(result.mode, 'query-personalized')
  assert.deepEqual(result.matchedTokens, ['account', 'invoice'])
  assert.deepEqual(result.seededIndexes, [0, 1, 2])
  assert.equal(result.seededNodeCount, 3)
  assert.equal(result.lexical.id, 'bounded-binary-idf-identifier-prior')
  assert.equal(personalizeCodeNodes(nodes, 'billing').seededNodeCount, 3)
})

test('only explicitly written code identifiers receive ownership weight', () => {
  const nodes = [
    node('src/alpha/AllPolicies.java', 'alpha.AllPolicies', ['RefundPolicy']),
    node('src/payments/RefundPolicy.java', 'payments.RefundPolicy', ['RefundPolicy'])
  ]
  for (const query of ['refund policy', 'refundpolicy']) {
    assert.deepEqual(personalizeCodeNodes(nodes, query).weights, [0.5, 0.5], query)
  }
  const explicit = personalizeCodeNodes(nodes, 'RefundPolicy')
  assert.ok(explicit.weights[1] > explicit.weights[0])
  assert.equal(explicit.weights.reduce((sum, value) => sum + value, 0), 1)
  assert.deepEqual(explicit, personalizeCodeNodes(nodes, 'RefundPolicy'))
  const snake = personalizeCodeNodes([
    node('src/first.py', 'module.first', ['read_account']),
    node('src/second.py', 'module.second#read_account')
  ], 'read_account')
  assert.ok(snake.weights[1] > snake.weights[0])
})

test('repeated query/import terms do not amplify scores and absent searchTerms remain compatible', () => {
  const nodes = [node('src/account.java', 'account', ['invoice']), node('src/invoice.java', 'invoice')]
  const once = personalizeCodeNodes(nodes, 'account invoice')
  assert.deepEqual(once, personalizeCodeNodes(nodes, 'account invoice account invoice'))
  nodes[0].searchTerms = Array(128).fill('invoice')
  delete nodes[1].searchTerms
  assert.deepEqual(personalizeCodeNodes(nodes, 'account invoice'), once)
})

test('empty/no-match graphs return finite uniform fallback without inspecting nodes for empty queries', () => {
  assert.deepEqual(personalizeCodeNodes([], 'account').weights, [])
  const nodes = [node('one.java', 'one'), node('two.java', 'two')]
  for (const query of ['', undefined, 'nonexistent']) {
    const result = personalizeCodeNodes(nodes, query)
    assert.deepEqual(result.weights, [0.5, 0.5])
    assert.equal(result.mode, 'global-fallback')
    assert.deepEqual(result.matchedTokens, [])
    assert.deepEqual(result.seededIndexes, [])
    assert.equal(result.seededNodeCount, 0)
  }
  const poison = { get path() { throw new Error('empty query must not parse metadata') } }
  assert.deepEqual(personalizeCodeNodes([poison], 'and the').weights, [1])
})

test('short matching terms seed strongest matches when there are no compact exact query terms', () => {
  const result = personalizeCodeNodes([node('src/id.py', 'id'), node('src/unrelated.py', 'unrelated')], 'id')
  assert.deepEqual(result.weights, [1, 0])
  assert.deepEqual(result.seededIndexes, [0])
})

test('maximum graph size avoids variadic maximum and keeps finite normalized weights', () => {
  const nodes = Array.from({ length: 100_000 }, (_, index) => node('src/module' + index + '/account.ts', 'account'))
  const result = personalizeCodeNodes(nodes, 'account')
  assert.equal(result.weights.length, nodes.length)
  assert.equal(result.seededNodeCount, nodes.length)
  assert.equal(result.seededIndexes.length, nodes.length)
  assert.ok(result.weights.every(weight => weight === 1 / nodes.length))
  assert.ok(Math.abs(result.weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-10)
})
