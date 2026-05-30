import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://castercycle.vercel.app";
const ASSOCIATION_HEADER =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER ||
  "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0";
const ASSOCIATION_PAYLOAD =
  process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD ||
  "eyJkb21haW4iOiJjYXN0ZXJjeWNsZS52ZXJjZWwuYXBwIn0=";
const ASSOCIATION_SIGNATURE = process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "";

function appUrl(path = "/") {
  return new URL(path, APP_URL).toString();
}

export function GET() {
  const body = {
    ...(ASSOCIATION_SIGNATURE
      ? {
          accountAssociation: {
            header: ASSOCIATION_HEADER,
            payload: ASSOCIATION_PAYLOAD,
            signature: ASSOCIATION_SIGNATURE,
          },
        }
      : {}),
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
