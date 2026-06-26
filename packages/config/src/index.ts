import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().default(3000),
  WORKER_CONCURRENCY_WORKFLOW: z.coerce.number().default(10),
  WORKER_CONCURRENCY_NOTIFICATIONS: z.coerce.number().default(20),
  WORKER_CONCURRENCY_METRICS: z.coerce.number().default(5),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
})

export const config = schema.parse(process.env)
export type Config = z.infer<typeof schema>
