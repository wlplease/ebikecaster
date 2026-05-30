import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ROUTE_NAMES = ["Neon Bike Lane", "Solar Pier", "Market Loop", "Rainline Express", "Hilltop Circuit"];

const scoreSchema = z.object({
  dateKey: z.string().regex(DATE_REGEX),
  routeName: z.string().min(1).max(64),
  score: z.number().int().min(0).max(25000),
  distance: z.number().int().min(0).max(10000),
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

function dateSeed(key: string) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function utcDateKey(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function validDateKey(dateKey: string) {
  return [utcDateKey(-1), utcDateKey(0), utcDateKey(1)].includes(dateKey);
}

function expectedRoute(dateKey: string) {
  return ROUTE_NAMES[dateSeed(dateKey) % ROUTE_NAMES.length];
}

function plausibleScore(payload: z.infer<typeof scoreSchema>) {
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
    const sub = typeof payload.sub === "number" ? payload.sub : Number(payload.sub || 0);
    const address = typeof payload.address === "string" ? payload.address.toLowerCase() : "";
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

export async function GET(request: NextRequest) {
  const dateKey = request.nextUrl.searchParams.get("dateKey") || "";
  const scope = request.nextUrl.searchParams.get("scope") === "friends" ? "friends" : "global";
  const fid = Number(request.nextUrl.searchParams.get("fid") || "0");

  if (!DATE_REGEX.test(dateKey)) {
    return json({ error: "Invalid date." }, 400);
  }

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("voltlane-scores")
      .where("dateKey", "==", dateKey)
      .orderBy("score", "desc")
      .limit(scope === "friends" ? 100 : 25)
      .get();

    let rows = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        fid: Number(data.fid || 0),
        username: String(data.username || ""),
        displayName: String(data.displayName || ""),
        pfpUrl: String(data.pfpUrl || ""),
        score: Number(data.score || 0),
        routeName: String(data.routeName || ""),
        skin: String(data.skin || "volt"),
      };
    });

    if (scope === "friends") {
      const fids = await followingFids(fid);
      if (fids) rows = rows.filter((row) => fids.has(row.fid)).slice(0, 25);
    }

    return json({ ok: true, rows, scope, friendsResolved: scope === "friends" && !!process.env.NEYNAR_API_KEY });
  } catch {
    return json({ ok: false, rows: [], configured: false });
  }
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const { allowed } = rateLimit(`voltlane-score:${ip}`, 20, 60_000);
  if (!allowed) return json({ error: "Too many score submissions." }, 429);

  const parsed = scoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid score payload." }, 400);

  const auth = await verifyQuickAuth(request);
  const payload = parsed.data;
  const verifiedFid = auth?.fid && auth.fid > 0 ? auth.fid : 0;
  if (!verifiedFid) return json({ error: "Farcaster authentication required." }, 401);
  if (!validDateKey(payload.dateKey)) return json({ error: "Score date is not active." }, 400);
  if (payload.routeName !== expectedRoute(payload.dateKey)) return json({ error: "Route mismatch." }, 400);
  if (!plausibleScore(payload)) return json({ error: "Score failed validation." }, 400);

  const fid = verifiedFid;
  const address = (auth?.address || payload.address || "").toLowerCase();

  if (payload.fid && payload.fid !== verifiedFid) {
    return json({ error: "FID does not match authenticated user." }, 403);
  }

  try {
    const db = getAdminDb();
    const docId = `${payload.dateKey}:${fid}`;
    const ref = db.collection("voltlane-scores").doc(docId);
    await db.runTransaction(async (txn) => {
      const existing = await txn.get(ref);
      const previousScore = existing.exists ? Number(existing.data()?.score || 0) : 0;
      if (existing.exists && previousScore > payload.score) return;

      txn.set(ref, {
        ...payload,
        fid,
        address,
        verified: !!verifiedFid,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: existing.exists ? existing.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return json({ ok: true, verified: !!verifiedFid });
  } catch {
    return json({ ok: false, configured: false }, 202);
  }
}
