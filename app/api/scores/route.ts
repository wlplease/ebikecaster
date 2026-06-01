import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { z } from "zod";
import { firebaseRestConfigured, getDoc, queryDocs, setDoc } from "@/lib/firebase-rest";
import { fetchNeynarProfiles } from "@/lib/neynar";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ROUTE_NAMES = ["Community Park", "State Park", "E-Bike Land", "Freestyle Park"];
const SCORE_MODES = ["dash", "freestyle"] as const;

const scoreSchema = z.object({
  dateKey: z.string().regex(DATE_REGEX),
  routeName: z.string().min(1).max(64),
  score: z.number().int().min(0).max(100000),
  distance: z.number().int().min(0).max(20000),
  battery: z.number().int().min(0).max(100),
  pickups: z.number().int().min(0).max(100),
  hits: z.number().int().min(0).max(100),
  boosts: z.number().int().min(0).max(100),
  nearMisses: z.number().int().min(0).max(100),
  skin: z.string().min(1).max(32),
  fid: z.number().int().min(0).max(10_000_000),
  username: z.string().max(64).optional().default(""),
  displayName: z.string().max(80).optional().default(""),
  pfpUrl: z.string().url().max(500).optional().or(z.literal("")).default(""),
  address: z.string().regex(ETH_ADDRESS_REGEX).optional().or(z.literal("")).default(""),
  mode: z.enum(SCORE_MODES).optional().default("dash"),
});

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function utcDateKey(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function weekKeyFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function validDateKey(dateKey: string) {
  return [utcDateKey(-1), utcDateKey(0), utcDateKey(1)].includes(dateKey);
}

function expectedRoute(routeName: string) {
  return ROUTE_NAMES.includes(routeName);
}

function plausibleScore(payload: z.infer<typeof scoreSchema>) {
  if (payload.mode === "freestyle") {
    const ceiling = Math.round(payload.distance * 0.28 + payload.pickups * 420 + payload.boosts * 260 + 2200);
    return payload.score <= ceiling;
  }
  const ceiling = Math.round(
    payload.distance * 0.96 +
      payload.pickups * 270 +
      payload.boosts * 380 +
      payload.nearMisses * 180 +
      Math.max(0, 20 - payload.hits) * 90 +
      payload.battery * 22 +
      1800,
  );
  return payload.score <= ceiling;
}

async function verifyQuickAuth(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  const domain = request.nextUrl.host;
  const client = createClient();
  try {
    const payload = await client.verifyJwt({ token, domain });
    const claims = payload as typeof payload & Record<string, unknown>;
    const sub = typeof payload.sub === "number" ? payload.sub : Number(payload.sub || 0);
    const rawAddress =
      typeof claims.address === "string"
        ? claims.address
        : typeof claims.walletAddress === "string"
          ? claims.walletAddress
          : "";
    const address = ETH_ADDRESS_REGEX.test(rawAddress) ? rawAddress.toLowerCase() : "";
    return { fid: sub, address };
  } catch {
    return null;
  }
}

async function followingFids(fid: number) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey || fid <= 0) return null;

  const url = new URL("https://api.neynar.com/v2/farcaster/following/");
  url.searchParams.set("fid", String(fid));
  url.searchParams.set("viewer_fid", String(fid));
  url.searchParams.set("limit", "100");

  const res = await fetch(url, {
    headers: { "x-api-key": apiKey, "x-neynar-experimental": "true" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const fids = new Set<number>([fid]);
  for (const item of data.users || []) {
    const nextFid = Number(item?.user?.fid || 0);
    if (nextFid > 0) fids.add(nextFid);
  }
  return fids;
}

async function enrichProfiles<T extends { fid: number; username: string; displayName: string; pfpUrl: string }>(rows: T[], viewerFid = 0) {
  const profiles = await fetchNeynarProfiles(rows.map((row) => row.fid), viewerFid);
  if (profiles.size === 0) return rows;
  return rows.map((row) => {
    const profile = profiles.get(row.fid);
    if (!profile) return row;
    return {
      ...row,
      username: profile.username || row.username,
      displayName: profile.displayName || row.displayName,
      pfpUrl: profile.pfpUrl || row.pfpUrl,
    };
  });
}

export async function GET(request: NextRequest) {
  const dateKey = request.nextUrl.searchParams.get("dateKey") || "";
  const scope = request.nextUrl.searchParams.get("scope") === "friends" ? "friends" : "global";
  const period = request.nextUrl.searchParams.get("period") === "weekly" ? "weekly" : "daily";
  const fid = Number(request.nextUrl.searchParams.get("fid") || "0");
  const compact = request.nextUrl.searchParams.get("compact") === "1";
  const mode = request.nextUrl.searchParams.get("mode") === "freestyle" ? "freestyle" : "dash";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || "");
  const resultLimit = Number.isFinite(requestedLimit) ? Math.min(25, Math.max(3, Math.floor(requestedLimit))) : 25;

  if (!DATE_REGEX.test(dateKey)) {
    return json({ error: "Invalid date." }, 400);
  }

  try {
    if (!firebaseRestConfigured()) return json({ ok: false, rows: [], configured: false });
    const weekKey = weekKeyFromDateKey(dateKey);
    const collection = period === "weekly" ? "castercycle-weekly-scores" : "castercycle-scores";
    const keyField = period === "weekly" ? "weekKey" : "dateKey";
    const keyValue = period === "weekly" ? weekKey : dateKey;
    const snap = await queryDocs({
      collection,
      whereField: keyField,
      whereValue: keyValue,
      orderField: "score",
      limit: scope === "friends" || mode === "freestyle" ? Math.max(25, resultLimit * 4) : resultLimit,
    });

    let rows = snap.map((doc) => {
      const data = doc.data;
      return {
        fid: Number(data.fid || 0),
        username: String(data.username || ""),
        displayName: String(data.displayName || ""),
        pfpUrl: String(data.pfpUrl || ""),
        score: Number(data.score || 0),
        dailyScore: period === "daily" ? Number(data.score || 0) : 0,
        weeklyScore: period === "weekly" ? Number(data.score || 0) : 0,
        routeName: String(data.routeName || data.bestRouteName || ""),
        bestDateKey: String(data.bestDateKey || data.dateKey || ""),
        skin: String(data.skin || "signal"),
        mode: String(data.mode || (String(data.routeName || data.bestRouteName || "") === "Freestyle Park" ? "freestyle" : "dash")),
      };
    }).filter((row) => row.mode === mode);

    if (scope === "friends") {
      const fids = await followingFids(fid);
      rows = fids ? rows.filter((row) => fids.has(row.fid)).slice(0, resultLimit) : rows.slice(0, resultLimit);
    }

    rows = await enrichProfiles(rows, fid);

    if (compact) {
      return json({ ok: true, rows, scope, period, weekKey, compact: true, friendsResolved: scope === "friends" && !!process.env.NEYNAR_API_KEY });
    }

    const counterDocs = await Promise.all(
      rows.map((row) =>
        getDoc(
          period === "weekly" ? "castercycle-scores" : "castercycle-weekly-scores",
          period === "weekly"
            ? `${dateKey}${mode === "freestyle" ? ":freestyle" : ""}:${row.fid}`
            : `${weekKey}${mode === "freestyle" ? ":freestyle" : ""}:${row.fid}`,
        ),
      ),
    );
    rows = rows.map((row, index) => {
      const score = Number(counterDocs[index]?.data?.score || 0);
      return period === "weekly" ? { ...row, dailyScore: score } : { ...row, weeklyScore: score };
    });

    return json({ ok: true, rows, scope, period, weekKey, friendsResolved: scope === "friends" && !!process.env.NEYNAR_API_KEY });
  } catch {
    return json({ ok: false, rows: [], configured: false });
  }
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const { allowed } = rateLimit(`castercycle-score:${ip}`, 20, 60_000);
  if (!allowed) return json({ error: "Too many score submissions." }, 429);

  const parsed = scoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid score payload." }, 400);

  const auth = await verifyQuickAuth(request);
  const payload = parsed.data;
  const verifiedFid = auth?.fid && auth.fid > 0 ? auth.fid : 0;
  if (!verifiedFid) return json({ error: "Farcaster authentication required." }, 401);
  if (!validDateKey(payload.dateKey)) return json({ error: "Score date is not active." }, 400);
  if (!expectedRoute(payload.routeName)) return json({ error: "Route mismatch." }, 400);
  if (!plausibleScore(payload)) return json({ error: "Score failed validation." }, 400);

  const fid = verifiedFid;
  const address = (auth?.address || payload.address || "").toLowerCase();

  if (payload.fid && payload.fid !== verifiedFid) {
    return json({ error: "FID does not match authenticated user." }, 403);
  }

  try {
    if (!firebaseRestConfigured()) return json({ ok: false, configured: false }, 202);
    const modePrefix = payload.mode === "freestyle" ? ":freestyle" : "";
    const docId = `${payload.dateKey}${modePrefix}:${fid}`;
    const weekKey = weekKeyFromDateKey(payload.dateKey);
    const weeklyId = `${weekKey}${modePrefix}:${fid}`;
    const [existing, existingWeekly] = await Promise.all([
      getDoc("castercycle-scores", docId),
      getDoc("castercycle-weekly-scores", weeklyId),
    ]);
    const previousScore = Number(existing?.data?.score || 0);
    const previousWeeklyScore = Number(existingWeekly?.data?.score || 0);
    const now = Date.now();
    const neynarProfile = (await fetchNeynarProfiles([fid], fid)).get(fid);
    const profile = {
      fid,
      username: neynarProfile?.username || payload.username,
      displayName: neynarProfile?.displayName || payload.displayName,
      pfpUrl: neynarProfile?.pfpUrl || payload.pfpUrl,
      address,
      verified: !!verifiedFid,
    };

    if (!existing || previousScore <= payload.score) {
      await setDoc("castercycle-scores", docId, {
        ...payload,
        ...profile,
        updatedAtMs: now,
        createdAtMs: Number(existing?.data?.createdAtMs || now),
      });
    }

    if (!existingWeekly || previousWeeklyScore <= payload.score) {
      await setDoc("castercycle-weekly-scores", weeklyId, {
        ...profile,
        weekKey,
        score: payload.score,
        mode: payload.mode,
        bestDateKey: payload.dateKey,
        bestRouteName: payload.routeName,
        skin: payload.skin,
        pickups: payload.pickups,
        hits: payload.hits,
        boosts: payload.boosts,
        nearMisses: payload.nearMisses,
        battery: payload.battery,
        distance: payload.distance,
        updatedAtMs: now,
        createdAtMs: Number(existingWeekly?.data?.createdAtMs || now),
      });
    }

    return json({ ok: true, verified: !!verifiedFid, weekKey });
  } catch {
    return json({ ok: false, configured: false }, 202);
  }
}
