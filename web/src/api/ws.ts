export const nextBackoff = (prev: number): number => Math.min(prev === 0 ? 1000 : prev * 2, 30000)

export interface WsHandlers {
  onStats?(s: unknown): void
  onTail?(m: unknown): void
  onState?(open: boolean): void
}

export function connectWs(h: WsHandlers): () => void {
  let ws: WebSocket | null = null
  let delay = 0
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const open = () => {
    if (closed) return
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
    ws.onopen = () => {
      delay = 0
      h.onState?.(true)
    }
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as { ch: 'stats' | 'tail'; data: unknown }
      if (m.ch === 'stats') h.onStats?.(m.data)
      if (m.ch === 'tail') h.onTail?.(m.data)
    }
    ws.onclose = () => {
      h.onState?.(false)
      if (closed) return
      delay = nextBackoff(delay)
      reconnectTimer = setTimeout(open, delay)
    }
  }
  open()
  return () => {
    closed = true
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    ws?.close()
  }
}
