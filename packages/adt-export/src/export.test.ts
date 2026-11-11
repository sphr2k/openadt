import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LspTransport } from '@openadt/adt-lsp-client'
import {
  canonicalPackageName,
  matchesPackage,
  validateConfig,
  type ExportConfig,
} from './config.js'
import { discoverPackageRoots, safeSegment } from './repository.js'
import { runExport } from './runner.js'
import { safeOutput } from './writer.js'
import { parseExportArgs } from './cli.js'

const BASE = 'abap:/repotree-v1/DEV/(DEMO)APP_FS/'
const PKG_URI = BASE + '(demo)app_fs.devc.json'
const CLASS_DIR = BASE + 'Source%20Code%20Library/Classes/ZCL_TEST/'
const CLASS_SRC = CLASS_DIR + 'zcl_test.clas.abap'
const CLASS_JSON = CLASS_DIR + 'zcl_test.clas.json'
const META = '{"name":"/DEMO/APP_FS"}\n'
const CLASS = 'CLASS zcl_test DEFINITION PUBLIC.\nENDCLASS.\n'
const EXTRA = '{"name":"zcl_test"}\n'

function config(target: string, overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    system: 'DEV',
    target,
    packages: ['/DEMO/APP_FS'],
    exclude: [],
    jobs: 2,
    maxResults: 1000,
    ...overrides,
  }
}

function fakeLsp() {
  const calls: string[] = []
  const lsp: LspTransport = {
    async sendRequest(method, params) {
      const args = params as Record<string, unknown>
      calls.push(method + ':' + String(args.uri ?? args.pattern))
      if (method === 'adtLs/repository/quickSearch') {
        return {
          references: [
            { name: '/DEMO/APP_FS', uri: '/sap/bc/adt/packages/(demo)app_fs' },
            { name: '/DEMO/NOT_A_MATCH', uri: '/sap/bc/adt/packages/not_a_match' },
          ],
        }
      }
      if (method === 'adtLs/repository/getLsUri') return { uri: PKG_URI }
      if (method === 'adtLs/fileSystem/readDirectory') {
        const uri = String(args.uri)
        if (uri === BASE)
          return {
            children: [
              { name: '(demo)app_fs.devc.json', type: 1 },
              { name: 'Source Code Library', type: 2 },
              { name: '(DEMO)TEST', type: 2 },
            ],
          }
        if (uri === BASE + 'Source%20Code%20Library/')
          return { children: [{ name: 'Classes', type: 2 }] }
        if (uri === BASE + 'Source%20Code%20Library/Classes/')
          return { children: [{ name: 'ZCL_TEST', type: 2 }] }
        if (uri === CLASS_DIR)
          return {
            children: [
              { name: 'zcl_test.clas.abap', type: 1 },
              { name: 'zcl_test.clas.json', type: 1 },
            ],
          }
        if (uri === BASE + '(DEMO)TEST/') {
          return { children: [{ name: 'should_not_export.txt', type: 1 }] }
        }
        return { children: [] }
      }
      if (method === 'adtLs/fileSystem/readFile') {
        const uri = String(args.uri)
        if (uri === PKG_URI) return { content: META }
        if (uri === CLASS_SRC) return { content: CLASS }
        if (uri === CLASS_JSON) return { content: EXTRA }
        return { content: 'unexpected' }
      }
      throw new Error('Unexpected LSP method ' + method)
    },
  }
  return { lsp, calls }
}

async function scratch() {
  await mkdir(join(process.cwd(), 'tmp'), { recursive: true })
  return mkdtemp(join(process.cwd(), 'tmp', 'adt-export-test-'))
}

