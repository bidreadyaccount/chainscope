import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/config',
  'packages/shared',
  'packages/database',
  'apps/api',
  'apps/indexer',
  'apps/web',
]);
