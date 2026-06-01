import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { z } from "zod";
import { addDoc, firebaseRestConfigured, queryDocs } from "@/lib/firebase-rest";
import { fetchNeynarProfiles } from "@/lib/neynar";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const messageSchema = z.object({
  text: z.string().min(1).max(100),
  username: z.string().max(64).optional().default(""),
  displayName: z.string().max(80).optional().default(""),
  pfpUrl: z.string().url().max(500).optional().or(z.literal("")).default(""),
});

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function cleanText(text: string) {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function hasLink(text: string) {
  return /https?:\/\/|www\.|[\w-]+\.(com|net|org|xyz|app|io|gg|dev|fi|base)\b/i.test(text);
}

async function verifyQuickAuth(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return 0;

  const client = createClient();
  try {
    const payload = await client.verifyJwt({ token, domain: request.nextUrl.host });
    return typeof payload.sub === "number" ? payload.sub : Number(payload.sub || 0);
  } catch {
    return 0;
  }
}

async function readRows() {
  if (!firebaseRestConfigured()) return [];
  const snap = await queryDocs({
    collection: "castercycle-lounge-messages",
    orderField: "createdAtMs",
    limit: 30,
  });
  const rows = snap.map((doc) => {
    const data = doc.data;
    return {
      id: doc.id,
      fid: Number(data.fid || 0),
      username: String(data.username || ""),
      displayName: String(data.displayName || ""),
      pfpUrl: String(data.pfpUrl || ""),
      text: String(data.text || ""),
      createdAt: Number(data.createdAtMs || 0),
    };
  });
  const profiles = await fetchNeynarProfiles(rows.map((row) => row.fid));
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

export async function GET() {
  try {
    return json({ ok: true, rows: await readRows(), configured: firebaseRestConfigured() });
  } catch {
    return json({ ok: false, rows: [], configured: false });
  }
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const { allowed } = rateLimit(`castercycle-lounge:${ip}`, 8, 60_000);
  if (!allowed) return json({ error: "Slow down." }, 429);

  const fid = await verifyQuickAuth(request);
  if (!fid) return json({ error: "Open in Farcaster." }, 401);

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid message." }, 400);

  const text = cleanText(parsed.data.text);
  if (!text) return json({ error: "Message is empty." }, 400);
  if (hasLink(text)) return json({ error: "No links in lounge." }, 400);

  try {
    if (!firebaseRestConfigured()) return json({ ok: false, rows: [], configured: false }, 202);
    const profile = (await fetchNeynarProfiles([fid], fid)).get(fid);
    await addDoc("castercycle-lounge-messages", {
      fid,
      username: profile?.username || parsed.data.username,
      displayName: profile?.displayName || parsed.data.displayName,
      pfpUrl: profile?.pfpUrl || parsed.data.pfpUrl,
      text,
      createdAtMs: Date.now(),
    });
    return json({ ok: true, rows: await readRows() });
  } catch {
    return json({ error: "Lounge unavailable." }, 503);
  }
}
