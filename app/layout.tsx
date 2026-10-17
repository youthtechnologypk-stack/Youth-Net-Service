import React from 'react';
import { CurrencyProvider } from '../src/context/CurrencyContext';
import { ISPProvider } from '../src/context/ISPContext';

export const viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata = {
  title: 'Youth Net NOC - Carrier Management Platform',
  description: 'Carrier ISP Billing, MikroTik RouterOS v7 BNG, and VSOL OLT Fiber Management Platform',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Youth Net NOC',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#020617" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Youth Net NOC" />
        <meta name="application-name" content="Youth Net NOC" />
        <meta name="msapplication-TileColor" content="#020617" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased font-sans">
        <CurrencyProvider>
          <ISPProvider>{children}</ISPProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
