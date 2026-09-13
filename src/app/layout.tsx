import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'AfterHours AI — Know what moved after the close',
  description:
    'An AI research desk for US equities. See what changed after the market close and what to consider doing next. Research and decision support only — never order execution.',
  applicationName: 'AfterHours AI',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'AfterHours AI',
    description:
      'Know what moved after the close. Decide what comes next. Research and decision support only.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is left enabled — capping it would break accessibility for anyone
  // who needs to magnify the numbers.
  themeColor: '#04050C',
  // Lets the sticky Analyse bar pad itself against the home-indicator area
  // instead of sitting under it on a notched phone.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {/*
          A single full-bleed ambient layer behind everything. Kept out of the
          body background so it can be positioned without affecting layout.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 opacity-70"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgba(56,232,255,0.05) 0%, transparent 28%), linear-gradient(0deg, rgba(4,5,12,0.9) 0%, transparent 40%)',
          }}
        />
        {children}
      </body>
    </html>
  );
}
