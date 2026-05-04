import type { ReactNode } from 'react';

export const metadata = {
  title: 'Acme Workspace — ACT example',
  description: 'A multi-tenant SaaS workspace with ACT served live from runtime route handlers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          color: '#0f172a',
          background: '#f8fafc',
        }}
      >
        {children}
      </body>
    </html>
  );
}
