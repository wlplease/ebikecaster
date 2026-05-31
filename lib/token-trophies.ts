export const TOKEN_TROPHY_VAULT = process.env.NEXT_PUBLIC_TOKEN_TROPHY_VAULT as `0x${string}` | undefined;
export const TOKEN_TROPHY_CHAIN_ID = Number(process.env.NEXT_PUBLIC_TOKEN_TROPHY_CHAIN_ID || "8453");

export const TOKEN_TROPHY_ABI = [
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "to", type: "address" },
      { name: "fid", type: "uint256" },
      { name: "periodKey", type: "bytes32" },
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
    name: "usedClaim",
    inputs: [{ name: "claimId", type: "bytes32" }],
    outputs: [{ name: "used", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "TokenTrophyClaimed",
    anonymous: false,
    inputs: [
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "fid", type: "uint256" },
      { indexed: true, name: "claimId", type: "bytes32" },
      { indexed: false, name: "periodKey", type: "bytes32" },
      { indexed: false, name: "score", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

export type TokenTrophyPeriod = "daily" | "weekly";

export type TokenTrophyClaimPayload = {
  to: `0x${string}`;
  fid: number;
  periodKey: `0x${string}`;
  score: number;
  amount: string;
  claimId: `0x${string}`;
  deadline: number;
  signature: `0x${string}`;
  label: string;
};
