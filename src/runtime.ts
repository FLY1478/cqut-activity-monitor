import { createRequire } from 'node:module';
import { join } from 'node:path';

export async function loadPlaywright(): Promise<typeof import('playwright')> {
  try { return await import('playwright'); }
  catch {
    if (!process.env.CQUT_NODE_MODULES) throw new Error('PLAYWRIGHT_NOT_INSTALLED');
    const require = createRequire(import.meta.url);
    return require(join(process.env.CQUT_NODE_MODULES, 'playwright'));
  }
}
