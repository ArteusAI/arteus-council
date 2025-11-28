import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeBasePath = (value) => {
  if (!value || value === '/') {
    return '/'
  }

  let candidate = value
  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    const parsed = new URL(candidate)
    candidate = parsed.pathname || '/'
  }

  if (candidate === '/') {
    return '/'
  }

  if (!candidate.startsWith('/')) {
    candidate = `/${candidate}`
  }

  if (!candidate.endsWith('/')) {
    candidate = `${candidate}/`
  }

  return candidate
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  const rawBase = env.VITE_BASE_PATH || env.BASE_URL || '/'
  return {
    plugins: [react()],
    // Allow hosting under a subpath, e.g. https://arteus.us/council
    base: normalizeBasePath(rawBase),
  }
})
