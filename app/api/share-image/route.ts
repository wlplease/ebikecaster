import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clean(value: string | null, fallback: string, max = 80) {
  return (value || fallback).replace(/[<>&"]/g, "").slice(0, max);
}

export async function GET(request: NextRequest) {
  const score = clean(request.nextUrl.searchParams.get("score"), "0", 16);
  const route = clean(request.nextUrl.searchParams.get("route"), "Daily Route");
  const user = clean(request.nextUrl.searchParams.get("user"), "CasterCycle rider");
  const skin = clean(request.nextUrl.searchParams.get("skin"), "Signal Yellow");
  const date = clean(request.nextUrl.searchParams.get("date"), "");
  const mission = clean(request.nextUrl.searchParams.get("mission"), "Daily mission live", 60);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#18224f"/>
      <stop offset="0.55" stop-color="#24b7a7"/>
      <stop offset="1" stop-color="#f5c75c"/>
    </linearGradient>
    <radialGradient id="sun" cx="72%" cy="20%" r="35%">
      <stop offset="0" stop-color="#fff18a" stop-opacity="0.95"/>
      <stop offset="0.45" stop-color="#ffae5a" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffae5a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <rect width="1200" height="630" fill="url(#sun)"/>
  <path d="M470 190 L730 190 L1120 630 L80 630 Z" fill="#172033"/>
  <path d="M470 190 L80 630 M730 190 L1120 630" stroke="#7cf2ff" stroke-width="10"/>
  <path d="M600 210 L565 630 M600 210 L635 630" stroke="white" stroke-opacity="0.34" stroke-width="6" stroke-dasharray="34 34"/>
  <ellipse cx="600" cy="512" rx="150" ry="28" fill="#000" opacity="0.26"/>
  <circle cx="525" cy="460" r="45" fill="none" stroke="white" stroke-width="22"/>
  <circle cx="680" cy="460" r="45" fill="none" stroke="white" stroke-width="22"/>
  <path d="M525 460 L585 350 L680 460 L610 414 L525 460 L585 350 L610 414" fill="none" stroke="white" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M610 414 L655 315 L708 304 M585 350 L554 302 L505 304" fill="none" stroke="#7cf2ff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="560" y="382" width="92" height="42" rx="6" fill="#fbe764"/>
  <path d="M590 292 L625 390 M605 332 L665 410 M603 332 L548 410" stroke="#101923" stroke-width="18" stroke-linecap="round"/>
  <circle cx="585" cy="250" r="27" fill="#f6d2a8"/>
  <ellipse cx="585" cy="226" rx="44" ry="18" fill="#ff5d73"/>
  <text x="70" y="115" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="900" fill="#fbe764" letter-spacing="8">CASTERCYCLE</text>
  <text x="70" y="172" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" fill="white" opacity="0.82">${route}</text>
  <text x="70" y="328" font-family="Arial, Helvetica, sans-serif" font-size="118" font-weight="900" fill="white">${score}</text>
  <text x="76" y="374" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="#fbe764">DAILY RIDE SCORE</text>
  <text x="76" y="438" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" fill="white" opacity="0.86">${user}</text>
  <text x="76" y="486" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="white" opacity="0.64">Skin: ${skin}</text>
  <rect x="70" y="508" width="520" height="54" rx="14" fill="#101923" opacity="0.62"/>
  <text x="96" y="542" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#7cf2ff">${mission}</text>
  <text x="76" y="590" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="white" opacity="0.64">${date}</text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
