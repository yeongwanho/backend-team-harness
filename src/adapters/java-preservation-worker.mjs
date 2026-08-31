import { parentPort, workerData } from 'node:worker_threads'
import { compareJavaPreservation } from './java-preservation.mjs'

// One request-owned worker; this code reads no repository/credentials and retains
// no source cache. Resource limits are NOT an OS permission or egress sandbox.
if (parentPort) parentPort.postMessage(workerData.map(pair => compareJavaPreservation(pair.before, pair.after)))
