import { PrismaClient } from '../generated/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { serializeForWire, stringifyForWire, bigintReplacer } from '@chainscope/shared';

/**
 * Singleton Prisma client backed by the `pg` driver adapter. Prisma 7's query
 * compiler + driver adapter run entirely in JS/WASM, so no native Prisma engine
 * binary is required at runtime. A global instance is reused across
 * hot-reloads / repeated imports to avoid exhausting connections.
 */
const globalForPrisma = globalThis as unknown as {
  chainscopePrisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma: PrismaClient =
  globalForPrisma.chainscopePrisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.chainscopePrisma = prisma;
}

/**
 * BigInt-safe JSON serialization helpers. Prisma returns `bigint` for BigInt
 * columns (e.g. blockNumber); these convert them to JSON-safe values so API
 * responses never throw "Do not know how to serialize a BigInt".
 */
export const serializeBigInt = serializeForWire;
export const stringifyBigInt = stringifyForWire;
export const bigIntJsonReplacer = bigintReplacer;

/** Graceful shutdown helper (SPEC §19). */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
