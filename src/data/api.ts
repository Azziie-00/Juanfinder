const apiOrigin = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '')

export const API_BASE_URL = `${apiOrigin.replace(/\/$/, '')}/api`