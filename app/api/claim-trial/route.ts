import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ETH_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/;
const TRIAL_DAYS = 1;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Strict rate limit — 3 attempts per hour per IP
  const { allowed } = rateLimit(`claim-trial:${ip}`, 3, 3_600_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const address = typeof body.address === "string" ? body.address.toLowerCase() : "";
    const username = typeof body.username === "string" ? body.username : "";
    const fid = typeof body.fid === "number" ? body.fid : 0;

    if (!ETH_ADDRESS_REGEX.test(address)) {
      return NextResponse.json({ error: "Invalid address." }, { status: 400 });
    }

    const db = getAdminDb();
    const { FieldValue } = await import("firebase-admin/firestore");

    const trialRef = db.collection("nshell-pro-trials").doc(address);
    const claimedRef = db.collection("nshell-trial-claims").doc(address);

    // Use transaction to prevent race condition (two simultaneous claims both succeeding)
    const expiresAt = await db.runTransaction(async (txn) => {
      const trialDoc = await txn.get(trialRef);
      if (trialDoc.exists) throw new Error("Trial already used.");

      const claimedDoc = await txn.get(claimedRef);
      if (claimedDoc.exists) throw new Error("Trial already used.");

      const expires = Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000;

      txn.set(trialRef, {
        address,
        username,
        fid,
        expiresAt: expires,
        days: TRIAL_DAYS,
        source: "auto-trial",
        grantedAt: FieldValue.serverTimestamp(),
      });

      txn.set(claimedRef, {
        address,
        claimedAt: FieldValue.serverTimestamp(),
      });

      return expires;
    });

    return NextResponse.json({ ok: true, expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error.";
    if (message.includes("already")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[claim-trial] Error:", message);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
