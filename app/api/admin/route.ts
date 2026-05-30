import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { rateLimit } from "@/lib/rate-limit";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type AdminAction = "grantProTrial" | "revokeProTrial";

function validateAddress(addr: unknown): string | null {
  if (typeof addr !== "string") return null;
  const lower = addr.toLowerCase();
  return ETH_ADDRESS_REGEX.test(lower) ? lower : null;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { allowed, retryAfterSeconds } = rateLimit(`admin:${ip}`, 20, 300_000);
  if (!allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${retryAfterSeconds}s.` },
      { status: 429 }
    );
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let body: { password?: string; action?: string; data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { password, action, data } = body;

  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pwBuf = Buffer.from(password);
  const expectedBuf = Buffer.from(adminPassword);
  if (pwBuf.length !== expectedBuf.length || !timingSafeEqual(pwBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    switch (action as AdminAction) {
      case "grantProTrial": {
        const address = validateAddress(data?.address);
        if (!address) {
          return NextResponse.json({ error: "Invalid address" }, { status: 400 });
        }
        const days = Math.min(Math.max(Math.round(Number(data?.days) || 7), 1), 365);
        const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
        await db.collection("nshell-pro-trials").doc(address).set({
          address,
          username: (data?.username as string) || "",
          fid: (data?.fid as number) || 0,
          expiresAt,
          days,
          grantedAt: FieldValue.serverTimestamp(),
          grantedBy: "admin",
        });
        return NextResponse.json({ ok: true, expiresAt });
      }

      case "revokeProTrial": {
        const address = validateAddress(data?.address);
        if (!address) {
          return NextResponse.json({ error: "Invalid address" }, { status: 400 });
        }
        await db.collection("nshell-pro-trials").doc(address).delete();
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[admin] API error:", action, err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
