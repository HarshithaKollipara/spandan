import { normalizeBasePath, resolveApiUrl } from '../services/deploymentConfig.js'

describe('deployment URL configuration', () => {
  test('uses the explicit HTTPS API prefix when configured', () => {
    expect(resolveApiUrl('https://spandan-api.onrender.com/api/', '/spandan')).toBe('https://spandan-api.onrender.com/api')
  })

  test('keeps the same-origin API path for local development and subpath deployments', () => {
    expect(resolveApiUrl('', '')).toBe('/api')
    expect(resolveApiUrl('', '/spandan/')).toBe('/spandan/api')
  })

  test('normalizes the router base path', () => {
    expect(normalizeBasePath('/spandan/')).toBe('/spandan')
    expect(normalizeBasePath('')).toBe('')
  })
})
