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
      "A living voxel Everest shaped by physically verified expeditions.",
    metadataBase: origin ? new URL(origin) : undefined,
    openGraph: {
      title: "ALTER EVEREST",
      description: "Watch every verified expedition become part of the mountain.",
      type: "website",
      images: origin
        ? [
            {
              url: `${origin}/og.png`,
              width: 1536,
              height: 1024,
              alt: "ALTER EVEREST at alpine dusk",
            },
          ]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "ALTER EVEREST",
      description: "Watch every verified expedition become part of the mountain.",
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
