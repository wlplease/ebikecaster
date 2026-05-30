import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@farcaster/quick-auth";
import { FieldValue } from "firebase-admin/firestore";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CASTER_CREDITS_CHAIN_ID || "8453");
const CONTRACT = process.env.NEXT_PUBLIC_CASTER_CREDITS_CONTRACT as `0x${string}` | undefined;
const SIGNER_KEY = process.env.REWARD_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const MAX_RIDE_CREDITS = Number(process.env.REWARD_MAX_RIDE_CREDITS || "300");
const SHARE_CREDITS = Number(process.env.REWARD_SHARE_CREDITS || "25");
const CLAIM_TTL_SECONDS = 15 * 60;

const claimRequestSchema = z.object({
  dateKey: z.string().regex(DATE_REGEX),
  kind: z.enum(["ride", "share"]).default("ride"),
  address: z.string().regex(ETH_ADDRESS_REGEX),
});

const claimTypes = {
  RewardClaim: [
    { name: "to", type: "address" },
    { name: "fid", type: "uint256" },
    { name: "dateKey", type: "bytes32" },
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

function rewardAmount(scoreData: Record<string, unknown>, kind: "ride" | "share") {
  if (kind === "share") return Math.max(1, SHARE_CREDITS);

  const score = Number(scoreData.score || 0);
  const pickups = Number(scoreData.pickups || 0);
  const boosts = Number(scoreData.boosts || 0);
  const nearMisses = Number(scoreData.nearMisses || 0);
  const hits = Number(scoreData.hits || 0);
  const cleanBonus = hits === 0 ? 40 : 0;
  const raw = Math.floor(score / 120) + pickups * 2 + boosts * 12 + nearMisses * 4 + cleanBonus;
  return Math.max(10, Math.min(MAX_RIDE_CREDITS, raw));
}

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const { allowed } = rateLimit(`castercycle-reward:${ip}`, 18, 60_000);
  if (!allowed) return json({ error: "Too many reward requests." }, 429);

  const parsed = claimRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid claim payload." }, 400);

  const auth = await verifyQuickAuth(request);
  if (!auth?.fid) return json({ error: "Farcaster authentication required." }, 401);

  if (!CONTRACT || !SIGNER_KEY) {
    return json({ ok: false, configured: false, error: "Credits contract is not configured." }, 202);
  }

  const to = parsed.data.address.toLowerCase() as `0x${string}`;
  if (auth.address && auth.address !== to) return json({ error: "Wallet does not match authenticated user." }, 403);

  try {
    const db = getAdminDb();
    const scoreRef = db.collection("castercycle-scores").doc(`${parsed.data.dateKey}:${auth.fid}`);
    const claimId = keccak256(toBytes(`castercycle:${parsed.data.kind}:${parsed.data.dateKey}:${auth.fid}`));
    const claimRef = db.collection("castercycle-reward-claims").doc(claimId);
    const existing = await claimRef.get();
    const existingClaim = existing.data()?.claim as { deadline?: number } | undefined;
    const now = Math.floor(Date.now() / 1000);
    if (existingClaim?.deadline && existingClaim.deadline > now + 30) {
      return json({ ok: true, claim: existingClaim, existing: true });
    }

    const scoreSnap = await scoreRef.get();
    if (!scoreSnap.exists) return json({ error: "Finish a verified ride before claiming credits." }, 404);

    const scoreData = scoreSnap.data() || {};
    const amount = rewardAmount(scoreData, parsed.data.kind);
    const score = Number(scoreData.score || 0);
    const dateKeyHash = keccak256(toBytes(parsed.data.dateKey));
    const deadline = now + CLAIM_TTL_SECONDS;
    const signer = privateKeyToAccount(SIGNER_KEY);

    const message = {
      to,
      fid: BigInt(auth.fid),
      dateKey: dateKeyHash,
      score: BigInt(score),
      amount: BigInt(amount),
      claimId,
      deadline: BigInt(deadline),
    };

    const signature = await signer.signTypedData({
      domain: {
        name: "CasterCycle Credits",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: CONTRACT,
      },
      types: claimTypes,
      primaryType: "RewardClaim",
      message,
    });

    const claim = {
      to,
      fid: auth.fid,
      dateKey: dateKeyHash,
      score,
      amount,
      claimId,
      deadline,
      signature,
      label: parsed.data.kind === "share" ? "Share bonus" : "Ride credits",
    };

    await claimRef.set({
      fid: auth.fid,
      dateKey: parsed.data.dateKey,
      kind: parsed.data.kind,
      address: to,
      claim,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return json({ ok: true, claim });
  } catch {
    return json({ ok: false, configured: false }, 202);
  }
}
