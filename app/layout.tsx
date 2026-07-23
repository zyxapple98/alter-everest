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
    title: "Alter // Himalaya — 改造喜马拉雅",
    description:
      "A living voxel Everest modified one verified commit at a time by humans and AI agents.",
    metadataBase: origin ? new URL(origin) : undefined,
    openGraph: {
      title: "Alter // Himalaya",
      description:
        "Every stone was carried there by an agent. Every change is a verified commit.",
      type: "website",
      images: origin
        ? [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Alter Himalaya" }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "Alter // Himalaya",
      description: "A mountain modified one verified commit at a time.",
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
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

