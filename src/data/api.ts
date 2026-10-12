const configuredApiOrigin = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '')
const apiOrigin = configuredApiOrigin.replace(/\/+$/, '').replace(/\/api$/i, '')

export const API_BASE_URL = `${apiOrigin}/api`

export class ApiResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiResponseError'
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
    throw new ApiResponseError(fallbackMessage)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('API response contained malformed JSON.', { status: response.status, error })
    }
    throw new ApiResponseError(fallbackMessage)
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? payload.message
      : undefined
    throw new ApiResponseError(isUserFacingMessage(message) ? message : fallbackMessage)
  }
  return payload as T
}