describe('YAML schema and package glob', () => {
  test('canonicalizes SAP namespace folders and matches full names', () => {
    expect(canonicalPackageName('(DEMO)APP_FS')).toBe('/DEMO/APP_FS')
    expect(matchesPackage('/DEMO/APP_FS', ['/DEMO/APP*'])).toBe(true)
    expect(matchesPackage('/DEMO/APP_FS', ['/DEMO/ZZ*'])).toBe(false)
    expect(matchesPackage('ZPKG_C', ['ZPKG_*'])).toBe(true)
    expect(matchesPackage('ZPKG_', ['ZPKG_*'])).toBe(true)
    expect(matchesPackage('ZPKG_C', ['ZPKG'])).toBe(false)
  })
  test('rejects invalid YAML config and unsafe filesystem names', () => {
    expect(() =>
      validateConfig(
        { system: 'DEV', target: 'out', packages: ['Z*'], jobs: 40 },
        '/workspace/config.yaml'
      )
    ).toThrow()
    expect(() =>
      validateConfig(
        { system: 'DEV', target: 'out', packages: ['Z*'], extra: 1 },
        '/workspace/config.yaml'
      )
    ).toThrow()
    expect(() =>
      validateConfig({ system: 'DEV', target: 'out', packages: ['Z[1]'] }, '/workspace/config.yaml')
    ).toThrow()
    expect(() => safeSegment('../escape')).toThrow()
    expect(() => safeSegment('..')).toThrow()
    expect(parseExportArgs(['--config', 'x.yaml', '--dry-run'])).toEqual({
      config: 'x.yaml',
      dryRun: true,
      refresh: false,
    })
  })
  test('fails when SAP search could be truncated', async () => {
    const { lsp } = fakeLsp()
    await expect(discoverPackageRoots(lsp, config('unused', { maxResults: 2 }))).rejects.toThrow(
      'truncated'
    )
  })
})

describe('mock ADT LS tree parity and resume', () => {
  test('sweeps before downloading, preserves AFF bytes, resumes, and refreshes', async () => {
    const dir = await scratch()
    try {
      const target = join(dir, 'export')
      const cfg = config(target, { exclude: ['/DEMO/TEST*'] })
      const { lsp, calls } = fakeLsp()
      const logs: string[] = []
      const opts = { progress: (message: string) => logs.push(message) }

      const planned = await runExport(lsp, cfg, { ...opts, dryRun: true })
      expect(planned.files).toBe(3)
      expect(planned.exported).toBe(0)
      expect(calls.some((call) => call.startsWith('adtLs/fileSystem/readFile'))).toBe(false)
      expect(logs.some((msg) => msg.includes('Plan: 3 files'))).toBe(true)

      const result = await runExport(lsp, cfg, opts)
      expect(result).toMatchObject({ files: 3, exported: 3, failed: 0, skipped: 0, directories: 4 })
      expect(await readFile(join(target, '(DEMO)APP_FS', '(demo)app_fs.devc.json'), 'utf8')).toBe(
        META
      )
      expect(
        await readFile(
          join(
            target,
            '(DEMO)APP_FS',
            'Source Code Library',
            'Classes',
            'ZCL_TEST',
            'zcl_test.clas.abap'
          ),
          'utf8'
        )
      ).toBe(CLASS)
      expect(
        await readFile(
          join(
            target,
            '(DEMO)APP_FS',
            'Source Code Library',
            'Classes',
            'ZCL_TEST',
            'zcl_test.clas.json'
          ),
          'utf8'
        )
      ).toBe(EXTRA)
      expect(logs.some((msg) => msg.includes('Export: 3/3 (100%)'))).toBe(true)
      const reads = calls.filter((call) => call.startsWith('adtLs/fileSystem/readFile')).length
      const resumed = await runExport(lsp, cfg, opts)
      expect(resumed).toMatchObject({ exported: 0, skipped: 3, failed: 0 })
      expect(calls.filter((call) => call.startsWith('adtLs/fileSystem/readFile')).length).toBe(
        reads
      )
      const refreshed = await runExport(lsp, cfg, { ...opts, refresh: true })
      expect(refreshed).toMatchObject({ exported: 3, skipped: 0, failed: 0 })
      expect(calls.filter((call) => call.startsWith('adtLs/fileSystem/readFile')).length).toBe(
        reads + 3
      )
      expect(calls.some((call) => call.includes('(DEMO)TEST/'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects output symlinks and cannot escape output root', async () => {
    const dir = await scratch()
    try {
      await mkdir(join(dir, 'output'), { recursive: true })
      await symlink(dir, join(dir, 'output', 'bad'))
      await expect(safeOutput(join(dir, 'output'), 'bad/evil.txt')).rejects.toThrow('Symlink')
      await expect(safeOutput(join(dir, 'output'), '../evil.txt')).rejects.toThrow('escapes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
