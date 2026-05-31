export const BASE_CHAIN_ID = 8453;
export const TREASURY_ADDRESS =
  (process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "0x76bC75Ef2F1f0F25e078641910D8E23A430204F5") as `0x${string}`;

export const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
export const DAY_PRICE = 1_000_000;
export const YEARLY_PRICE = 7_000_000;
export const ETH_SUPPORT_AMOUNT = "0.0003";

export const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function formatPassExpiry(timestamp: number): string {
  if (!timestamp) return "Cycle Pass";
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;
  if (diff <= 0) return "Cycle Pass";
  if (diff > 5 * 365 * 86400) return "Lifetime Pass";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `Pass ${days}d ${hours}h`;
  if (hours > 0) return `Pass ${hours}h`;
  return `Pass ${Math.max(1, Math.floor(diff / 60))}m`;
}
