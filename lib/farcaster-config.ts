import { Buffer } from "node:buffer";

export type AccountAssociation = {
  header: string;
  payload: string;
  signature: string;
};

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://castercycle.vercel.app";

const CASTER_CYCLE_ACCOUNT_ASSOCIATION: AccountAssociation = {
  header: "eyJmaWQiOjEwNTkwNzUsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg3NmJDNzVFZjJGMWYwRjI1ZTA3ODY0MTkxMEQ4RTIzQTQzMDIwNEY1In0",
  payload: "eyJkb21haW4iOiJjYXN0ZXJjeWNsZS52ZXJjZWwuYXBwIn0",
  signature: "boulOy0OdjQHe1jiMb0bAzbg4daYKAZoBkZmiTjmmIgccXjBqxR0iB/KsFnjIoPkHsuxOsRya6iu2Wk+wfp2rxs=",
};

function appHost(appUrl: string) {
  try {
    return new URL(appUrl).hostname.toLowerCase();
  } catch {
    return "castercycle.vercel.app";
  }
}

function associationDomain(payload: string) {
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { domain?: unknown };
    return typeof decoded.domain === "string" ? decoded.domain.toLowerCase() : "";
  } catch {
    return "";
  }
}

export function appUrl(path = "/") {
  return new URL(path, APP_URL).toString();
}

export function getAccountAssociation(appUrlValue = APP_URL): AccountAssociation | null {
  const host = appHost(appUrlValue);
  const fallback = host === "castercycle.vercel.app" ? CASTER_CYCLE_ACCOUNT_ASSOCIATION : null;
  const association = {
    header: process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || fallback?.header || "",
    payload: process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || fallback?.payload || "",
    signature: process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || fallback?.signature || "",
  };

  if (!association.header || !association.payload || !association.signature) return null;
  if (associationDomain(association.payload) !== host) return null;
  return association;
}
