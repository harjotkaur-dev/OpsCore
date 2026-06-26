/**
 * Integration test global setup.
 *
 * Loaded by vitest.integration.config.ts via setupFiles.
 * Runs before each test file (not each test) to:
 *   1. Point Prisma at the isolated test database
 *   2. Apply all migrations so the schema is current
 *   3. Flush Redis DB 1 (dedicated test slot)
 *   4. Expose helpers for per-test cleanup
 */

import { execSync } from 'node:child_process'
import { beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'

// ---------------------------------------------------------------------------
// Environment — force all modules to use the test database
// ---------------------------------------------------------------------------
const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://opscore:opscore_dev@localhost:5432/opscore_test'

const TEST_REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'

// Set before any module under test imports @opscore/config or prisma
process.env['DATABASE_URL'] = TEST_DB_URL
process.env['TEST_DATABASE_URL'] = TEST_DB_URL
process.env['REDIS_URL'] = TEST_REDIS_URL
process.env['NODE_ENV'] = 'test'
process.env['LOG_LEVEL'] = 'warn'

// JWT keys — minimal valid RSA pair for testing
// These are test-only keys; never use in production.
process.env['JWT_PRIVATE_KEY'] = `-----BEGIN RSA PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwyMBoXqFazlxm
ekl5+dtydaiwu7F/w1hVmZiv9JF148m/3j5lftQG0yeAw0L1yZQLDebhdhYfzkpd
23ZWE1dFEqigidrDoqsJ8aTK/2XYKL1UrMF+xmrxsomUkLcTv5sWiIJ4CycbS99i
pn9Y1BAfFDQ8rt/yRc24S200dNB2l8p/D2wqTZqBx6aplI6ZQ8j7AB0QgIIOUtTB
2pXd3Xd7UA308+3KH8uWnFLwWi//Ks9G4YWxBju6+ljsm6xaQv5Z1wMsrHIdu1Hn
2TaKxDMHsAsJ3SpByQQRDPkyFgfOO46QgE3h5eiGiDOIDomIhpp4ejAaaXncw/61
cviz8wEzAgMBAAECggEAAh34AT1M37UD8e2PTrN5d3aa6rmSB8PTnXwlkh8y1L9s
bZdK66qSqHLukKywncKTEB9+VH82XEgl/NdsJIi+bU3VZiLF02ecdmswkYZwdkpl
RgvRlLk/Pki95rZlnYoYYIiJo3K4E6wbbzzWM+lKOM0O+RZmXn+L1flVQ/Zi1Atl
MJ9xF7/NXYvzZTeUzvbQYFMLbbloaYj273nwY/k3JYyA92rxhmWjDb/c1ruYyX+I
lXlyWZ+s8MMV+Mu2tuID1AVLid8Ks+dfIWpBdnfWcoZGB811hqG1blwweJFrSadr
qJ1fU0TRIFM4PzwPWIA5vS28CTE11EuGA4gnM+v+RQKBgQDqjwrRVvolf4XqVciX
Q9Kam312I64Qg0WUTAeBWv0GpTZvRMDEC1yqJjRc/fH85My4SezH4JiDFiMmXEFR
/El9FyktPms5T3jt6KYb6UFGrjh1ssMXJ42sTGGKxzTZ7OASeEur/ieGuzbiQWyB
Lj1YDDAiiMgUvbbJlJcA8sDthwKBgQDA8bb1AeVVJX2AJWCkr4mkg+fZgS4qWFDj
5c0I5+ehyVRvzDoIF25yllM4IY/FJeWXqkIonc6vh/b6f7YduEC1DsaNTO49Amys
sl21/AnGA3ITHRlQqtFd8XsMULZHWmmSX022uCbZdRedIOm2aARbPoYAOB8T2G0q
/6SMeFaZ9QKBgHc5fiYqL7wftdIHCI7aypILtxn1yORb1WIrwyTdOv/FuoWUTOdZ
XyCdisA51GbXZbfG27Q9VUhMWFGHUyx5MGGFBEkbESVwX+eN+eD2D1f99nTdCI0c
bcbGjE4eM58R6FN7Efu6lBzHzH31A1ImTsgSaeUj4Y+pXt/Xx2mT+rzBAoGBAIKE
wJv6vVUc+EmwfzDIYhb89+DFpyIT/hw8PrfQkHt8Avdhsrv4hclT8VWeNnBJ04cG
MJzjK4bINgV8UQjHtFYGeb/qE5sHwdYNDqFlroLZn9hYLeDIvLqM+Qz6qGOaQKI4
gAyjg/xEXkX3lsHCmXfT0rfhPvygwjB9IKW5XfPlAoGBAJDhhhcaDuFeN15xNqOh
0jZWRHbqWKychq82XC0UcDmMtTgsffF2nu9rSKrNfjfXwrLfi8rG6TZEYIBApefH
LjBlgCiLbVAKTyGnBk0TmERTTvFY0ZMEZYYpxe7WIX9JBq95V/GH4pH/H0sXpD3f
E/Y7DzhZQOKEgoJCKyLTzHmQ
-----END RSA PRIVATE KEY-----`

process.env['JWT_PUBLIC_KEY'] = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsMjAaF6hWs5cZnpJefnb
cnWosLuxf8NYVZmYr/SRdePJv94+ZX7UBtMngMNC9cmUCw3m4XYWH85KXdt2VhNX
RRKooInaw6KrCfGkyv9l2Ci9VKzBfsZq8bKJlJC3E7+bFoiCeAsnG0vfYqZ/WNQQ
HxQ0PK7f8kXNuEttNHTQdpfKfw9sKk2agcemqZSOmUPI+wAdEICCDlLUwdqV3d13
e1AN9PPtyh/LlpxS8Fov/yrPRuGFsQY7uvpY7JusWkL+WdcDLKxyHbtR59k2isQz
B7ALCd0qQckEEQz5MhYHzjuOkIBN4eXohogziA6JiIaaeHowGml53MP+tXL4s/MB
MwIDAQAB
-----END PUBLIC KEY-----`

process.env['COOKIE_SECRET'] = 'test-cookie-secret-32-chars-long!!'
process.env['CORS_ORIGIN'] = 'http://localhost:5173'
process.env['PORT'] = '3001'
process.env['WORKER_CONCURRENCY_WORKFLOW'] = '1'
process.env['WORKER_CONCURRENCY_NOTIFICATIONS'] = '1'
process.env['WORKER_CONCURRENCY_METRICS'] = '1'

// ---------------------------------------------------------------------------
// Shared clients (lazy-initialised in beforeAll)
// ---------------------------------------------------------------------------
let prisma: PrismaClient
let redis: Redis

export function getTestPrisma(): PrismaClient {
  return prisma
}

export function getTestRedis(): Redis {
  return redis
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Apply all migrations to the test database
  execSync(
    'npx prisma migrate deploy --schema=../../packages/database/prisma/schema.prisma',
    {
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: 'pipe',
    },
  )

  prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
  await prisma.$connect()

  redis = new Redis(TEST_REDIS_URL, { db: 1, lazyConnect: true })
  await redis.connect()
  await redis.flushdb() // clear Redis DB 1 before the suite
})

afterEach(async () => {
  // Truncate all tables in reverse dependency order after each test
  // so tests are fully isolated without needing transaction rollback tricks
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs,
      idempotency_keys,
      notifications,
      metric_history,
      kpis,
      metrics,
      task_comments,
      task_assignments,
      tasks,
      executions,
      workflow_versions,
      workflows,
      events,
      event_types,
      refresh_tokens,
      team_members,
      teams,
      organization_members,
      users,
      organizations
    RESTART IDENTITY CASCADE
  `)
  await redis.flushdb()
})

afterAll(async () => {
  await prisma.$disconnect()
  redis.disconnect()
})
