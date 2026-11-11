import { describe, expect, test } from 'bun:test'
import { buildDestinationAllowlist } from './control'

describe('SAP MCP destination allowlist', () => {
  test('limits destinations to the imported IDs and rejects patterns', () => {
    expect(buildDestinationAllowlist(['DEV_100_USER_EN'])).toEqual({
      destinations: 'DEV_100_USER_EN',
      packages: '',
      namespaces: '*',
    })
    expect(() => buildDestinationAllowlist(['DEV*'])).toThrow()
    expect(() => buildDestinationAllowlist(['DEV,OTHER'])).toThrow()
  })
})
