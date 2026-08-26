import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Dwellwise — Apartment fit, before you sign',
  description: 'Evaluate furniture fit, natural light, and livability before you sign a lease.',
  openGraph: {
    title: 'Dwellwise — Apartment fit, before you sign',
    description: 'Know whether an apartment fits your life before you sign.',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Dwellwise architectural apartment evaluation drawing' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dwellwise — Apartment fit, before you sign',
    description: 'Know whether an apartment fits your life before you sign.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
