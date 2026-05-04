// Discovery hand-off `Link` header for non-ACT routes — lets ACT-aware
// agents discover the mount from any URL on the origin.
//
// We inline the Link header instead of importing actLinkHeaderMiddleware
// from @act-spec/runtime-next because Next.js middleware runs in the Edge
// Runtime, which doesn't support the `node:crypto` imports that the SDK
// transitively uses. The actual ACT route handlers under src/app/ run in
// the Node runtime and use the SDK directly.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const LINK_VALUE = '</.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"';

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const isAuthenticated = /(?:^|;\s*)session=/.test(cookieHeader);
  const res = NextResponse.next();
  if (isAuthenticated) {
    res.headers.append('Link', LINK_VALUE);
  }
  return res;
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico|act|\\.well-known).*)',
};
