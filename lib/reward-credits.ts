export const CASTER_CREDITS_CONTRACT = process.env.NEXT_PUBLIC_CASTER_CREDITS_CONTRACT as `0x${string}` | undefined;
export const CASTER_CREDITS_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CASTER_CREDITS_CHAIN_ID || "8453");

export const CASTER_CREDITS_ABI = [
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "to", type: "address" },
      { name: "fid", type: "uint256" },
      { name: "dateKey", type: "bytes32" },
      { name: "score", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "claimId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usedClaim",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [{ name: "used", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "CreditsClaimed",
    anonymous: false,
    inputs: [
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "fid", type: "uint256" },
      { indexed: true, name: "claimId", type: "bytes32" },
      { indexed: false, name: "dateKey", type: "bytes32" },
      { indexed: false, name: "score", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

export type RewardClaimKind = "ride" | "share";

export type RewardClaimPayload = {
  to: `0x${string}`;
  fid: number;
  dateKey: `0x${string}`;
  score: number;
  amount: number;
  claimId: `0x${string}`;
  deadline: number;
  signature: `0x${string}`;
  label: string;
};
