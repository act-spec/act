import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamicParams = false;

const LOCALES = ['en-US', 'es-ES', 'de-DE', 'ja-JP'] as const;
type Locale = (typeof LOCALES)[number];

const ROUTES = ['pricing', 'features', 'about', 'contact', 'privacy', 'dpa'] as const;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!LOCALES.includes(params.locale as Locale)) notFound();

  return (
    <div>
      <header
        style={{
          borderBottom: '1px solid #e2e8f0',
          padding: '12px 24px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <strong>Acme</strong>
        <nav style={{ display: 'flex', gap: 12 }}>
          {ROUTES.map((r) => (
            <Link key={r} href={`/${params.locale}/${r}`} style={{ color: '#0ea5e9' }}>
              {r}
            </Link>
          ))}
        </nav>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 13 }}>
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/${l}/pricing`}
              style={{ color: l === params.locale ? '#0f172a' : '#64748b' }}
            >
              {l}
            </Link>
          ))}
        </span>
      </header>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>{children}</main>
      <footer style={{ borderTop: '1px solid #e2e8f0', padding: 16, color: '#64748b', fontSize: 13 }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          ACT artifacts available at <code>/.well-known/act.json</code> and <code>/act/...</code>.
        </div>
      </footer>
    </div>
  );
}
