import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FarcasterGate } from "@/components/farcaster-gate";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";

const appDomain = process.env.NEXT_PUBLIC_APP_URL || "https://nshellapp.vercel.app";

const accountAssociation = {
  header:
    "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0",
  payload: "eyJkb21haW4iOiJuc2hlbGxhcHAudmVyY2VsLmFwcCJ9",
  signature: "HxpoEi8cYjUokhuCb0QBLlBsVp+VeSoQLQsrDsbsf2A8q7c/9CBwEXKMlCNUcOUT+zN0EjjoaJcZ4gjiwrjprhw=",
};

const miniAppEmbed = {
  version: "1",
  imageUrl: `${appDomain}/media/voltlane.png`,
  button: {
    title: "Ride VoltLane",
    action: {
      type: "launch_miniapp" as const,
      name: "VoltLane",
      url: appDomain,
      splashImageUrl: `${appDomain}/media/voltlane.png`,
      splashBackgroundColor: "#101b26",
    },
  },
};

export const metadata: Metadata = {
  title: "VoltLane - Daily E-Bike Dash",
  description:
    "Ride today's side-scrolling e-bike route, post your score, and challenge Farcaster friends.",
  manifest: "/manifest.json",
  icons: {
    icon: "/media/voltlane.png",
    shortcut: "/media/voltlane.png",
    apple: "/media/voltlane.png",
  },
  openGraph: {
    title: "VoltLane - Daily E-Bike Dash",
    description:
      "One daily e-bike route. Grab charge, clear hazards, and share the score to beat.",
    url: appDomain,
    images: [{ url: `${appDomain}/media/voltlane.png` }],
  },
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:miniapp:account_association": JSON.stringify(accountAssociation),
  },
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
