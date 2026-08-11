export interface Envelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

export const ok = <T>(data: T): Envelope<T> => ({ success: true, data, error: null })
export const fail = (error: string): Envelope<never> => ({ success: false, data: null, error })
