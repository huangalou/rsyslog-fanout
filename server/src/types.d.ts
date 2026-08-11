import type { AppDeps } from './app.js'
import type { Sessions } from './routes/auth.js'

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps
    sessions: Sessions
  }
}
