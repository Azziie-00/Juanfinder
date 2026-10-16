const configuredApiOrigin = import.meta.env.VITE_API_URL || ''
const apiOrigin = configuredApiOrigin.replace(/\/+$/, '').replace(/\/api$/i, '')

export const API_BASE_URL = `${apiOrigin}/api`

export class ApiResponseError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = status
  }
}

function isUserFacingMessage(message: unknown): message is string {
  return typeof message === 'string'
    && message.trim().length > 0
    && message.length <= 300
    && !/[<>]/.test(message)
    && !/\b(stack trace|sqlstate|postgrest|supabase|exception|error:|migration|schema|database|server\/|api endpoint)\b/i.test(message)
}

export async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('json')) {
    if (import.meta.env.DEV) {
      console.error('API response was not JSON.', { status: response.status, contentType })
    }
    throw new ApiResponseError(fallbackMessage, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    if (import.meta.env.DEV) {
      console.error('API response contained malformed JSON.', { status: response.status })
    }
    throw new ApiResponseError(fallbackMessage, response.status)
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? payload.message
      : undefined
    throw new ApiResponseError(isUserFacingMessage(message) ? message : fallbackMessage, response.status)
  }
  return payload as T
}
