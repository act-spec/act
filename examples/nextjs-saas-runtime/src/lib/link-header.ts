// Reusable discovery `Link` header middleware. Both the Next.js
// middleware (src/middleware.ts) and the in-process dispatch helper
// (src/lib/server.ts) import this so they emit the same hand-off header.
import { actLinkHeaderMiddleware } from '@act-spec/runtime-next';

export const linkHeader = actLinkHeaderMiddleware({
  isAuthenticated: (req) => {
    const cookieHeader = req.headers.get('cookie') ?? '';
    return /(?:^|;\s*)session=/.test(cookieHeader);
  },
});
