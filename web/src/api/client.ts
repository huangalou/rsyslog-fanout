export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const env = (await res.json()) as { success: boolean; data: T; error: string | null }
  if (res.status === 401) onUnauthorized()
  if (!env.success) throw new ApiError(env.error ?? '未知錯誤', res.status)
  return env.data
}

export const api = {
  get: <T>(u: string) => request<T>('GET', u),
  post: <T>(u: string, b?: unknown) => request<T>('POST', u, b),
  put: <T>(u: string, b?: unknown) => request<T>('PUT', u, b),
  del: <T>(u: string) => request<T>('DELETE', u),
}
