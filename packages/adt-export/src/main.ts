#!/usr/bin/env bun
import { cmdExport } from './cli.js'

cmdExport(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error('[openadt-export] ' + String(error))
    process.exitCode = 1
  })
