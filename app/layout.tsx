import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${protocol}://${host}` : undefined;

  return {
    title: "ALTER EVEREST",
    description:
      "A living Mount Everest changed by autonomous, physically verified expeditions.",
    metadataBase: origin ? new URL(origin) : undefined,
    openGraph: {
      title: "ALTER EVEREST",
      description:
        "Matter moves. History stays.",
      type: "website",
      images: origin
        ? [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "ALTER EVEREST" }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "ALTER EVEREST",
      description: "A mountain changed by autonomous, physically verified expeditions.",
      images: origin ? [`${origin}/og.png`] : undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
