import { NextResponse } from "next/server";
import { appUrl, getAccountAssociation } from "@/lib/farcaster-config";

export function GET() {
  const accountAssociation = getAccountAssociation();
  const body = {
    ...(accountAssociation ? { accountAssociation } : {}),
    miniapp: {
      version: "1",
      name: "CasterCycle",
      iconUrl: appUrl("/media/castercycle.png"),
      homeUrl: appUrl("/"),
      imageUrl: appUrl("/media/castercycle-card.png"),
      buttonTitle: "Ride CasterCycle",
      splashImageUrl: appUrl("/media/castercycle.png"),
      splashBackgroundColor: "#101b26",
      subtitle: "Freestyle park rides",
      description:
        "Ride Freestyle Park free for 30 seconds, unlock unlimited play, explore E-Bike Land, customize bikes, and share scores.",
      screenshotUrls: [
        appUrl("/media/castercycle-screenshot-ready.png"),
        appUrl("/media/castercycle-screenshot-ride.png"),
        appUrl("/media/castercycle-screenshot-result.png"),
      ],
      primaryCategory: "games",
      tags: ["game", "ebike", "daily", "farcaster", "base"],
      canonicalDomain: "castercycle.vercel.app",
      requiredChains: ["eip155:8453"],
      requiredCapabilities: ["wallet.getEthereumProvider", "actions.composeCast"],
      heroImageUrl: appUrl("/media/castercycle-hero.png"),
      tagline: "Park e-bike dash.",
      ogTitle: "CasterCycle",
      ogDescription:
        "Free 30-second park rides, unlimited Cycle Pass play, E-Bike Land, and Farcaster challenges.",
      ogImageUrl: appUrl("/media/castercycle-hero.png"),
      castShareUrl: appUrl("/"),
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
