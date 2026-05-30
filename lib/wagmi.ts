import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { fallback, http, createStorage, cookieStorage } from "wagmi";
import { base } from "wagmi/chains";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

const baseTransports = process.env.NEXT_PUBLIC_BASE_RPC_URL
  ? [http(process.env.NEXT_PUBLIC_BASE_RPC_URL), http()]
  : [http()];

export const wagmiConfig = createConfig({
  chains: [base],
  ssr: true,
  connectors: [farcasterMiniApp(), injected()],
  transports: {
    [base.id]: fallback(baseTransports),
  },
  storage: createStorage({
    storage: cookieStorage,
  }),
  pollingInterval: 120_000,
});
