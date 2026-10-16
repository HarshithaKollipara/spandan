export function normalizeBasePath(basePath = '') {
  const trimmed = String(basePath).trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

export function resolveApiUrl(apiUrl, basePath = '') {
  const configuredUrl = String(apiUrl || '').trim().replace(/\/+$/, '')
  if (configuredUrl) return configuredUrl
  return `${normalizeBasePath(basePath)}/api`
}
