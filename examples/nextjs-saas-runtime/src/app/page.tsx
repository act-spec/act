import { cookies } from 'next/headers';
import Link from 'next/link';

import { db, PROBE_FIXTURE } from '../lib/db';

export const dynamic = 'force-dynamic';

export default function Page() {
  const sessionCookie = cookies().get('session')?.value;
  const userId = sessionCookie ? db.sessions.findUserIdByCookie(sessionCookie) : undefined;
  const user = userId ? db.users.findById(userId) : undefined;
  const docs = user ? db.documents.listByTenant(user.tenantId) : [];

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 16,
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <strong style={{ fontSize: 20 }}>Acme Workspace</strong>
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 14 }}>
          {user ? `signed in as ${user.id} (${user.tenantId})` : 'signed out'}
        </span>
        {user && (
          <form action="/api/logout" method="post" style={{ margin: 0 }}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        )}
      </header>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ margin: '0 0 12px' }}>What this is</h2>
        <p style={{ color: '#475569', margin: '0 0 12px' }}>
          A multi-tenant workspace serving ACT live from Next.js route handlers. Sign in as a
          fixture user to see your tenant's documents both in the UI and via the ACT runtime
          mount.
        </p>
        <ul style={{ color: '#475569', margin: 0, paddingLeft: 20 }}>
          <li>
            Public landing — anonymous-readable: <code>/act/n/public/landing</code>
          </li>
          <li>
            Per-tenant docs — auth required, identity-scoped:
            <code> /act/n/&lt;doc-id&gt;</code>
          </li>
          <li>
            Cross-tenant access returns a byte-identical 404 — try as user-A then user-B.
          </li>
        </ul>
      </section>

      {!user && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ margin: '0 0 12px' }}>Sign in (fixture)</h2>
          <div style={{ display: 'flex', gap: 12 }}>
            <form action="/api/login" method="post" style={{ margin: 0 }}>
              <input type="hidden" name="user" value="user-A" />
              <button type="submit" style={btnPrimary}>
                Sign in as user-A (tenant-acme)
              </button>
            </form>
            <form action="/api/login" method="post" style={{ margin: 0 }}>
              <input type="hidden" name="user" value="user-B" />
              <button type="submit" style={btnPrimary}>
                Sign in as user-B (tenant-beta)
              </button>
            </form>
          </div>
        </section>
      )}

      {user && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ margin: '0 0 12px' }}>Your documents ({docs.length})</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {docs.map((d) => (
              <article
                key={d.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ fontFamily: 'ui-monospace, monospace', color: '#64748b', fontSize: 12 }}>
                  {d.id}
                </div>
                <div style={{ fontWeight: 600, margin: '4px 0 6px' }}>{d.title}</div>
                <div style={{ color: '#475569', fontSize: 14 }}>{d.summary}</div>
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  ACT:{' '}
                  <Link href={`/act/n/${d.id}`} style={{ fontFamily: 'ui-monospace, monospace' }}>
                    /act/n/{d.id}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ margin: '0 0 12px' }}>ACT endpoints (try these)</h2>
        <ul style={{ color: '#475569', margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>
            <Link href="/.well-known/act.json">/.well-known/act.json</Link>{' '}
            <span style={{ color: '#64748b' }}>(401 if signed out)</span>
          </li>
          <li>
            <Link href="/act/index.json">/act/index.json</Link>{' '}
            <span style={{ color: '#64748b' }}>(filtered to your tenant)</span>
          </li>
          <li>
            <Link href="/act/n/public/landing">/act/n/public/landing</Link>{' '}
            <span style={{ color: '#64748b' }}>(anonymous-readable)</span>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ margin: '0 0 12px' }}>Bearer-token access</h2>
        <p style={{ color: '#475569', margin: '0 0 12px' }}>
          Every cookie session above also exposes a bearer token (for service identities):
        </p>
        <pre
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: 12,
            fontSize: 12,
            overflowX: 'auto',
            margin: 0,
          }}
        >{`# user-A
curl -i \\
  -H 'Authorization: Bearer ${PROBE_FIXTURE.principalA.bearer}' \\
  http://localhost:3000/act/n/doc/acme-roadmap-2026

# user-B asking for user-A's doc → 404 byte-identical to a non-existent doc
curl -i -H 'Authorization: Bearer ${PROBE_FIXTURE.principalB.bearer}' http://localhost:3000/act/n/doc/acme-roadmap-2026
curl -i -H 'Authorization: Bearer ${PROBE_FIXTURE.principalB.bearer}' http://localhost:3000/act/n/doc/never-existed`}</pre>
      </section>

      <footer
        style={{
          marginTop: 48,
          paddingTop: 16,
          borderTop: '1px solid #e2e8f0',
          color: '#64748b',
          fontSize: 13,
        }}
      >
        ACT mount served live by Next.js route handlers under <code>src/app/.well-known/</code>{' '}
        and <code>src/app/act/</code>.
      </footer>
    </div>
  );
}

const btnPrimary = {
  background: '#0f172a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '10px 16px',
  cursor: 'pointer',
  fontSize: 14,
} as const;
