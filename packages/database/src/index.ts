export {
  prisma,
  disconnectPrisma,
  serializeBigInt,
  stringifyBigInt,
  bigIntJsonReplacer,
} from './client.js';

// Re-export Prisma namespace + generated model/enum types for consumers.
export { Prisma, PrismaClient } from '../generated/client/client.js';
export * from '../generated/client/enums.js';
export type * from '../generated/client/models.js';
