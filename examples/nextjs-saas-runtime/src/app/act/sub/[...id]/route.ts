import { actMount } from '../../../../lib/act-mount';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: { id: string[] } },
): Promise<Response> {
  if (!actMount.subtree) {
    return new Response('subtree not enabled', { status: 404 });
  }
  return actMount.subtree(req, ctx);
}
