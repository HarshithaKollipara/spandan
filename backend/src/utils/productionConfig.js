const INSECURE_JWT_SECRETS = new Set([
  'your-secret-key-change-in-production',
  'your-super-secret-jwt-key-change-this-in-production',
  'replace-with-at-least-32-random-characters'
])

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return

  const missing = []
  if (!env.MONGODB_URI?.trim()) missing.push('MONGODB_URI')
  if (!env.JWT_SECRET?.trim()) missing.push('JWT_SECRET')

  if (missing.length) {
    throw new Error(`Missing required production environment variable(s): ${missing.join(', ')}`)
  }

  if (env.JWT_SECRET.trim().length < 32 || INSECURE_JWT_SECRETS.has(env.JWT_SECRET.trim())) {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters in production')
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(env.MONGODB_URI.trim())) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv:// in production')
  }
}

export function getHealthStatus(readyState) {
  const connected = readyState === 1
  return {
    status: connected ? 'ok' : 'unavailable',
    httpStatus: connected ? 200 : 503,
    mongodb: connected ? 'connected' : 'disconnected'
  }
}

export function getJwtSecret(env = process.env) {
  if (env.JWT_SECRET?.trim()) return env.JWT_SECRET.trim()
  if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production')
  return 'your-secret-key-change-in-production'
}
