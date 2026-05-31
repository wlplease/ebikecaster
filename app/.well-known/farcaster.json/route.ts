import { NextResponse } from "next/server";
import { FARCASTER_SHARE_URL, appUrl, getAccountAssociation } from "@/lib/farcaster-config";

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
        "Freestyle Community and State Park rides, unlock E-Bike Land, customize bikes, join the paid club, and share scores.",
      screenshotUrls: [
        appUrl("/media/castercycle-screenshot-ready.png"),
        appUrl("/media/castercycle-screenshot-ride.png"),
        appUrl("/media/castercycle-screenshot-result.png"),
      ],
      primaryCategory: "games",
      tags: ["game", "ebike", "daily", "farcaster", "base"],
      heroImageUrl: appUrl("/media/castercycle-hero.png"),
      tagline: "Park e-bike dash.",
      ogTitle: "CasterCycle",
      ogDescription:
        "Ride open parks, unlock E-Bike Land, customize bikes, and challenge Farcaster friends.",
      ogImageUrl: appUrl("/media/castercycle-hero.png"),
      castShareUrl: FARCASTER_SHARE_URL,
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
