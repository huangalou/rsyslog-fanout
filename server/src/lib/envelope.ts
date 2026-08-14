// API 錯誤契約:error 帶穩定錯誤碼供 WebUI 依語系翻譯,
// message 為英文 fallback(給 curl / 程式化使用者),params 供前端插值。
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'VALIDATION'
  | 'PORT_OUT_OF_RANGE'
  | 'PORT_IN_USE'
  | 'NOT_FOUND'
  | 'INPUT_NOT_FOUND'
  | 'DESTINATION_NOT_FOUND'
  | 'PASSWORD_INCORRECT'
  | 'PASSWORD_LENGTH'
  | 'HOST_FORMAT'
  | 'SOURCE_FILTER_FORMAT'
  | 'APPLY_FAILED'
  | 'NAME_IN_USE'
  | 'ROUTE_EXISTS'
  | 'INTERNAL'

export type ErrorParams = Record<string, string | number>

export interface ApiError {
  code: ErrorCode
  message: string
  params?: ErrorParams
}

export interface Envelope<T> {
  success: boolean
  data: T | null
  error: ApiError | null
}

const MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Not logged in',
  VALIDATION: 'Invalid request',
  PORT_OUT_OF_RANGE: 'Port {port} is outside the allowed range ({range})',
  PORT_IN_USE: 'Port already in use for this protocol',
  NOT_FOUND: 'Resource not found',
  INPUT_NOT_FOUND: 'Input does not exist',
  DESTINATION_NOT_FOUND: 'Destination does not exist',
  PASSWORD_INCORRECT: 'Incorrect password',
  PASSWORD_LENGTH: 'Password must be 8-128 characters',
  HOST_FORMAT: 'Host may only contain letters, digits, dots, and hyphens, or be an IPv6 literal',
  SOURCE_FILTER_FORMAT: 'Only a full IP or a /8, /16, /24 CIDR is accepted',
  APPLY_FAILED: 'Apply failed',
  NAME_IN_USE: 'Name already in use',
  ROUTE_EXISTS: 'A route between this input and destination already exists',
  INTERNAL: 'Internal server error',
}

export const isErrorCode = (s: string): s is ErrorCode => s in MESSAGES

const interpolate = (tpl: string, params?: ErrorParams): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))

export const ok = <T>(data: T): Envelope<T> => ({ success: true, data, error: null })

export const fail = (code: ErrorCode, params?: ErrorParams, messageOverride?: string): Envelope<never> => ({
  success: false,
  data: null,
  error: {
    code,
    message: messageOverride ?? interpolate(MESSAGES[code], params),
    ...(params ? { params } : {}),
  },
})
