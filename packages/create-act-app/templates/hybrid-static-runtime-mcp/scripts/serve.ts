/**
 * `pnpm start` entrypoint. Boots the hybrid HTTP server on PORT
 * (default 3706) for manual smoke-testing and for the validator's
 * runtime-walk mode.
 *
 * Run `pnpm build:marketing` first so the static marketing tree exists
 * under `dist/marketing/` and the parent manifest at `dist/.well-known/`.
 */
import { startServer } from '../src/app/server.js';

const PORT = Number(process.env['PORT'] ?? 3706);

const { baseUrl } = await startServer(PORT);
// eslint-disable-next-line no-console
console.log(`[act-hybrid] listening on ${baseUrl}`);
// eslint-disable-next-line no-console
console.log(`[act-hybrid] try: curl -i ${baseUrl}/.well-known/act.json`);
// eslint-disable-next-line no-console
console.log(`[act-hybrid] try: curl -i ${baseUrl}/marketing/.well-known/act.json`);
// eslint-disable-next-line no-console
console.log(`[act-hybrid] auth: curl -i -H "Authorization: Bearer bearer-token-A" ${baseUrl}/app/act/index.json`);
