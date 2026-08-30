const CLUSTERS = [
  ['checkout', 'Checkout', 'PaymentGateway'],
  ['inventory', 'InventoryReservation', 'StockClient'],
  ['customer', 'CustomerProfile', 'IdentityClient'],
  ['billing', 'InvoiceBilling', 'TaxClient'],
  ['shipment', 'ShipmentTracking', 'CarrierClient'],
  ['notification', 'NotificationDelivery', 'MailClient']
]

function clusterNodes([prefix, domain, collaborator]) {
  return [
    ['controller', domain + 'Controller'],
    ['service', domain + 'Service'],
    ['repository', domain + 'Repository'],
    ['collaborator', collaborator],
    ['test', domain + 'ServiceTest']
  ].map(([kind, type]) => ({
    id: prefix + '-' + kind,
    path: (kind === 'test' ? 'src/test/java/' : 'src/main/java/') + prefix + '/' + type + '.java',
    language: 'java',
    qualifiedName: prefix + '.' + type
  }))
}

function clusterEdges([prefix]) {
  return [
    { from: prefix + '-controller', to: prefix + '-service', kind: 'injects', provenance: 'source-pattern-resolved' },
    { from: prefix + '-service', to: prefix + '-repository', kind: 'imports', provenance: 'static-import-resolved' },
    { from: prefix + '-service', to: prefix + '-collaborator', kind: 'injects', provenance: 'source-pattern-resolved' },
    { from: prefix + '-test', to: prefix + '-service', kind: 'tests', provenance: 'convention-test-name-resolved' }
  ]
}

const DISTRACTORS = Array.from({ length: 20 }, (_, index) => ({
  id: 'utility-' + index,
  path: 'src/main/java/platform/Utility' + index + '.java',
  language: 'java',
  qualifiedName: 'platform.Utility' + index
}))

function expected(prefix) {
  return ['controller', 'service', 'repository', 'collaborator', 'test'].map((kind) => {
    return [...CLUSTERS.flatMap(clusterNodes), ...DISTRACTORS].find((node) => node.id === prefix + '-' + kind).path
  })
}

export const IMPACT_GOLD_V1 = Object.freeze({
  schemaVersion: 1,
  fixtureKind: 'synthetic-gold',
  description: 'Synthetic Java backend clusters with human-declared file-level impact labels. This is regression evidence, not production accuracy evidence.',
  graphDocument: {
    schemaVersion: 1,
    tool: { id: 'bth-synthetic-impact-gold', version: '1.0.0' },
    findings: [],
    metrics: { nodes: CLUSTERS.length * 5 + DISTRACTORS.length, edges: CLUSTERS.length * 4 },
    graph: {
      schemaVersion: 1,
      generatedAt: '2026-08-30T00:00:00.000Z',
      generation: 'b'.repeat(64),
      advisory: true,
      permittedUses: ['navigation', 'review-questions', 'impact-localization'],
      forbiddenUses: ['pass-verdict', 'test-skipping'],
      nodes: [...CLUSTERS.flatMap(clusterNodes), ...DISTRACTORS],
      edges: CLUSTERS.flatMap(clusterEdges)
    }
  },
  cases: [
    {
      id: 'checkout-payment-change',
      query: 'Change Checkout payment behavior in CheckoutController and CheckoutService',
      expectedPaths: expected('checkout')
    },
    {
      id: 'inventory-reservation-change',
      query: 'Change InventoryReservation stock behavior and InventoryReservationService',
      expectedPaths: expected('inventory')
    },
    {
      id: 'customer-profile-change',
      query: 'Change CustomerProfile API behavior in CustomerProfileController',
      expectedPaths: expected('customer')
    },
    {
      id: 'shipment-tracking-change',
      query: 'Change ShipmentTracking carrier lookup in ShipmentTrackingService',
      expectedPaths: expected('shipment')
    }
  ]
})
