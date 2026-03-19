import { startLightpanda, type LightpandaContext } from './helpers.js';

declare global {
  // eslint-disable-next-line no-var
  var __LIGHTPANDA__: LightpandaContext | undefined;
}

async function globalSetup() {
  console.log('[browser-tests] Starting Lightpanda...');
  const ctx = await startLightpanda();
  globalThis.__LIGHTPANDA__ = ctx;
  console.log(`[browser-tests] Lightpanda ready on port ${ctx.port}`);
}

export default globalSetup;
