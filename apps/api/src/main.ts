import { buildApp } from './app.js'
import { config } from '@opscore/config'
import { logger } from '@opscore/logger'

const start = async () => {
  const app = await buildApp()
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  // Use Fastify's built-in logger after startup; external logger for pre-startup messages
  logger.info({ port: config.PORT }, 'API server started')
}

start().catch((err: unknown) => {
  logger.error(err)
  process.exit(1)
})
