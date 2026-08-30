import { resolve } from 'node:path'
import { writeGraphReport } from './graph-report.mjs'
import { indexProjectGraph } from './indexer.mjs'

const output = resolve('.backend-harness/generated/packs/codegraph-advisory/graph.json')
await writeGraphReport(output, await indexProjectGraph(process.cwd()))
