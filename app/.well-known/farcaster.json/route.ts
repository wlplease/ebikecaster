import { NextResponse } from "next/server";

const APP_URL = "https://ebikecaster.vercel.app";

function accountAssociation() {
  return {
    header:
      process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER ||
      "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0",
    payload:
      process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD ||
      "eyJkb21haW4iOiJlYmlrZWNhc3Rlci52ZXJjZWwuYXBwIn0",
    signature:
      process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE ||
      "z6Nv35E2261R/UQGA5R78OXF5Fa+txVlURQzbNebQEFiH9NJP07xJkvBTGyT2Rf/Pd1TxrY9Jl2SPlWlLYmE+Rs=",
  };
}

export function GET() {
  const association = accountAssociation();
  const body = {
    accountAssociation: association,
    miniapp: {
      version: "1",
      name: "CasterCycle",
      buttonTitle: "Ride CasterCycle",
      tagline: "Daily Farcaster e-bike dash.",
      subtitle: "Daily e-bike score run",
      description:
        "Ride a daily forward-scrolling e-bike route, dodge street hazards, collect charge, unlock skins, and share the score to beat.",
      iconUrl: `${APP_URL}/media/castercycle.png`,
      homeUrl: `${APP_URL}/`,
      imageUrl: `${APP_URL}/media/castercycle.png`,
      splashImageUrl: `${APP_URL}/media/castercycle.png`,
      heroImageUrl: `${APP_URL}/media/castercycle.png`,
      splashBackgroundColor: "#101b26",
      requiredChains: ["eip155:8453"],
      primaryCategory: "games",
      tags: ["game", "ebike", "daily", "farcaster", "base"],
      actions: ["composeCast"],
      ogTitle: "CasterCycle - Daily Farcaster E-Bike Dash",
      ogDescription:
        "One daily e-bike route. Ride, score, unlock skins, and challenge Farcaster friends.",
      ogImageUrl: `${APP_URL}/media/castercycle.png`,
      castShareUrl: `${APP_URL}/`,
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
