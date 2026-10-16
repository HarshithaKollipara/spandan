import { validateProductionConfig, getHealthStatus, getJwtSecret } from '../utils/productionConfig.js'

describe('production deployment safeguards', () => {
  test('requires MongoDB and a strong JWT secret in production', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'production' })).toThrow(/MONGODB_URI, JWT_SECRET/)
    expect(() => validateProductionConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://cluster/db', JWT_SECRET: 'short' })).toThrow(/32 characters/)
    expect(() => validateProductionConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://cluster/db', JWT_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow(/32 characters/)
    expect(() => validateProductionConfig({ NODE_ENV: 'production', MONGODB_URI: 'https://db.example', JWT_SECRET: 'a'.repeat(40) })).toThrow(/MONGODB_URI/)
  })

  test('allows local configuration without production-only variables', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'development' })).not.toThrow()
    expect(getJwtSecret({ NODE_ENV: 'development' })).toBe('your-secret-key-change-in-production')
    expect(() => getJwtSecret({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/)
    expect(getJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 's'.repeat(40) })).toBe('s'.repeat(40))
  })

  test('reports MongoDB readiness accurately', () => {
    expect(getHealthStatus(1)).toEqual({ status: 'ok', httpStatus: 200, mongodb: 'connected' })
    expect(getHealthStatus(0)).toEqual({ status: 'unavailable', httpStatus: 503, mongodb: 'disconnected' })
  })
})
