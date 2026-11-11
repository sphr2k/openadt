import { describe, expect, test } from 'bun:test'
import { redactSecrets, eclipseWorkspaceLogPath, isMcpDebugEnabled } from './log'

describe('redactSecrets', () => {
  test('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer abc123xyz'
    const output = redactSecrets(input)
    expect(output).toContain('Bearer [REDACTED]')
    expect(output).not.toContain('abc123xyz')
  })

  test('redacts token field in JSON', () => {
    const input = '{"token":"secret123"}'
    const output = redactSecrets(input)
    expect(output).toContain('"token":"[REDACTED]"')
    expect(output).not.toContain('secret123')
  })

  test('redacts password field in JSON', () => {
    const input = '{"password":"mypassword"}'
    const output = redactSecrets(input)
    expect(output).toContain('"password":"[REDACTED]"')
    expect(output).not.toContain('mypassword')
  })

  test('redacts clientSecret field in JSON', () => {
    const input = '{"clientSecret":"mysecret"}'
    const output = redactSecrets(input)
    expect(output).toContain('"clientSecret":"[REDACTED]"')
    expect(output).not.toContain('mysecret')
  })

  test('redacts SAP reentrance tickets in callback URLs', () => {
    const input = 'http://localhost:3011/adt/redirect?reentrance-ticket=one-time-ticket&state=ok'
    const output = redactSecrets(input)
    expect(output).toContain('reentrance-ticket=[REDACTED]')
    expect(output).not.toContain('one-time-ticket')
  })

  test('redacts multiple secrets in one text', () => {
    const input = 'Bearer abc {"password":"def","token":"ghi"}'
    const output = redactSecrets(input)
    expect(output).toContain('Bearer [REDACTED]')
    expect(output).toContain('"password":"[REDACTED]"')
    expect(output).toContain('"token":"[REDACTED]"')
  })

  test('leaves non-secret text unchanged', () => {
    const input = 'This is normal text without secrets'
    const output = redactSecrets(input)
    expect(output).toBe(input)
  })
})

describe('eclipseWorkspaceLogPath', () => {
  test('returns correct log path for workspace', () => {
    const workspace = '/path/to/workspace'
    const result = eclipseWorkspaceLogPath(workspace)
    expect(result).toBe('/path/to/workspace/.metadata/.log')
  })

  test('handles workspace with trailing slash', () => {
    const workspace = '/path/to/workspace/'
    const result = eclipseWorkspaceLogPath(workspace)
    expect(result).toBe('/path/to/workspace/.metadata/.log')
  })
})

describe('isMcpDebugEnabled', () => {
  test("returns true for '1'", () => {
    process.env.MCP_DEBUG = '1'
    expect(isMcpDebugEnabled()).toBe(true)
  })

  test("returns true for 'true'", () => {
    process.env.MCP_DEBUG = 'true'
    expect(isMcpDebugEnabled()).toBe(true)
  })

  test("returns true for 'yes'", () => {
    process.env.MCP_DEBUG = 'yes'
    expect(isMcpDebugEnabled()).toBe(true)
  })

  test("returns true for 'TRUE' (case insensitive)", () => {
    process.env.MCP_DEBUG = 'TRUE'
    expect(isMcpDebugEnabled()).toBe(true)
  })

  test("returns false for '0'", () => {
    process.env.MCP_DEBUG = '0'
    expect(isMcpDebugEnabled()).toBe(false)
  })

  test("returns false for 'false'", () => {
    process.env.MCP_DEBUG = 'false'
    expect(isMcpDebugEnabled()).toBe(false)
  })

  test('returns false when env var is not set', () => {
    delete process.env.MCP_DEBUG
    expect(isMcpDebugEnabled()).toBe(false)
  })

  test('returns false for empty string', () => {
    process.env.MCP_DEBUG = ''
    expect(isMcpDebugEnabled()).toBe(false)
  })

  test('trims whitespace', () => {
    process.env.MCP_DEBUG = ' true '
    expect(isMcpDebugEnabled()).toBe(true)
  })
})
