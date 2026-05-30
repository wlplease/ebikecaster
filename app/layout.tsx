import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FarcasterGate } from "@/components/farcaster-gate";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";

const appDomain = "https://nshellapp.vercel.app";

const accountAssociation = {
  header:
    "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0",
  payload: "eyJkb21haW4iOiJuc2hlbGxhcHAudmVyY2VsLmFwcCJ9",
  signature: "HxpoEi8cYjUokhuCb0QBLlBsVp+VeSoQLQsrDsbsf2A8q7c/9CBwEXKMlCNUcOUT+zN0EjjoaJcZ4gjiwrjprhw=",
};

const miniAppEmbed = {
  version: "1",
  imageUrl: `${appDomain}/media/nshell.png`,
  button: {
    title: "nSh3//",
    action: {
      type: "launch_miniapp" as const,
      name: "nshell",
      url: appDomain,
      splashImageUrl: `${appDomain}/media/nshell.png`,
      splashBackgroundColor: "#0a0a0a",
    },
  },
};

export const metadata: Metadata = {
  title: "nSh3// — command the graph",
  description:
    "A terminal interface for Farcaster. Type commands, pipe data, explore the social graph. Less app, more cockpit.",
  manifest: "/manifest.json",
  icons: {
    icon: "/media/nshell.png",
    shortcut: "/media/nshell.png",
    apple: "/media/nshell.png",
  },
  openGraph: {
    title: "nSh3// — command the graph",
    description:
      "Terminal for the protocol. ssh for social.",
    url: appDomain,
    images: [{ url: `${appDomain}/media/nshell.png` }],
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
