import test from 'node:test'
import assert from 'node:assert/strict'
import { compareJavaPreservation } from '../src/adapters/java-preservation.mjs'

const base = `class Customer {
  @jakarta.persistence.OneToMany private List<Order> orders;
  List<Order> getOrders() { return this.orders; }
  void addOrder(Order order) { if (order.isNew()) getOrders().add(order); }
}`
const compare = after => compareJavaPreservation(base, after)

test('a new direct relationship write bypassing a baseline guard is review-required', () => {
  const value = compare(base.replace(/\n}$/, '\nvoid update(Order item) { getOrders().add(item); }\n}'))
  assert.equal(value.status, 'review-required')
  assert.equal(value.findings[0].code, 'relationship_guard_drift')
  assert.equal(value.findings[0].baselineLine, 4)
  assert.equal(value.findings[0].line, 5)
  assert.doesNotMatch(JSON.stringify(value), /Customer|Order|orders|isNew/)
})

test('field access and renamed argument preserve the same structural condition', () => {
  assert.equal(compare(base.replace(/\n}$/, '\nvoid update(Order item) { if(item.isNew()) this.orders.add(item); }\n}')).status, 'clear')
  assert.equal(compare(base).status, 'clear')
})

test('else, inverted and broadened conditions are not treated as the original positive guard', () => {
  for (const branch of ['if(item.isNew()) {} else', 'if(!item.isNew())', 'if(item.isNew() || allowed)']) {
    assert.equal(compare(base.replace(/\n}$/, '\nvoid update(Order item) { ' + branch + ' getOrders().add(item); }\n}')).status, 'review-required')
  }
})

test('comments and strings cannot manufacture writes or guards', () => {
  assert.equal(compare(base.replace(/\n}$/, '\n// getOrders().add(item);\nString example = "getOrders().add(item);";\n}')).status, 'clear')
  assert.equal(compare(base.replace('if (order.isNew())', '/* if (order.isNew()) */')).status, 'review-required')
})

test('baseline unguarded writes are not invented into a policy', () => {
  const unguarded = base.replace('if (order.isNew())', '')
  assert.equal(compareJavaPreservation(unguarded, unguarded).status, 'not-applicable')
})

test('removed relationship annotations do not hide writes against baseline fields', () => {
  assert.equal(compare(base.replace('@jakarta.persistence.OneToMany', '').replace('if (order.isNew())', '')).status, 'review-required')
})

test('parse errors return only an incomplete code, never source-bearing parser messages', () => {
  const value = compareJavaPreservation(base, 'class Secret { private token=DO_NOT_FORWARD')
  assert.equal(value.status, 'incomplete')
  assert.doesNotMatch(JSON.stringify(value), /Secret|token|DO_NOT_FORWARD/)
})

test('recognized field annotations, qualified getters and nested conditions preserve or expose drift', () => {
  for (const annotation of ['@ManyToMany', '@ElementCollection', '@OneToMany(mappedBy="customer")']) {
    const source = base.replace('@jakarta.persistence.OneToMany', annotation)
    const changed = source.replace('if (order.isNew())', 'if (order.isNew()) if(allowed)')
    assert.equal(compareJavaPreservation(source, changed).status, 'clear')
    assert.equal(compareJavaPreservation(source, source.replace('getOrders().add(order)', 'this.getOrders().add(order)').replace('if (order.isNew())', '')).status, 'review-required')
  }
})

test('a same-named method on another receiver is not guessed to be this entity getter', () => {
  assert.equal(compare(base.replace(/\n}$/, '\nvoid update(Order item) { other.getOrders().add(item); }\n}')).status, 'clear')
})

test('early-return and alias rewrites illustrate the explicitly unsupported scope, not a safety proof', () => {
  const alias = base.replace('if (order.isNew()) getOrders().add(order);', 'List<Order> list = getOrders(); list.add(order);')
  assert.equal(compare(alias).status, 'clear', 'No recognized direct write remains; this narrow check must not be reported as semantic safety')
  const early = base.replace('if (order.isNew()) getOrders().add(order);', 'if (!order.isNew()) return; getOrders().add(order);')
  assert.equal(compare(early).status, 'review-required', 'Equivalent early-return guard requires review because control-flow proof is out of scope')
})

test('ambiguous same-named nested classes return incomplete rather than guessing type ownership', () => {
  const source = base + '\nclass Outer { class Customer {} }'
  assert.equal(compareJavaPreservation(source, source).status, 'incomplete')
})
