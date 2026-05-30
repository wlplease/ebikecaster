"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";

type FarcasterUser = {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
};

type SafeAreaInsets = { top: number; bottom: number; left: number; right: number };

type FarcasterContextType = {
  user: FarcasterUser | null;
  ready: boolean;
  safeAreaInsets: SafeAreaInsets;
  isStandalone: boolean;
};

const DEFAULT_INSETS: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

const FarcasterContext = createContext<FarcasterContextType>({
  user: null,
  ready: false,
  safeAreaInsets: DEFAULT_INSETS,
  isStandalone: false,
});

export function useFarcasterUser() {
  return useContext(FarcasterContext);
}

export function FarcasterGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FarcasterUser | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [safeAreaInsets, setSafeAreaInsets] = useState<SafeAreaInsets>(DEFAULT_INSETS);

  useEffect(() => {
    let cancelled = false;

    sdk.actions.ready().catch(() => {});

    const timeout = setTimeout(() => {
      if (!cancelled && !ready && !failed) setFailed(true);
    }, 4000);

    (async () => {
      try {
        const ctx = (await (sdk as unknown as {
          context:
            | Promise<{ user?: FarcasterUser; client?: { safeAreaInsets?: SafeAreaInsets } }>
            | { user?: FarcasterUser; client?: { safeAreaInsets?: SafeAreaInsets } };
        }).context) as { user?: FarcasterUser; client?: { safeAreaInsets?: SafeAreaInsets } };

        if (cancelled) return;
        clearTimeout(timeout);

        if (ctx?.client?.safeAreaInsets) {
          setSafeAreaInsets(ctx.client.safeAreaInsets);
        }

        if (ctx?.user?.fid) {
          setUser({
            fid: ctx.user.fid,
            username: ctx.user.username,
            displayName: ctx.user.displayName,
            pfpUrl: ctx.user.pfpUrl,
          });
          setReady(true);
        } else {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [failed, ready]);

  if (!ready && !failed) {
    return (
      <div className="flex h-dvh w-full max-w-[520px] mx-auto items-center justify-center bg-[#101b26]">
        <div className="flex flex-col items-center gap-4">
          <div className="text-3xl font-black tracking-tight">
            <span className="text-[#fbe764]">Caster</span>
            <span className="text-[#7cf2ff]">Cycle</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#fbe764]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7cf2ff]" style={{ animationDelay: "0.15s" }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff6b6b]" style={{ animationDelay: "0.3s" }} />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
            loading daily route
          </span>
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <FarcasterContext.Provider value={{ user: null, ready: true, safeAreaInsets: DEFAULT_INSETS, isStandalone: true }}>
        {children}
      </FarcasterContext.Provider>
    );
  }

  return (
    <FarcasterContext.Provider value={{ user, ready, safeAreaInsets, isStandalone: false }}>
      {children}
    </FarcasterContext.Provider>
  );
}
