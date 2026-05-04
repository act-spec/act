import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const SESSION_COOKIES: Record<string, string> = {
  'user-A': 'session-cookie-A',
  'user-B': 'session-cookie-B',
};

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const user = String(form.get('user') ?? '');
  const cookie = SESSION_COOKIES[user];
  if (!cookie) {
    return new Response('unknown user', { status: 400 });
  }
  cookies().set('session', cookie, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/');
}
