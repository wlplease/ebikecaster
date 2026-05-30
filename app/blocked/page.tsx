"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function BlockedPage() {
  const searchParams = useSearchParams();
  const country = searchParams.get("c") || "??";

  // Log blocked attempt to Firebase (fire-and-forget)
  useEffect(() => {
    import("@/lib/firebase").then(({ db, doc, setDoc, serverTimestamp, increment }) => {
      const id = `${country}-${Date.now()}`;
      const ref = doc(db, "nshell-blocked", id);
      setDoc(ref, {
        country,
        timestamp: serverTimestamp(),
        userAgent: navigator.userAgent || "",
      }).catch(() => {});

      // Also update a counter doc per country
      const countRef = doc(db, "nshell-blocked", `count-${country}`);
      setDoc(countRef, {
        country,
        count: increment(1),
        lastAttempt: serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }).catch(() => {});
  }, [country]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0a0a",
        color: "#a1a1aa",
        fontFamily: "monospace",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 360, textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: "#F7931A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 28,
            fontWeight: 900,
            color: "#fff",
          }}
        >
          N
        </div>
        <h1
          style={{
            fontSize: 16,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#F7931A",
            marginBottom: 12,
          }}
        >
          Access Restricted
        </h1>
        <p style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          nshell is not available in your region due to regulatory restrictions.
        </p>
        <p style={{ fontSize: 10, color: "#52525b" }}>
          This application complies with applicable sanctions regulations and cannot
          be accessed from certain jurisdictions.
        </p>
      </div>
    </div>
  );
}
