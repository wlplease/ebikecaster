import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FarcasterGate } from "@/components/farcaster-gate";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";
import { APP_URL, appUrl, getAccountAssociation } from "@/lib/farcaster-config";

const accountAssociation = getAccountAssociation();

const miniAppEmbed = {
  version: "1",
  imageUrl: appUrl("/media/castercycle-card.png"),
  button: {
    title: "Ride CasterCycle",
    action: {
      type: "launch_miniapp" as const,
      name: "CasterCycle",
      url: appUrl("/"),
      splashImageUrl: appUrl("/media/castercycle.png"),
      splashBackgroundColor: "#101b26",
    },
  },
};

const miniAppMetadata = {
  "fc:miniapp": JSON.stringify(miniAppEmbed),
  ...(accountAssociation ? { "fc:miniapp:account_association": JSON.stringify(accountAssociation) } : {}),
};

export const metadata: Metadata = {
  title: "CasterCycle",
  description:
    "Ride freestyle e-bike parks, unlock paid bike worlds, post scores, and challenge Farcaster friends.",
  manifest: "/manifest.json",
  icons: {
    icon: "/media/castercycle.png",
    shortcut: "/media/castercycle.png",
    apple: "/media/castercycle.png",
  },
  openGraph: {
    title: "CasterCycle",
    description:
      "Freestyle e-bike parks, paid bike worlds, clean club chat, and Farcaster scores.",
    url: APP_URL,
    images: [{ url: appUrl("/media/castercycle-hero.png"), width: 1200, height: 630 }],
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
