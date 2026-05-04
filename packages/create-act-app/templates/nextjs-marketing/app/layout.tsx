import type { ReactNode } from 'react';

export const metadata = {
  title: 'Acme — ACT example',
  description: 'A Next.js + ACT reference site.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          margin: 0,
          padding: 0,
          color: '#0f172a',
          background: '#f8fafc',
        }}
      >
        {children}
      </body>
    </html>
  );
}
