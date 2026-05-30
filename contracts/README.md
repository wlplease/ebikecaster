# CasterCycle Credits

This folder contains the optional Base gameplay-credit contract for CasterCycle.

## Design

- `CasterCycleCredits.sol` is an ERC-20-style token with `decimals() = 0`.
- Credits are non-transferable: users can receive or burn them, but cannot sell or send them.
- There is no cash redemption, no prize pool, no random reward, and no owner mint.
- Users pay gas only when they choose to call `claim(...)`.
- Firebase remains the gameplay source of truth. The backend signs EIP-712 claims only after Quick Auth verifies the Farcaster user and a server-backed score exists.
- Owner controls are limited to security/operations: pause, unpause, rotate reward signer, adjust max per-claim amount, and recover accidental ETH/ERC-20 sends.

## Deployment Inputs

Constructor:

```solidity
constructor(
  address initialOwner,
  address initialRewardSigner,
  uint256 maxSupply_,
  uint256 maxClaimAmount_
)
```

Suggested first deployment:

- `initialOwner`: your hardware/multisig owner wallet.
- `initialRewardSigner`: a fresh backend signer address, not your owner wallet.
- `maxSupply_`: fixed lifetime supply, for example `10000000`.
- `maxClaimAmount_`: conservative per-claim cap, for example `300`.

After deployment, set these Vercel env vars:

```bash
NEXT_PUBLIC_CASTER_CREDITS_CONTRACT=0x...
NEXT_PUBLIC_CASTER_CREDITS_CHAIN_ID=8453
REWARD_SIGNER_PRIVATE_KEY=0x... # backend signer private key, never owner key
REWARD_MAX_RIDE_CREDITS=300
REWARD_SHARE_CREDITS=25
```

## Expansion Path

Keep CYCLE credits as reputation/cosmetic progression:

- unlock skins
- unlock route effects
- weekly Farcaster bragging rights
- onchain achievement screenshots

Avoid making credits redeemable for money, tradable prizes, sweepstakes entries, or investment-like upside without a lawyer reviewing the model.
