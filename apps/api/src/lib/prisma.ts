/**
 * Prisma client singleton for the API process.
 *
 * Re-exports the base client from the shared database package and applies
 * the multi-tenant query extension so that every Prisma operation executed
 * in the API automatically inherits the active organization's tenant scope.
 *
 * TRANSACTION TYPING NOTE:
 *   The $extends client changes the $transaction callback type. Services must
 *   annotate transaction callbacks as `(tx: TransactionClient)` using the
 *   type exported here, not `Prisma.TransactionClient` from @prisma/client.
 *
 *   TransactionClient = the extended client type minus $connect/$disconnect/$extends/$use/$on/$transaction
 *   This is exactly what Prisma passes as the `tx` argument to a $transaction callback.
 */
import { prisma as basePrisma, PrismaClient } from '@opscore/database'
import { tenantExtension } from './tenantMiddleware.js'

// Apply the tenant-isolation extension to the shared singleton.
// $extends returns a new typed client; the underlying connection pool is shared.
export const prisma = basePrisma.$extends(tenantExtension)

/**
 * Transaction client type — use this in service files instead of Prisma.TransactionClient.
 *
 * Example:
 *   import { prisma, type TransactionClient } from '../lib/prisma.js'
 *   prisma.$transaction(async (tx: TransactionClient) => { ... })
 */
export type TransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

export { PrismaClient }
