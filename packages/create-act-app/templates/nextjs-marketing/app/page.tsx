// Root landing page. With `output: 'export'` (static hosting) the
// previous `redirect()` shape can't issue an HTTP redirect at request
// time, so this renders a tiny locale picker instead.
import Link from 'next/link';

const LOCALES = ['en-US', 'es-ES', 'de-DE', 'ja-JP'] as const;

export const metadata = {
  title: 'Acme — pick a locale',
  description: 'Locale picker for the ACT Next.js example.',
};

export default function Home() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Acme</h1>
      <p style={{ color: '#475569', marginTop: 0 }}>
        Reference Next.js + ACT marketing site. Pick a locale to get started.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 24 }}>
        {LOCALES.map((l) => (
          <li key={l} style={{ padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
            <Link href={`/${l}/pricing`} style={{ color: '#0ea5e9', fontWeight: 600 }}>
              {l} → /{l}/pricing
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
