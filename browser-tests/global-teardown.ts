import { stopLightpanda, type LightpandaContext } from './helpers.js';

declare global {
  // eslint-disable-next-line no-var
  var __LIGHTPANDA__: LightpandaContext | undefined;
}

async function globalTeardown() {
  const ctx = globalThis.__LIGHTPANDA__;
  if (ctx) {
    console.log('[browser-tests] Stopping Lightpanda...');
    await stopLightpanda(ctx);
    console.log('[browser-tests] Lightpanda stopped');
  }
}

export default globalTeardown;
