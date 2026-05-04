import { actMount } from '../../../../lib/act-mount';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: { id: string[] } }) =>
  actMount.node(req, ctx);
