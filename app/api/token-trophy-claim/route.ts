import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { keccak256, parseUnits, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { firebaseRestConfigured, queryDocs } from "@/lib/firebase-rest";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_TOKEN_TROPHY_CHAIN_ID || "8453");
const VAULT = process.env.NEXT_PUBLIC_TOKEN_TROPHY_VAULT as `0x${string}` | undefined;
const SIGNER_KEY = process.env.TOKEN_TROPHY_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const TOKEN_DECIMALS = Number(process.env.NEXT_PUBLIC_EBIKE_TOKEN_DECIMALS || "18");
const DAILY_AMOUNT = process.env.TOKEN_TROPHY_DAILY_AMOUNT || "1";
const WEEKLY_AMOUNT = process.env.TOKEN_TROPHY_WEEKLY_AMOUNT || "2";
const MIN_SCORE = Number(process.env.TOKEN_TROPHY_MIN_SCORE || "2500");
const CLAIM_TTL_SECONDS = 15 * 60;

const trophyRequestSchema = z.object({
  dateKey: z.string().regex(DATE_REGEX),
  period: z.enum(["daily", "weekly"]).default("daily"),
  address: z.string().regex(ETH_ADDRESS_REGEX),
});

const trophyTypes = {
  TokenTrophyClaim: [
    { name: "to", type: "address" },
    { name: "fid", type: "uint256" },
    { name: "periodKey", type: "bytes32" },
    { name: "score", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "claimId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
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

async function verifyQuickAuth(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  const client = createClient();
  try {
    const payload = await client.verifyJwt({ token, domain: request.nextUrl.host });
    const claims = payload as typeof payload & Record<string, unknown>;
    const fid = typeof payload.sub === "number" ? payload.sub : Number(payload.sub || 0);
    const rawAddress =
      typeof claims.address === "string"
        ? claims.address
        : typeof claims.walletAddress === "string"
          ? claims.walletAddress
          : "";
    const address = ETH_ADDRESS_REGEX.test(rawAddress) ? rawAddress.toLowerCase() : "";
    return { fid, address };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const { allowed } = rateLimit(`castercycle-token-trophy:${ip}`, 10, 60_000);
  if (!allowed) return json({ error: "Too many trophy checks." }, 429);

  const parsed = trophyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid trophy payload." }, 400);

  const auth = await verifyQuickAuth(request);
  if (!auth?.fid) return json({ error: "Farcaster authentication required." }, 401);

  if (!VAULT || !SIGNER_KEY) {
    return json({ ok: false, configured: false, error: "Token trophy vault is not configured." }, 202);
  }

  const to = parsed.data.address.toLowerCase() as `0x${string}`;
  if (auth.address && auth.address !== to) return json({ error: "Wallet does not match authenticated user." }, 403);

  const today = utcDateKey(0);
  if (parsed.data.dateKey >= today) {
    return json({ error: "Trophies open after the leaderboard closes." }, 400);
  }

  const weekKey = weekKeyFromDateKey(parsed.data.dateKey);
  if (parsed.data.period === "weekly" && weekKey === weekKeyFromDateKey(today)) {
    return json({ error: "Weekly trophies open after the week closes." }, 400);
  }

  try {
    if (!firebaseRestConfigured()) {
      return json({ ok: false, configured: false, error: "Firebase client config is not set." }, 202);
    }

    const collection = parsed.data.period === "weekly" ? "castercycle-weekly-scores" : "castercycle-scores";
    const keyField = parsed.data.period === "weekly" ? "weekKey" : "dateKey";
    const keyValue = parsed.data.period === "weekly" ? weekKey : parsed.data.dateKey;
    const snap = await queryDocs({
      collection,
      whereField: keyField,
      whereValue: keyValue,
      orderField: "score",
      limit: 25,
    });
    const winner = snap
      .map((doc) => doc.data)
      .filter((row) => String(row.mode || "dash") === "dash")
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

    if (!winner) return json({ error: "No closed Daily Dash trophy yet." }, 404);
    if (Number(winner.fid || 0) !== auth.fid) return json({ error: "This trophy belongs to the closed-board winner." }, 403);

    const score = Number(winner.score || 0);
    if (score < MIN_SCORE) return json({ error: "Winning score is below the trophy threshold." }, 403);

    const periodKeyText = parsed.data.period === "weekly" ? weekKey : parsed.data.dateKey;
    const periodKey = keccak256(toBytes(periodKeyText));
    const claimId = keccak256(toBytes(`castercycle:token-trophy:${parsed.data.period}:${periodKeyText}:${auth.fid}`));
    const amount = parseUnits(parsed.data.period === "weekly" ? WEEKLY_AMOUNT : DAILY_AMOUNT, Number.isFinite(TOKEN_DECIMALS) ? TOKEN_DECIMALS : 18);
    const now = Math.floor(Date.now() / 1000);
    const deadline = now + CLAIM_TTL_SECONDS;
    const signer = privateKeyToAccount(SIGNER_KEY);

    const message = {
      to,
      fid: BigInt(auth.fid),
      periodKey,
      score: BigInt(score),
      amount,
      claimId,
      deadline: BigInt(deadline),
    };

    const signature = await signer.signTypedData({
      domain: {
        name: "CasterCycle Token Trophies",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: VAULT,
      },
      types: trophyTypes,
      primaryType: "TokenTrophyClaim",
      message,
    });

    return json({
      ok: true,
      claim: {
        to,
        fid: auth.fid,
        periodKey,
        score,
        amount: amount.toString(),
        claimId,
        deadline,
        signature,
        label: parsed.data.period === "weekly" ? "Weekly winner trophy" : "Daily winner trophy",
      },
    });
  } catch {
    return json({ ok: false, configured: false }, 202);
  }
}
