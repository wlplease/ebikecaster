# CasterCycle Credits

This folder contains optional Base gameplay contracts for CasterCycle.

## CasterCycle Credits

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

## Token Trophy Vault

`CasterCycleTokenTrophyVault.sol` is a separate owner-funded vault for tiny skill trophies, such as `1` token for a closed daily winner or `2` tokens for a closed weekly winner.

Guardrails:

- The vault cannot mint. You fund it by transferring the reward token into the vault.
- Claims require an EIP-712 signature from `TOKEN_TROPHY_SIGNER_PRIVATE_KEY`.
- Eligibility should use closed, free-to-enter Daily Dash boards only. Do not make paid pass purchase required for trophy eligibility.
- No random draw, no staking, no APY, no resale promise, no cash value promise, and no custody.
- Users pay their own Base gas only when they choose to claim.
- Owner controls are security/operations only: pause, unpause, rotate signer, set max per claim, recover vault funds.

Constructor:

```solidity
constructor(
  address initialOwner,
  address token,
  address initialRewardSigner,
  uint256 maxClaimAmount_
)
```

Suggested first deployment:

- `initialOwner`: your hardware/multisig owner wallet.
- `token`: your e-bike ERC-20 token, for example `0x1471C903A19Ea87097e4523924D17F2C5Ead2B07`.
- `initialRewardSigner`: a fresh backend signer address, not your owner wallet.
- `maxClaimAmount_`: a tiny cap in raw token units, for example `2 * 10**18` for an 18-decimal token.

After deployment, set these Vercel env vars:

```bash
NEXT_PUBLIC_TOKEN_TROPHY_VAULT=0x...
NEXT_PUBLIC_TOKEN_TROPHY_CHAIN_ID=8453
TOKEN_TROPHY_SIGNER_PRIVATE_KEY=0x... # backend signer private key, never owner key
TOKEN_TROPHY_DAILY_AMOUNT=1
TOKEN_TROPHY_WEEKLY_AMOUNT=2
TOKEN_TROPHY_MIN_SCORE=2500
```

Before launching token trophies publicly, publish plain rules in-app/website terms: no purchase necessary, skill-based leaderboard eligibility, trophy amount, deadline, geographic limits if any, tax responsibility, and your right to pause/correct fraud or errors.

Recommended public wording:

- CasterCycle is for entertainment only.
- No financial, investment, legal, tax, safety, or purchase advice.
- No purchase necessary for token trophy eligibility.
- Token trophies are owner-funded, skill-based, optional, and void where prohibited.
- No promise of market value, liquidity, resale, payout, tax treatment, or future rewards.
- Users control their wallets, approve their own transactions, pay their own gas, and handle their own taxes.
- The operator may pause, deny, correct, or revoke claims for abuse, errors, fraud, security, or compliance reasons.
