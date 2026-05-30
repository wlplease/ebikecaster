import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FarcasterGate } from "@/components/farcaster-gate";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";

const appDomain = process.env.NEXT_PUBLIC_APP_URL || "https://castercycle.vercel.app";

const accountAssociation = {
  header:
    process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER ||
    "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0",
  payload:
    process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD ||
    "eyJkb21haW4iOiJjYXN0ZXJjeWNsZS52ZXJjZWwuYXBwIn0=",
  signature: process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "",
};

const miniAppEmbed = {
  version: "1",
  imageUrl: `${appDomain}/media/castercycle-card.png`,
  button: {
    title: "Ride CasterCycle",
    action: {
      type: "launch_miniapp" as const,
      name: "CasterCycle",
      url: appDomain,
      splashImageUrl: `${appDomain}/media/castercycle.png`,
      splashBackgroundColor: "#101b26",
    },
  },
};

const miniAppMetadata = {
  "fc:miniapp": JSON.stringify(miniAppEmbed),
  ...(accountAssociation.signature
    ? { "fc:miniapp:account_association": JSON.stringify(accountAssociation) }
    : {}),
};

export const metadata: Metadata = {
  title: "CasterCycle",
  description:
    "Ride today's forward-scrolling e-bike route, post your score, and challenge Farcaster friends.",
  manifest: "/manifest.json",
  icons: {
    icon: "/media/castercycle.png",
    shortcut: "/media/castercycle.png",
    apple: "/media/castercycle.png",
  },
  openGraph: {
    title: "CasterCycle",
    description:
      "One daily e-bike route. Grab charge, clear hazards, and share the score to beat.",
    url: appDomain,
    images: [{ url: `${appDomain}/media/castercycle-hero.png`, width: 1200, height: 630 }],
  },
  other: miniAppMetadata,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <body>
        <Providers>
          <FarcasterGate>{children}</FarcasterGate>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
