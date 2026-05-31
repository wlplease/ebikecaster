import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clean(value: string | null, fallback: string, max = 80) {
  return (value || fallback).replace(/[<>&"]/g, "").slice(0, max);
}

export async function GET(request: NextRequest) {
  const mode = clean(request.nextUrl.searchParams.get("mode"), "dash", 16);
  const score = clean(request.nextUrl.searchParams.get("score"), "0", 16);
  const route = clean(request.nextUrl.searchParams.get("route"), "Community Park");
  const user = clean(request.nextUrl.searchParams.get("user"), "CasterCycle rider");
  const skin = clean(request.nextUrl.searchParams.get("skin"), "Signal Yellow");
  const date = clean(request.nextUrl.searchParams.get("date"), "");
  const mission = clean(request.nextUrl.searchParams.get("mission"), "Daily mission live", 60);
  const invite = mode === "invite";
  const freestyle = mode === "freestyle";
  const headline = invite ? "FREE PARK RIDES" : freestyle ? "FREESTYLE PARK SCORE" : "DAILY DASH SCORE";
  const bigNumber = invite ? "RIDE" : score;
  const missionText = invite ? "30s free roam. $1 day or $7 lifetime on Base." : mission;
  const skyStart = freestyle ? "#247a70" : invite ? "#263d7a" : "#1e73b6";
  const skyMid = freestyle ? "#7bcf74" : invite ? "#35c6b7" : "#80c86a";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${skyStart}"/>
      <stop offset="0.46" stop-color="${skyMid}"/>
      <stop offset="1" stop-color="#f5d46b"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#071018" stop-opacity="0.76"/>
      <stop offset="0.52" stop-color="#071018" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#071018" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <circle cx="100" cy="98" r="128" fill="#fff18a" opacity="0.72"/>
  <path d="M0 365 C160 280 260 345 410 275 C565 202 686 284 835 198 C956 128 1050 154 1200 98 L1200 630 L0 630 Z" fill="#2f8d57" opacity="0.68"/>
  <path d="M0 472 C155 380 260 455 420 372 C588 286 720 388 890 282 C1005 210 1095 238 1200 188 L1200 630 L0 630 Z" fill="#173f34" opacity="0.74"/>
  <path d="M734 168 C770 230 784 315 753 400 C719 492 776 555 878 630 L1060 630 C930 534 908 452 955 360 C1014 244 966 156 866 106 Z" fill="#29205d" opacity="0.88"/>
  <path d="M776 195 C842 256 884 326 848 415 C822 480 844 536 940 612" fill="none" stroke="#ff7adf" stroke-width="10" opacity="0.82" filter="url(#glow)"/>
  <path d="M672 110 C558 198 486 292 456 408 C432 502 360 562 246 630" fill="none" stroke="#7cf2ff" stroke-width="18" opacity="0.72"/>
  <path d="M495 218 L622 218 L1068 630 L118 630 Z" fill="#102438"/>
  <path d="M495 218 L118 630 M622 218 L1068 630" stroke="#9ff28a" stroke-width="9" filter="url(#glow)"/>
  <path d="M560 236 L525 630 M560 236 L602 630" stroke="white" stroke-opacity="0.36" stroke-width="5" stroke-dasharray="34 34"/>
  <rect width="1200" height="630" fill="url(#shade)"/>

  <g transform="translate(618 366)">
    <ellipse cx="0" cy="92" rx="142" ry="28" fill="#000" opacity="0.28"/>
    <circle cx="-72" cy="60" r="44" fill="none" stroke="white" stroke-width="18"/>
    <circle cx="86" cy="60" r="44" fill="none" stroke="white" stroke-width="18"/>
    <path d="M-72 60 L-8 -42 L86 60 L14 0 L-72 60 L-8 -42 L14 0" fill="none" stroke="white" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="-18" y="-8" width="92" height="44" rx="7" fill="#fbe764"/>
    <path d="M12 0 L58 -90 L106 -96 M-8 -42 L-40 -88 L-92 -94" fill="none" stroke="#7cf2ff" stroke-width="14" stroke-linecap="round"/>
    <circle cx="-10" cy="-132" r="25" fill="#f6d2a8"/>
    <ellipse cx="-10" cy="-158" rx="46" ry="18" fill="#ff5d73"/>
    <path d="M0 -110 L38 14 M16 -70 L78 48 M14 -70 L-42 48" stroke="#101923" stroke-width="16" stroke-linecap="round"/>
  </g>

  <g transform="translate(72 95)">
    <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="900" fill="#fbe764" letter-spacing="8">CASTERCYCLE</text>
    <text x="0" y="58" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="900" fill="white" opacity="0.9">${route}</text>
    <text x="0" y="226" font-family="Arial, Helvetica, sans-serif" font-size="${invite ? 104 : 118}" font-weight="900" fill="white">${bigNumber}</text>
    <text x="6" y="274" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="900" fill="#fbe764">${headline}</text>
    <text x="6" y="334" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="900" fill="white" opacity="0.86">${user}</text>
    <text x="6" y="381" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="white" opacity="0.66">Skin: ${skin}</text>
    <rect x="0" y="410" width="545" height="58" rx="14" fill="#071018" opacity="0.68"/>
    <text x="28" y="447" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#7cf2ff">${missionText}</text>
    <text x="6" y="522" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="white" opacity="0.62">${date}</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
