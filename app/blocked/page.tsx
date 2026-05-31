"use client";

import { useSearchParams } from "next/navigation";

export default function BlockedPage() {
  const searchParams = useSearchParams();
  const country = searchParams.get("c") || "restricted region";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#101b26",
        color: "rgba(255,255,255,0.72)",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 360, textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            backgroundColor: "#fbe764",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 28,
            fontWeight: 900,
            color: "#111923",
          }}
        >
          C
        </div>
        <h1
          style={{
            fontSize: 16,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#fbe764",
            marginBottom: 12,
          }}
        >
          Access Restricted
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          CasterCycle is not available in {country} due to sanctions or regional compliance restrictions.
        </p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
          This app does not offer gambling, custody, withdrawals, token sales, purchase-required prizes, or cash-value rewards.
        </p>
      </div>
    </div>
  );
}
