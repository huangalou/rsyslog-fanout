import { i18n } from '../i18n'

// server 的錯誤契約(見 server/src/lib/envelope.ts):
// error 帶穩定 code 供依語系翻譯,message 為英文 fallback,params 供插值。
interface ApiErrorPayload {
  code: string
  message: string
  params?: Record<string, string | number>
}

export class ApiError extends Error {
  status: number
  code: string | null
  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn
}

// 已知錯誤碼 → 當前語系譯文;未知碼或舊式字串 error → 原樣顯示(server 英文 fallback)。
function translateApiError(error: ApiErrorPayload | string | null): { message: string; code: string | null } {
  if (error === null) return { message: i18n.global.t('common.unknownError'), code: null }
  if (typeof error === 'string') return { message: error, code: null }
  const key = `errors.${error.code}`
  if (!i18n.global.te(key)) return { message: error.message, code: error.code }
  return { message: i18n.global.t(key, { ...error.params, message: error.message }), code: error.code }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) onUnauthorized()
  let env: { success: boolean; data: T; error: ApiErrorPayload | string | null }
  try {
    env = (await res.json()) as { success: boolean; data: T; error: ApiErrorPayload | string | null }
  } catch {
    throw new ApiError(res.statusText || `HTTP ${res.status}`, res.status)
  }
  if (!env.success) {
    const { message, code } = translateApiError(env.error)
    throw new ApiError(message, res.status, code)
  }
  return env.data
}

export const api = {
  get: <T>(u: string) => request<T>('GET', u),
  post: <T>(u: string, b?: unknown) => request<T>('POST', u, b),
  put: <T>(u: string, b?: unknown) => request<T>('PUT', u, b),
  del: <T>(u: string) => request<T>('DELETE', u),
}
