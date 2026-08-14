import { z } from 'zod'

export type Protocol = 'udp' | 'tcp'
export type HeaderMode = 'raw' | 'standard'

export interface Input { id: number; name: string; protocol: Protocol; port: number; enabled: boolean }
export interface Destination {
  id: number; name: string; protocol: Protocol; host: string; port: number
  headerMode: HeaderMode; enabled: boolean
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

export const InputCreateSchema = z.object({ name, protocol, port, enabled: z.boolean() })
const host = z.string().min(1).max(255)
  .regex(/^[A-Za-z0-9.\-]+$/, 'HOST_FORMAT')
export const DestinationCreateSchema = z.object({
  name, protocol, host, port,
  headerMode: z.enum(['raw', 'standard']).default('raw'), enabled: z.boolean(),
})
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
