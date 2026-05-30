// CasterCycle - Daily and weekly access passes (USDC on Base)

import { useReadContract } from "wagmi";

// ── Contract Addresses ──

/** CasterCycle pass contract on Base (daily/weekly pass system) */
export const PRO_PASS_CONTRACT = "0xa6c2e5ea11923f44839412d1f36026fb2f5af014" as `0x${string}`;

/** Legacy ProPass contract — grandfathered monthly subscribers */
export const LEGACY_PRO_PASS_CONTRACT = "0xF0C00Cf590081A788EE1C24A88565e9F196F7549" as `0x${string}`;

/** Base USDC (6 decimals) */
export const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

// ── Pricing (USDC 6 decimals) ──

/** Daily pass price: $0.50 = 500,000 */
export const DAILY_PRICE = 500_000;

/** Weekly pass price: $2.00 = 2,000,000 */
export const WEEKLY_PRICE = 2_000_000;

// CasterCycle pass ABI

export const PRO_PASS_ABI = [
  // Constructor
  {
    type: "constructor",
    inputs: [
      { name: "_usdc", type: "address" },
      { name: "_dailyPrice", type: "uint256" },
      { name: "_weeklyPrice", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  // Errors
  { type: "error", name: "AlreadyPending", inputs: [] },
  { type: "error", name: "Banned", inputs: [] },
  { type: "error", name: "InvalidDuration", inputs: [] },
  { type: "error", name: "NotGuardian", inputs: [] },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "Paused", inputs: [] },
  { type: "error", name: "ReentrantCall", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  // Events
  {
    type: "event", anonymous: false, name: "PassPurchased",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "duration", type: "uint256" },
      { indexed: false, name: "price", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint256" },
    ],
  },
  {
    type: "event", anonymous: false, name: "PassGranted",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "duration", type: "uint256" },
      { indexed: false, name: "expiresAt", type: "uint256" },
    ],
  },
  {
    type: "event", anonymous: false, name: "PassRevoked",
    inputs: [{ indexed: true, name: "user", type: "address" }],
  },
  {
    type: "event", anonymous: false, name: "PriceUpdated",
    inputs: [
      { indexed: false, name: "dailyPrice", type: "uint256" },
      { indexed: false, name: "weeklyPrice", type: "uint256" },
    ],
  },
  {
    type: "event", anonymous: false, name: "BanUpdated",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "isBanned", type: "bool" },
    ],
  },
  {
    type: "event", anonymous: false, name: "OwnershipTransferred",
    inputs: [
      { indexed: true, name: "prev", type: "address" },
      { indexed: true, name: "next_", type: "address" },
    ],
  },
  {
    type: "event", anonymous: false, name: "PauseToggled",
    inputs: [{ indexed: false, name: "isPaused", type: "bool" }],
  },
  {
    type: "event", anonymous: false, name: "Withdrawal",
    inputs: [
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  // User functions
  {
    type: "function", name: "buyDaily", inputs: [], outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "buyWeekly", inputs: [], outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "isActive",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "timeLeft",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "expiresAt",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "banned",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  // Read-only state
  {
    type: "function", name: "dailyPrice", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "weeklyPrice", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "DAILY_DURATION", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "WEEKLY_DURATION", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "totalPasses", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "totalRevenue", inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "paused", inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "owner", inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "pendingOwner", inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "guardian", inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "usdc", inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // Owner functions
  {
    type: "function", name: "setPrices",
    inputs: [
      { name: "_dailyPrice", type: "uint256" },
      { name: "_weeklyPrice", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "grantPass",
    inputs: [
      { name: "account", type: "address" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "batchGrantPass",
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "revokePass",
    inputs: [{ name: "account", type: "address" }],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "setBan",
    inputs: [
      { name: "account", type: "address" },
      { name: "isBanned", type: "bool" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "batchSetBan",
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "isBanned", type: "bool" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "withdraw",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "withdrawAll",
    inputs: [], outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "togglePause",
    inputs: [], outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "acceptOwnership",
    inputs: [], outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "setGuardian",
    inputs: [{ name: "newGuardian", type: "address" }],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "emergencyRecoverToken",
    inputs: [
      { name: "token_", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
] as const;

// ── Legacy ProPass ABI (minimal — just isActive + expiresAt for grandfathered checks) ──

export const LEGACY_PRO_PASS_ABI = [
  {
    type: "function", name: "isActive",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "expiresAt",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── USDC ABI (minimal) ──

export const USDC_ABI = [
  {
    type: "function", name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── Hook: useProStatus ──
// Checks BOTH the current CasterCycle pass and legacy ProPass for grandfathered subscribers.

export function useProStatus(address?: string) {
  // Current CasterCycle pass contract.
  const { data: isActiveData, isLoading: loadingActive } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "isActive",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: false },
  });

  const { data: expiresAtData, isLoading: loadingExpiry } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "expiresAt",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: false },
  });

  // Legacy contract: grandfathered monthly subscribers
  const { data: legacyActiveData, isLoading: loadingLegacy } = useReadContract({
    address: LEGACY_PRO_PASS_CONTRACT,
    abi: LEGACY_PRO_PASS_ABI,
    functionName: "isActive",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: false },
  });

  const { data: legacyExpiryData } = useReadContract({
    address: LEGACY_PRO_PASS_CONTRACT,
    abi: LEGACY_PRO_PASS_ABI,
    functionName: "expiresAt",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: false },
  });

  const newContractPro = isActiveData === true;
  const newContractExpiry = expiresAtData ? Number(expiresAtData) : 0;
  const legacyPro = legacyActiveData === true;
  const legacyExpiry = legacyExpiryData ? Number(legacyExpiryData) : 0;

  const isPro = newContractPro || legacyPro;

  // Use the latest expiry from whichever source is active
  const expiry = newContractPro
    ? newContractExpiry
    : legacyPro
      ? legacyExpiry
      : 0;

  return {
    isPro,
    expiresAt: expiry,
    loading: loadingActive || loadingExpiry || loadingLegacy,
    isTrial: false,
    isLegacy: legacyPro && !newContractPro,
  };
}

// ── Hook: useProContractStats ──

export function useProContractStats() {
  const { data: totalPasses, isLoading: loadingSubs } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "totalPasses",
    query: { refetchInterval: false },
  });

  const { data: totalRevenue, isLoading: loadingRev } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "totalRevenue",
    query: { refetchInterval: false },
  });

  return {
    totalSubscribers: totalPasses ? Number(totalPasses) : 0,
    totalRevenue: totalRevenue ? Number(totalRevenue) : 0,
    loading: loadingSubs || loadingRev,
  };
}

// ── Helpers ──

export function formatProExpiry(timestamp: number): string {
  if (!timestamp || timestamp === 0) return "Not subscribed";
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h`;
  const mins = Math.floor(diff / 60);
  return `Expires in ${mins}m`;
}
