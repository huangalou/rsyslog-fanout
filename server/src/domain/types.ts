import { z } from 'zod'
import { isIPv6 } from 'node:net'

export type Protocol = 'udp' | 'tcp'
export type HeaderMode = 'raw' | 'standard'
/** off＝明文；verify＝驗證憑證鏈與名稱；anon＝只加密、不驗證對方身分 */
export type TlsMode = 'off' | 'verify' | 'anon'

export interface Input { id: number; name: string; protocol: Protocol; port: number; enabled: boolean; tls: boolean }
export interface Destination {
  id: number; name: string; protocol: Protocol; host: string; port: number
  headerMode: HeaderMode; enabled: boolean
  tlsMode: TlsMode
  /** verify 模式下憑證須符合的名稱；null 表示用 host */
  tlsPeerName: string | null
}
export interface RouteRule {
  id: number; inputId: number; destinationId: number
  sourceFilter: string | null; facilities: number[] | null; maxSeverity: number | null
}
export interface FanoutConfig { inputs: Input[]; destinations: Destination[]; routes: RouteRule[] }

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 完整 IP 原樣回傳；/8 /16 /24 轉為 startswith 前綴；其他回 null */
export function cidrToPrefix(s: string): string | null {
  const [addr, mask] = s.split('/')
  const m = IP_RE.exec(addr)
  if (!m || m.slice(1).some((o) => Number(o) > 255)) return null
  if (mask === undefined) return addr
  const octets = addr.split('.')
  if (mask === '24') return `${octets[0]}.${octets[1]}.${octets[2]}.`
  if (mask === '16') return `${octets[0]}.${octets[1]}.`
  if (mask === '8') return `${octets[0]}.`
  return null
}

const name = z.string().min(1).max(64)
const port = z.number().int().min(1).max(65535)
const protocol = z.enum(['udp', 'tcp'])

// TLS 只跑在 TCP 上；udp 搭配 TLS 沒有對應的 rsyslog 設定，於邊界直接拒絕
const TLS_REQUIRES_TCP = { message: 'TLS_REQUIRES_TCP' }
export const InputCreateSchema = z.object({ name, protocol, port, enabled: z.boolean(), tls: z.boolean().default(false) })
  .refine((v) => !v.tls || v.protocol === 'tcp', TLS_REQUIRES_TCP)
// hostname/IPv4 用嚴格白名單 regex，IPv6 literal 交給 net.isIPv6 —
// 兩者都是防止跳出 rsyslog conf 屬性注入指令的安全邊界，不可放寬。
// zone-id（fe80::1%eth0）對容器 outbound 目的地無意義，一併拒絕。
const HOSTNAME_RE = /^[A-Za-z0-9.\-]+$/
const host = z.string().min(1).max(255)
  .refine((v) => HOSTNAME_RE.test(v) || (isIPv6(v) && !v.includes('%')), { message: 'HOST_FORMAT' })
// 會原樣寫進 rsyslog conf 的 StreamDriverPermittedPeers 屬性，與 host 同為注入防護邊界，不可放寬。
// 比 hostname 多允許 *，供 rsyslog 的萬用字元比對（如 *.example.com）。
const PEER_NAME_RE = /^[A-Za-z0-9.*\-]+$/
const tlsPeerName = z.string().max(255)
  .refine((v) => PEER_NAME_RE.test(v), { message: 'TLS_PEER_NAME_FORMAT' })
export const DestinationCreateSchema = z.object({
  name, protocol, host, port,
  headerMode: z.enum(['raw', 'standard']).default('raw'), enabled: z.boolean(),
  tlsMode: z.enum(['off', 'verify', 'anon']).default('off'),
  tlsPeerName: tlsPeerName.nullable().default(null),
}).refine((v) => v.tlsMode === 'off' || v.protocol === 'tcp', TLS_REQUIRES_TCP)
export const RouteCreateSchema = z.object({
  inputId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
  sourceFilter: z.string().nullable().refine((v) => v === null || cidrToPrefix(v) !== null,
    { message: 'SOURCE_FILTER_FORMAT' }),
  facilities: z.array(z.number().int().min(0).max(23)).nullable(),
  maxSeverity: z.number().int().min(0).max(7).nullable(),
})
export type InputCreate = z.infer<typeof InputCreateSchema>
export type DestinationCreate = z.infer<typeof DestinationCreateSchema>
export type RouteCreate = z.infer<typeof RouteCreateSchema>
