import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UP Roadways Live | Real-time UPSRTC Bus Tracking & ETA',
  description: 'Track Uttar Pradesh roadways (UPSRTC) buses in real-time. Search by route or bus number to see live map location, passed stops, delays, and estimated arrival times (ETA).',
  keywords: 'UPSRTC, UP Roadways, Live Bus Tracking, UP Bus status, Where is my bus UP, Lucknow bus tracking, Noida Meerut roadways',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Leaflet CSS for Map rendering */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body>
        <main style={{ flex: 1 }}>{children}</main>
      </body>
    </html>
  );
}
