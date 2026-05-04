// Astro integration that runs the spec sync at the start of every
// build and dev run. Wraps `syncSpec` from `./sync-spec.mjs`.
import { syncSpec } from './sync-spec.mjs';

export function syncSpecIntegration() {
  return {
    name: 'act-sync-spec',
    hooks: {
      'astro:config:setup': async ({ logger }) => {
        const count = await syncSpec({ silent: true });
        logger.info(`mirrored ${count} spec files into src/content/docs/spec/v0.2/`);
      },
    },
  };
}
