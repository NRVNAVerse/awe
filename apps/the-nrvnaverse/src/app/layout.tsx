import type { Metadata } from "next";
import "./globals.css";
import { APP_IDENTITY } from "@/lib/app-identity";

export const metadata: Metadata = {
  title: APP_IDENTITY.name,
  description: `${APP_IDENTITY.name} — the spatial interface of the ${APP_IDENTITY.ecosystem} ecosystem.`,
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
