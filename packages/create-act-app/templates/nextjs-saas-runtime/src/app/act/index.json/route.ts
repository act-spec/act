import { actMount } from '../../../lib/act-mount';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => actMount.index(req);
