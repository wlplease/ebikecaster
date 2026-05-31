import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Sanctions/compliance restricted countries and regions. Keep this conservative for token features.
const BLOCKED_COUNTRIES = new Set([
  "CU", "IR", "KP", "SY", "RU", "BY", "MM", "SD", "SS",
  "CF", "CD", "LY", "SO", "YE", "ZW", "NI", "VE",
]);

const BLOCKED_US_REGIONS = new Set(["NY"]);
const BLOCKED_UA_REGIONS = new Set(["09", "14", "23", "43", "65"]);

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === "/blocked") {
    return NextResponse.next();
  }

  const country = (request.headers.get("x-vercel-ip-country") || "").toUpperCase();
  const region = (request.headers.get("x-vercel-ip-country-region") || "").toUpperCase();

  const isBlockedCountry = country && BLOCKED_COUNTRIES.has(country);
  const isBlockedState = country === "US" && region && BLOCKED_US_REGIONS.has(region);
  const isBlockedUkraineRegion = country === "UA" && region && BLOCKED_UA_REGIONS.has(region);

  if (isBlockedCountry || isBlockedState || isBlockedUkraineRegion) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(NextResponse.json({ error: "Region restricted." }, { status: 451 }));
    }
    const blockedUrl = new URL("/blocked", request.url);
    blockedUrl.searchParams.set("c", isBlockedState ? `US-${region}` : isBlockedUkraineRegion ? `UA-${region}` : country);
    return applySecurityHeaders(NextResponse.rewrite(blockedUrl));
  }

  const response = NextResponse.next();

  applySecurityHeaders(response);
  const scriptSrc = process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https://auth.farcaster.xyz https://*.neynar.com https://*.base.org https://*.alchemy.com; frame-src 'self' https://*.farcaster.xyz; frame-ancestors 'self' https://*.farcaster.xyz https://farcaster.xyz;`,
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|media|\\.well-known).*)",
  ],
};
