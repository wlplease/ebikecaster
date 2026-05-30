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
      subtitle: "Daily e-bike score run",
      description:
        "Ride a daily forward-scrolling e-bike route, dodge street hazards, collect charge, unlock skins, and share the score to beat.",
      screenshotUrls: [
        appUrl("/media/castercycle-screenshot-ready.png"),
        appUrl("/media/castercycle-screenshot-ride.png"),
        appUrl("/media/castercycle-screenshot-result.png"),
      ],
      primaryCategory: "games",
      tags: ["game", "ebike", "daily", "farcaster", "base"],
      heroImageUrl: appUrl("/media/castercycle-hero.png"),
      tagline: "Daily e-bike dash.",
      ogTitle: "CasterCycle",
      ogDescription:
        "One daily e-bike route. Ride, score, unlock skins, and challenge Farcaster friends.",
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
