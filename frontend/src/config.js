// Central configuration - change VITE_BASE_PATH in .env to update entire app
// Only ONE value to change when deploying to a different path

import { normalizeBasePath, resolveApiUrl } from './services/deploymentConfig.js'

const BASE_PATH = normalizeBasePath(import.meta.env.VITE_BASE_PATH || '')

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL, BASE_PATH)
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin
export const APP_BASE_PATH = BASE_PATH
