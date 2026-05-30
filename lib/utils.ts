import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { sdk } from "@farcaster/miniapp-sdk";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Open a URL using the Farcaster SDK — miniapp URLs use openMiniApp, others use openUrl */
/** Format a timestamp (Date, epoch ms, or Firestore Timestamp) as relative time */
export function formatTimeAgo(ts: unknown): string {
  if (!ts) return "";
  let d: Date;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "number") {
    d = new Date(ts);
  } else if (typeof ts === "string") {
    d = new Date(ts);
    if (isNaN(d.getTime())) return "";
  } else if (typeof ts === "object" && "toDate" in ts && typeof (ts as { toDate: () => Date }).toDate === "function") {
    d = (ts as { toDate: () => Date }).toDate();
  } else {
    return "";
  }
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Open a URL using the Farcaster SDK — miniapp URLs use openMiniApp, others use openUrl */
export async function openAppUrl(url: string) {
  try {
    if (url.includes("farcaster.xyz/miniapps/")) {
      await sdk.actions.openMiniApp({ url });
    } else {
      await sdk.actions.openUrl(url);
    }
  } catch {
    window.open(url, "_blank");
  }
}
