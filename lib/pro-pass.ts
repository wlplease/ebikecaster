import { useReadContract } from "wagmi";

const DEFAULT_PRO_PASS_CONTRACT = "0xa6c2e5ea11923f44839412d1f36026fb2f5af014";

export const PRO_PASS_CONTRACT = (process.env.NEXT_PUBLIC_PRO_PASS_CONTRACT || DEFAULT_PRO_PASS_CONTRACT) as `0x${string}`;
export const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

export const WEEKLY_PRICE = 1_000_000;
export const YEARLY_PRICE = 7_000_000;

export const PRO_PASS_ABI = [
  {
    type: "function",
    name: "buyWeekly",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isActive",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "expiresAt",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalPasses",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalRevenue",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

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
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function useProStatus(address?: string) {
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

  return {
    isPro: isActiveData === true,
    expiresAt: expiresAtData ? Number(expiresAtData) : 0,
    loading: loadingActive || loadingExpiry,
    isTrial: false,
    isLegacy: false,
  };
}

export function useProContractStats() {
  const { data: totalPasses, isLoading: loadingPasses } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "totalPasses",
    query: { refetchInterval: false },
  });

  const { data: totalRevenue, isLoading: loadingRevenue } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "totalRevenue",
    query: { refetchInterval: false },
  });

  return {
    totalSubscribers: totalPasses ? Number(totalPasses) : 0,
    totalRevenue: totalRevenue ? Number(totalRevenue) : 0,
    loading: loadingPasses || loadingRevenue,
  };
}

export function formatProExpiry(timestamp: number): string {
  if (!timestamp) return "Not active";
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h`;
  return `Expires in ${Math.max(1, Math.floor(diff / 60))}m`;
}
