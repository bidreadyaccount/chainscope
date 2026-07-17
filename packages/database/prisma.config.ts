import { defineConfig, env } from 'prisma/config';

// Prisma 7 configuration. The datasource URL lives here (not in schema.prisma).
// Migrations are applied with `prisma migrate deploy`; the client runs through
// the pg driver adapter (see src/client.ts) so no native engine is required.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
