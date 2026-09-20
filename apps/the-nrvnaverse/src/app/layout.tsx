import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_IDENTITY } from "@/lib/app-identity";

export const metadata: Metadata = {
  title: APP_IDENTITY.name,
  description: `${APP_IDENTITY.name} — the spatial interface of the ${APP_IDENTITY.ecosystem} ecosystem.`,
};

/**
 * Mobile viewport (M0 Step 2B.4C.2): `viewport-fit=cover` lets the shell extend under notches / the
 * home indicator so the HUD can offset itself with `env(safe-area-inset-*)`. Emitted through the
 * supported Next Viewport API (no hand-written meta tag). Zooming is left enabled (accessibility);
 * HUD controls opt out of double-tap zoom with `touch-action: manipulation` instead.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
