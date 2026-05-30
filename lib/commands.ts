import { sdk } from "@farcaster/miniapp-sdk";
import { formatTimeAgo } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════
   nSh3// Command Engine
   ═══════════════════════════════════════════════════════ */

export type OutputLine = {
  id: string;
  type: "command" | "result" | "error" | "info" | "system" | "ascii" | "table" | "card";
  content: string;
  timestamp: number;
  data?: unknown[];
};

type FarcasterUser = {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
};

export type CommandContext = {
  user: FarcasterUser | null;
  address: string | null;
  isPro: boolean;
  addLine: (line: Omit<OutputLine, "id" | "timestamp">) => void;
  clearLines: () => void;
  triggerUpgrade?: () => void;
  getRecentOutput?: () => OutputLine[];
};

type CommandResult = {
  data?: unknown[];
  suggestions?: { label: string; cmd: string }[];
};

type CommandHandler = (
  args: string,
  pipeData: unknown[] | null,
  ctx: CommandContext,
) => Promise<CommandResult>;

type CommandDef = {
  handler: CommandHandler;
  description: string;
  usage: string;
  tier?: "free" | "pro";
  proHint?: string;
};

/* ── Constants ── */
const APP_URL = "https://farcaster.xyz/miniapps/RisjMYhq-Rab/nshell";

export const PROMO = {
  sale: "$2/wk",
  daily: "$0.50/day",
  weekly: "$2/wk",
  tag: "PRO",
} as const;

/* ── Client-side localStorage cache ── */
const CLIENT_CACHE_TTLS: Record<string, number> = {
  whois:              30 * 60 * 1000,   // 30 min — profiles stable
  "user-by-fid":      30 * 60 * 1000,
  channel:            30 * 60 * 1000,
  "search-users":      5 * 60 * 1000,   // 5 min
  trending:            5 * 60 * 1000,   // 5 min
  "trending-channels": 5 * 60 * 1000,
  feed:                2 * 60 * 1000,   // 2 min — personal feed is dynamic
  followers:          15 * 60 * 1000,   // 15 min
  following:          15 * 60 * 1000,
  "user-casts":        5 * 60 * 1000,
  cast:               15 * 60 * 1000,   // 15 min — single cast
  conversation:       10 * 60 * 1000,
  reactions:          10 * 60 * 1000,
  "cast-search":       3 * 60 * 1000,
  notifications:       1 * 60 * 1000,   // 1 min — most dynamic
};

const CLIENT_CACHE_PREFIX = "nsc:";
const CLIENT_CACHE_MAX_KEYS = 80;

function getClientCache(key: string, ttl: number): unknown | null {
  try {
    const raw = localStorage.getItem(CLIENT_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts < ttl) return entry.d;
    localStorage.removeItem(CLIENT_CACHE_PREFIX + key);
  } catch {}
  return null;
}

function setClientCache(key: string, data: unknown) {
  try {
    localStorage.setItem(CLIENT_CACHE_PREFIX + key, JSON.stringify({ d: data, ts: Date.now() }));
    // Evict stale entries when we have too many cached items
    evictClientCache();
  } catch {
    // localStorage full — clear old entries and retry once
    try {
      evictClientCache(true);
      localStorage.setItem(CLIENT_CACHE_PREFIX + key, JSON.stringify({ d: data, ts: Date.now() }));
    } catch {}
  }
}

function evictClientCache(aggressive = false) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CLIENT_CACHE_PREFIX)) keys.push(k);
    }
    if (!aggressive && keys.length < CLIENT_CACHE_MAX_KEYS) return;
    const now = Date.now();
    const maxAge = aggressive ? 2 * 60 * 1000 : 30 * 60 * 1000;
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw);
        if (now - entry.ts > maxAge) localStorage.removeItem(k);
      } catch { localStorage.removeItem(k); }
    }
  } catch {}
}

/* ── API helper (with client-side cache) ── */
async function nshellApi(action: string, params: Record<string, string>) {
  const ttl = CLIENT_CACHE_TTLS[action];
  const cacheKey = ttl ? `${action}:${JSON.stringify(params)}` : null;

  // Check client cache first
  if (cacheKey && ttl) {
    const cached = getClientCache(cacheKey, ttl);
    if (cached !== null) return cached;
  }

  const res = await fetch("/api/nshell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "api request failed");

  // Store in client cache
  if (cacheKey) setClientCache(cacheKey, data.data);

  return data.data;
}

/* ── Format number with commas ── */
function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString();
}

/* ── Truncate text with ellipsis ── */
function trunc(text: unknown, max = 60, embedCount?: number): string {
  const s = String(text || "");
  const suffix = embedCount && embedCount > 0 ? ` [+${embedCount}]` : "";
  return (s.length > max ? s.slice(0, max) + "..." : s) + suffix;
}

/* ── Session tracking (resets on page reload) ── */
const _sessionData = { cmds: 0, proGateHits: 0, limitHits: 0, startedAt: Date.now(), firstCommandAt: 0, ttfCommand: 0 };

/* ── Fire-and-forget analytics ── */
export function trackEvent(
  event: string,
  ctx?: { user?: { fid?: number } | null; isPro?: boolean } | null,
  extra?: Record<string, string>,
) {
  try {
    const usage = getUsage();
    const daysSinceFirst = Math.max(0, Math.floor((Date.now() - usage.firstSeen) / 86400000));
    const params: Record<string, string> = {
      event,
      fid: String(ctx?.user?.fid ?? ""),
      isPro: String(!!ctx?.isPro),
      totalCommands: String(usage.total),
      daysSinceFirst: String(daysSinceFirst),
      sessionCommands: String(_sessionData.cmds),
      ...extra,
    };
    fetch("/api/nshell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "track", params }),
    }).catch(() => {});
  } catch {}
}

/* ── AI daily quota (localStorage) ── */
function getAiQuota(): { count: number; date: string } {
  try {
    const raw = localStorage.getItem("nshell-ai-quota");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === new Date().toISOString().slice(0, 10)) return parsed;
    }
  } catch {}
  return { count: 0, date: new Date().toISOString().slice(0, 10) };
}

function incrementAiQuota() {
  const quota = getAiQuota();
  quota.count++;
  try { localStorage.setItem("nshell-ai-quota", JSON.stringify(quota)); } catch {}
}

/* ── Pro gate helper ── */
function requirePro(ctx: CommandContext, commandName?: string): boolean {
  if (ctx.isPro) return true;
  _sessionData.proGateHits++;
  trackEvent("pro_gate_hit", ctx, { command: commandName || "" });
  // Context-aware message: use proHint if available
  const hint = commandName ? COMMANDS[commandName]?.proHint : undefined;
  if (hint) {
    ctx.addLine({ type: "error", content: `pro command: /${commandName} ${hint} — /trial for free 24h` });
  } else {
    ctx.addLine({ type: "error", content: "pro command — /trial for free 24h trial, or /upgrade" });
  }
  // After 3+ blocked commands, escalate
  if (_sessionData.proGateHits >= 3) {
    ctx.addLine({ type: "info", content: `  you've tried ${_sessionData.proGateHits} Pro commands this session. /trial unlocks all of them free for 24h` });
  } else {
    ctx.addLine({ type: "info", content: `  ${PROMO.weekly} · ${PROMO.daily} — cancel anytime` });
  }
  // Tappable action chips for quick upgrade
  ctx.addLine({
    type: "table",
    content: "",
    data: [
      { action: "/trial", _cmd: "/trial" },
      { action: "/upgrade", _cmd: "/upgrade" },
      { action: "/pro", _cmd: "/pro" },
    ],
  });
  return false;
}

/* ── Hint helpers ── */
function showCastHints(ctx: CommandContext) {
  // Only show hints for new users (< 20 commands)
  const usage = getUsage();
  if (usage.total < 20) {
    ctx.addLine({ type: "info", content: "" });
    ctx.addLine({ type: "info", content: "  tap cast to read · tap author to view profile" });
  }
}

function showUpgradeHint(ctx: CommandContext, shown: number, total: number | string, commandName?: string) {
  _sessionData.limitHits++;
  trackEvent("limit_hit", ctx, { command: commandName || "" });
  ctx.addLine({ type: "info", content: `  ${shown}/${total} shown · /upgrade for all` });
}

/* ── Token address mapping (Base) ── */
const TOKEN_MAP: Record<string, string> = {
  eth: "eip155:8453/native",
  usdc: "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  degen: "eip155:8453/erc20:0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
};

/* ── Levenshtein distance ── */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestCommand(input: string): string | null {
  const names = Object.keys(COMMANDS).filter((k) => k !== "h");
  let best = "";
  let bestDist = Infinity;
  for (const name of names) {
    const dist = levenshtein(input.toLowerCase(), name);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return bestDist <= 2 ? best : null;
}

/* ── Pagination state ── */
let lastResultData: unknown[] | null = null;
let lastResultOffset = 0;
const PAGE_SIZE = 10;

/* ═══════ COMMAND DEFINITIONS ═══════ */

const COMMANDS: Record<string, CommandDef> = {
  help: {
    description: "list available commands",
    usage: "/help [all]",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const usage = getUsage();
      const showFull = args.trim().toLowerCase() === "all" || usage.total >= 10;

      if (!showFull) {
        // Simplified beginner help
        ctx.addLine({ type: "system", content: "━━━ start here ━━━" });
        ctx.addLine({ type: "info", content: "" });
        const beginnerCmds: { name: string; desc: string }[] = [
          { name: "trending", desc: "see what's hot right now" },
          { name: "whois", desc: "look up any farcaster user" },
          { name: "channels", desc: "explore active channels" },
          { name: "ask", desc: "ask AI anything about farcaster" },
          { name: "cast", desc: "compose and post a cast" },
          { name: "discover", desc: "find interesting accounts" },
          { name: "search", desc: "search users by keyword" },
          { name: "quickstart", desc: "guided walkthrough" },
        ];
        for (const c of beginnerCmds) {
          ctx.addLine({ type: "result", content: `  /${c.name.padEnd(14)} ${c.desc}` });
        }
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  /help all — see all 40+ commands" });
        ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━" });
        return {
          suggestions: [
            { label: "/trending", cmd: "/trending" },
            { label: "/quickstart", cmd: "/quickstart" },
            { label: "/help all", cmd: "/help all" },
          ],
        };
      }

      // Full help
      ctx.addLine({ type: "system", content: "━━━ nSh3// commands ━━━" });
      ctx.addLine({ type: "info", content: "" });

      const sections: { title: string; cmds: string[] }[] = [
        { title: "explore", cmds: ["whois", "search", "trending", "channel", "followers", "following", "channels", "read", "discover", "compare", "top", "feed", "notifications", "casts", "castsearch", "thread", "mutual"] },
        { title: "interact", cmds: ["cast", "share", "sharecast", "like", "follow", "open", "reply", "quote", "reactions", "draft", "drafts", "undraft", "castoutput"] },
        { title: "ai", cmds: ["ask", "digest", "sentiment"] },
        { title: "pro power", cmds: ["popular", "analytics", "watch", "unwatch", "watchlist"] },
        { title: "defi", cmds: ["balances", "send", "swap"] },
        { title: "pipes", cmds: ["filter", "sort", "head", "tail", "count", "uniq", "export", "more", "bulk"] },
        { title: "bookmarks", cmds: ["save", "unsave", "bookmarks"] },
        { title: "shortcuts", cmds: ["alias", "unalias", "aliases", "pin", "unpin", "pins"] },
        { title: "system", cmds: ["help", "quickstart", "status", "stats", "topcmds", "permissions", "history", "clear", "keys", "upgrade", "pro", "trial", "profile", "invite", "changelog"] },
      ];

      for (const section of sections) {
        ctx.addLine({ type: "result", content: `  ── ${section.title} ──` });
        for (const name of section.cmds) {
          const def = COMMANDS[name];
          if (!def) continue;
          const tag = def.tier === "pro" ? "[PRO]" : "     ";
          ctx.addLine({
            type: "result",
            content: `  /${name.padEnd(14)} ${tag} ${def.description}`,
          });
        }
        ctx.addLine({ type: "info", content: "" });
      }

      ctx.addLine({ type: "info", content: "  pipe commands with |  example: /trending | /filter eth | /export csv" });
      if (!ctx.isPro) {
        ctx.addLine({ type: "info", content: "  /trial — free 24h Pro trial | /upgrade" });
      }
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━━" });
      return {
        suggestions: [
          { label: "/trending", cmd: "/trending" },
          { label: "/quickstart", cmd: "/quickstart" },
          { label: "/keys", cmd: "/keys" },
        ],
      };
    },
  },

  whois: {
    description: "look up a farcaster user",
    usage: "/whois @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const username = args.replace(/^@/, "").trim();
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /whois @username" });
        return {};
      }
      ctx.addLine({ type: "info", content: `resolving @${username}...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      const badge = user.power_badge ? " ⚡" : "";
      const lines = [
        `@${user.username}${badge}`,
        `  name      ${user.display_name || "—"}`,
        `  fid       ${user.fid}`,
        `  followers ${fmt(user.follower_count)}`,
        `  following ${fmt(user.following_count)}`,
        `  bio       ${(user.profile?.bio?.text || "—").slice(0, 80)}`,
        `  address   ${user.verified_addresses?.eth_addresses?.[0] || "none"}`,
      ];
      if (user.power_badge) {
        lines.push(`  power     ⚡ verified`);
      }
      if (user.experimental?.neynar_user_score !== undefined) {
        lines.push(`  score     ${user.experimental.neynar_user_score}`);
      }
      ctx.addLine({ type: "card", content: lines.join("\n") });
      ctx.addLine({
        type: "table",
        content: "",
        data: [
          { action: "followers", _cmd: `/followers @${user.username}` },
          { action: "casts", _cmd: `/casts @${user.username}` },
          { action: "open", _cmd: `/open @${user.username}` },
          { action: "follow", _cmd: `/follow @${user.username}` },
        ],
      });
      return {
        data: [user],
        suggestions: [
          { label: "casts", cmd: `/casts @${user.username}` },
          { label: "popular", cmd: `/popular @${user.username}` },
          { label: "mutual", cmd: `/mutual @${user.username}` },
          { label: "followers", cmd: `/followers @${user.username}` },
        ],
      };
    },
  },

  cast: {
    description: "compose a cast",
    usage: '/cast "your message"',
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const text = args.replace(/^["']|["']$/g, "").trim();
      if (!text) {
        ctx.addLine({ type: "error", content: 'usage: /cast "your message"' });
        return {};
      }
      try {
        await sdk.actions.composeCast({ text: `${text}\n\nvia ${APP_URL}` });
        ctx.addLine({ type: "result", content: "compose window opened." });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  share: {
    description: "share/recast a cast",
    usage: "/share 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /share 0xhash" });
        ctx.addLine({ type: "info", content: "tip: get hashes from /trending, /feed, or /read" });
        return {};
      }
      try {
        const castUrl = `https://warpcast.com/~/conversations/${hash}`;
        await sdk.actions.composeCast({ text: `\n\n${APP_URL}`, embeds: [castUrl] });
        ctx.addLine({ type: "result", content: `share window opened for ${hash.slice(0, 10)}...` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open share. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  like: {
    description: "view cast to like it",
    usage: "/like 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /like 0xhash" });
        ctx.addLine({ type: "info", content: "tip: get hashes from /trending, /feed, or /read" });
        return {};
      }
      try {
        await sdk.actions.viewCast({ hash });
        ctx.addLine({ type: "result", content: `opened cast ${hash.slice(0, 10)}... — tap the heart to like.` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open cast. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  quote: {
    description: "quote a cast with your comment",
    usage: '/quote 0xhash "your take"',
    tier: "pro",
    proHint: "lets you quote cast with your take",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "quote")) return {};
      const match = args.match(/^(0x[a-fA-F0-9]+)\s+["']?(.*?)["']?$/);
      if (!match) {
        ctx.addLine({ type: "error", content: 'usage: /quote 0xhash "your take on this"' });
        return {};
      }
      const [, hash, text] = match;
      const castUrl = `https://warpcast.com/~/conversations/${hash}`;
      try {
        await sdk.actions.composeCast({ text: `${text.trim()}\n\n${APP_URL}`, embeds: [castUrl] });
        ctx.addLine({ type: "result", content: "quote compose window opened." });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  balances: {
    description: "show wallet balances",
    usage: "/balances",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.address) {
        ctx.addLine({ type: "error", content: "no wallet connected." });
        ctx.addLine({ type: "info", content: "connect your wallet in farcaster settings." });
        return {};
      }
      ctx.addLine({ type: "info", content: `wallet: ${ctx.address.slice(0, 6)}...${ctx.address.slice(-4)}` });
      try {
        const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [ctx.address, "latest"],
            id: 1,
          }),
        });
        const data = await res.json();
        const wei = BigInt(data.result || "0");
        const eth = Number(wei) / 1e18;
        ctx.addLine({ type: "result", content: `  ETH (Base)  ${eth.toFixed(6)}` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't fetch balance. try again in a moment." });
      }
      if (!ctx.isPro) {
        ctx.addLine({ type: "info", content: "  pro: /send & /swap tokens directly — /upgrade" });
      }
      return {};
    },
  },

  followers: {
    description: "list followers of a user",
    usage: "/followers @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      let username = args.replace(/^@/, "").trim();
      if (!username && ctx.user?.username) {
        username = ctx.user.username;
      }
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /followers @username" });
        return {};
      }
      const limit = ctx.isPro ? 25 : 10;
      ctx.addLine({ type: "info", content: `fetching @${username} profile...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching followers (fid: ${user.fid})...` });
      const followers = await nshellApi("followers", { fid: String(user.fid), limit: String(limit) });
      if (!followers || followers.length === 0) {
        ctx.addLine({ type: "info", content: "no followers found." });
        ctx.addLine({ type: "info", content: "  /trending — discover people to follow" });
        return { data: [] };
      }
      followers.sort((a: Record<string, unknown>, b: Record<string, unknown>) => ((b.followerCount as number) || 0) - ((a.followerCount as number) || 0));
      ctx.addLine({
        type: "table",
        content: "",
        data: followers.map((f: Record<string, unknown>) => ({
          username: `@${f.username || "—"}`,
          name: String(f.displayName || "—").slice(0, 20),
          followers: fmt(f.followerCount as number),
          power: f.powerBadge ? "⚡" : "",
        })),
      });
      lastResultData = followers;
      lastResultOffset = followers.length;
      if (!ctx.isPro && followers.length >= limit) {
        showUpgradeHint(ctx, limit, fmt(user.follower_count), "followers");
      }
      ctx.addLine({ type: "info", content: "  tap username to view profile" });
      const firstFollower = followers[0]?.username ? `@${followers[0].username}` : null;
      return {
        data: followers,
        suggestions: [
          { label: "mutual", cmd: `/mutual @${username}` },
          { label: "/following", cmd: `/following @${username}` },
          ...(firstFollower ? [{ label: `open ${firstFollower}`, cmd: `/open ${firstFollower}` }] : []),
        ],
      };
    },
  },

  following: {
    description: "list who a user follows",
    usage: "/following @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      let username = args.replace(/^@/, "").trim();
      if (!username && ctx.user?.username) {
        username = ctx.user.username;
      }
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /following @username" });
        return {};
      }
      const limit = ctx.isPro ? 25 : 10;
      ctx.addLine({ type: "info", content: `fetching @${username} profile...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching following (fid: ${user.fid})...` });
      const following = await nshellApi("following", { fid: String(user.fid), limit: String(limit) });
      if (!following || following.length === 0) {
        ctx.addLine({ type: "info", content: "not following anyone." });
        return { data: [] };
      }
      following.sort((a: Record<string, unknown>, b: Record<string, unknown>) => ((b.followerCount as number) || 0) - ((a.followerCount as number) || 0));
      ctx.addLine({
        type: "table",
        content: "",
        data: following.map((f: Record<string, unknown>) => ({
          username: `@${f.username || "—"}`,
          name: String(f.displayName || "—").slice(0, 20),
          followers: fmt(f.followerCount as number),
          power: f.powerBadge ? "⚡" : "",
        })),
      });
      lastResultData = following;
      lastResultOffset = following.length;
      if (!ctx.isPro && following.length >= limit) {
        showUpgradeHint(ctx, limit, fmt(user.following_count), "following");
      }
      ctx.addLine({ type: "info", content: "  tap username to view profile" });
      return { data: following };
    },
  },

  channel: {
    description: "channel stats",
    usage: "/channel <name>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const name = args.trim().replace(/^\//, "");
      if (!name) {
        ctx.addLine({ type: "error", content: "usage: /channel <name>" });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching /${name}...` });
      const ch = await nshellApi("channel", { name });
      if (!ch) {
        ctx.addLine({ type: "error", content: `channel /${name} not found.` });
        return {};
      }
      const lines = [
        `/${ch.id}`,
        `  name        ${ch.name || "—"}`,
        `  followers   ${fmt(ch.follower_count)}`,
        `  description ${(ch.description || "—").slice(0, 80)}`,
        `  created     ${ch.created_at ? new Date(ch.created_at * 1000).toLocaleDateString() : "—"}`,
        `  lead        @${ch.lead?.username || "—"}`,
      ];
      ctx.addLine({ type: "card", content: lines.join("\n") });
      const channelActions: Record<string, unknown>[] = [
        { action: `search /${ch.id}`, _cmd: `/castsearch ${ch.id}` },
      ];
      if (ch.lead?.username) {
        channelActions.push({ action: `@${ch.lead.username}`, _cmd: `/open @${ch.lead.username}` });
      }
      channelActions.push({ action: "/channels", _cmd: "/channels" });
      ctx.addLine({ type: "table", content: "", data: channelActions });
      return { data: [ch] };
    },
  },

  trending: {
    description: "show trending casts",
    usage: "/trending [1h|6h|12h|24h]  (default: 6h)",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const validWindows = ["1h", "6h", "12h", "24h"];
      const timeWindow = validWindows.includes(args.trim()) ? args.trim() : "6h";
      const limit = ctx.isPro ? 10 : 8;
      ctx.addLine({ type: "info", content: `fetching trending feed (${timeWindow})...` });
      const casts = await nshellApi("trending", { limit: String(limit), time_window: timeWindow });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no trending casts found." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: casts.map((c: Record<string, unknown>) => ({
          author: `@${c.author}`,
          ...(c.authorBadge ? { "⚡": "⚡" } : {}),
          text: trunc(c.text, 60, c.embedCount as number),
          likes: c.likes,
          ...(c.channel ? { channel: `/${c.channel}` } : {}),
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      lastResultData = casts;
      lastResultOffset = casts.length;
      showCastHints(ctx);
      if (!ctx.isPro && casts.length >= limit) {
        showUpgradeHint(ctx, limit, "25+", "trending");
      }
      ctx.addLine({ type: "info", content: "  /trending 1h · 6h · 12h · 24h" });
      const firstHash = casts[0]?.hash ? String(casts[0].hash) : null;
      return {
        data: casts,
        suggestions: [
          { label: "filter", cmd: "/filter " },
          { label: "export csv", cmd: "/export csv" },
          ...(firstHash ? [{ label: "read top", cmd: `/read ${firstHash}` }] : []),
          { label: "/channels", cmd: "/channels" },
        ],
      };
    },
  },

  search: {
    description: "search users",
    usage: "/search <query>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.addLine({ type: "error", content: "usage: /search <query>" });
        return {};
      }
      const limit = ctx.isPro ? 10 : 8;
      ctx.addLine({ type: "info", content: `searching "${query}"...` });
      const users = await nshellApi("search-users", { query });
      if (!users || users.length === 0) {
        ctx.addLine({ type: "info", content: "no results found. try a different query." });
        return { data: [] };
      }
      const display = users.slice(0, limit);
      ctx.addLine({
        type: "table",
        content: "",
        data: display.map((u: Record<string, unknown>) => ({
          username: `@${u.username}`,
          name: String(u.displayName || "—").slice(0, 20),
          followers: fmt(u.followerCount as number),
          power: u.powerBadge ? "⚡" : "",
        })),
      });
      lastResultData = display;
      lastResultOffset = display.length;
      if (!ctx.isPro && users.length > limit) {
        showUpgradeHint(ctx, limit, users.length, "search");
      }
      ctx.addLine({ type: "info", content: "  /whois @user for full profile | /search query | /export csv" });
      return { data: display };
    },
  },

  /* ── New: /reactions ── */
  reactions: {
    description: "who liked/recasted a cast",
    usage: "/reactions 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /reactions 0xhash" });
        ctx.addLine({ type: "info", content: "tip: get hashes from /trending, /feed, or /read" });
        return {};
      }
      const limit = ctx.isPro ? 25 : 10;
      ctx.addLine({ type: "info", content: `fetching reactions for ${hash.slice(0, 10)}...` });
      const reactions = await nshellApi("reactions", { hash, limit: String(limit), type: "likes" });
      if (!reactions || reactions.length === 0) {
        ctx.addLine({ type: "info", content: "no reactions found." });
        return { data: [] };
      }
      reactions.sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.powerBadge ? 1 : 0) - (a.powerBadge ? 1 : 0));
      ctx.addLine({
        type: "table",
        content: "",
        data: reactions.map((r: Record<string, unknown>) => ({
          username: `@${r.username}`,
          name: String(r.displayName || "—").slice(0, 20),
          type: r.type,
          power: r.powerBadge ? "⚡" : "",
        })),
      });
      lastResultData = reactions;
      lastResultOffset = reactions.length;
      if (!ctx.isPro && reactions.length >= limit) {
        showUpgradeHint(ctx, limit, "all", "reactions");
      }
      ctx.addLine({ type: "info", content: "  tap username to view profile" });
      return { data: reactions };
    },
  },

  /* ── New: /casts ── */
  casts: {
    description: "user's recent casts",
    usage: "/casts @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      let username = args.replace(/^@/, "").trim();
      if (!username && ctx.user?.username) {
        username = ctx.user.username;
      }
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /casts @username" });
        return {};
      }
      ctx.addLine({ type: "info", content: `resolving @${username}...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      const limit = ctx.isPro ? 15 : 8;
      ctx.addLine({ type: "info", content: `fetching casts (fid: ${user.fid})...` });
      const casts = await nshellApi("user-casts", { fid: String(user.fid), limit: String(limit) });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no casts found." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: casts.map((c: Record<string, unknown>) => ({
          text: trunc(c.text, 60, c.embedCount as number),
          likes: c.likes,
          replies: c.replies,
          ...(c.channel ? { channel: `/${c.channel}` } : {}),
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      lastResultData = casts;
      lastResultOffset = casts.length;
      showCastHints(ctx);
      if (!ctx.isPro && casts.length >= limit) {
        showUpgradeHint(ctx, limit, "15+", "casts");
      }
      ctx.addLine({ type: "info", content: "  /casts @user | /export csv — download" });
      return { data: casts };
    },
  },

  /* ── New: /popular ── */
  popular: {
    description: "user's top casts by engagement",
    usage: "/popular @username",
    tier: "pro",
    proHint: "shows top casts by engagement",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "popular")) return {};
      let username = args.replace(/^@/, "").trim();
      if (!username && ctx.user?.username) {
        username = ctx.user.username;
      }
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /popular @username" });
        return {};
      }
      ctx.addLine({ type: "info", content: `resolving @${username}...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching casts (fid: ${user.fid})...` });
      const casts = await nshellApi("user-casts", { fid: String(user.fid), limit: "25" });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no casts found." });
        return { data: [] };
      }
      // Sort by engagement (likes + recasts)
      casts.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (((b.likes as number) || 0) + ((b.recasts as number) || 0)) -
        (((a.likes as number) || 0) + ((a.recasts as number) || 0))
      );
      const top = casts.slice(0, 10);
      ctx.addLine({
        type: "table",
        content: "",
        data: top.map((c: Record<string, unknown>) => ({
          text: trunc(c.text, 60, c.embedCount as number),
          likes: c.likes,
          recasts: c.recasts,
          ...(c.channel ? { channel: `/${c.channel}` } : {}),
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      lastResultData = top;
      lastResultOffset = top.length;
      showCastHints(ctx);
      return { data: top };
    },
  },

  /* ── New: /channels ── */
  channels: {
    description: "trending channels",
    usage: "/channels [1d|7d|30d]",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const validWindows = ["1d", "7d", "30d"];
      const timeWindow = validWindows.includes(args.trim()) ? args.trim() : "1d";
      const limit = ctx.isPro ? 15 : 8;
      ctx.addLine({ type: "info", content: `fetching trending channels (${timeWindow})...` });
      const channels = await nshellApi("trending-channels", { time_window: timeWindow, limit: String(limit) });
      if (!channels || channels.length === 0) {
        ctx.addLine({ type: "info", content: "no trending channels found." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: channels.map((ch: Record<string, unknown>) => ({
          channel: `/${ch.id}`,
          name: String(ch.name || "—").slice(0, 20),
          followers: fmt(ch.followers as number),
          lead: `@${ch.lead}`,
        })),
      });
      lastResultData = channels;
      lastResultOffset = channels.length;
      if (!ctx.isPro && channels.length >= limit) {
        showUpgradeHint(ctx, limit, "all", "channels");
      }
      ctx.addLine({ type: "info", content: "  /channel <name> for details | /channels [1d|7d|30d]" });
      const firstChannel = channels[0]?.id ? String(channels[0].id) : null;
      return {
        data: channels,
        suggestions: [
          ...(firstChannel ? [{ label: `/${firstChannel}`, cmd: `/channel ${firstChannel}` }] : []),
          { label: "/trending", cmd: "/trending" },
          { label: "/discover", cmd: "/discover" },
        ],
      };
    },
  },

  /* ── New: /invite ── */
  invite: {
    description: "share nSh3// with your followers",
    usage: "/invite",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const username = ctx.user?.username ? `@${ctx.user.username}` : "someone";
      const usage = getUsageStats();
      const statsLine = usage.total > 10
        ? `i've run ${usage.total} commands in ${usage.days} days`
        : "just started using it";
      const text = `been using nSh3// — a terminal for farcaster. ${statsLine}. look up anyone, trending casts, AI answers, all from the command line.\n\ntry it:\n${APP_URL}`;
      try {
        await sdk.actions.composeCast({ text });
        ctx.addLine({ type: "result", content: "invite compose window opened." });
        ctx.addLine({ type: "info", content: `sharing nSh3// as ${username} — thanks for spreading the word.` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  /* ── New: /sharecast ── */
  sharecast: {
    description: "share a cast with your take",
    usage: "/sharecast 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /sharecast 0xhash" });
        ctx.addLine({ type: "info", content: "tip: get hashes from /trending, /feed, or /read" });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching cast ${hash.slice(0, 10)}...` });
      try {
        const cast = await nshellApi("cast", { hash });
        const castUrl = `https://warpcast.com/~/conversations/${hash}`;
        const pretext = cast ? `found via nSh3// — @${cast.author}: "${String(cast.text || "").slice(0, 60)}..."\n\n${APP_URL}` : `found this on nSh3//\n\n${APP_URL}`;
        await sdk.actions.composeCast({ text: pretext, embeds: [castUrl] });
        ctx.addLine({ type: "result", content: "share compose window opened with context." });
      } catch {
        // Fallback: share without preview
        const castUrl = `https://warpcast.com/~/conversations/${hash}`;
        try {
          await sdk.actions.composeCast({ text: `found this on nSh3// terminal\n\n${APP_URL}`, embeds: [castUrl] });
          ctx.addLine({ type: "result", content: "share compose window opened." });
        } catch {
          ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
        }
      }
      return {};
    },
  },

  /* ── New: /mutual ── */
  mutual: {
    description: "mutual followers with a user",
    usage: "/mutual @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      const username = args.replace(/^@/, "").trim();
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /mutual @username" });
        return {};
      }
      ctx.addLine({ type: "info", content: `resolving @${username}...` });
      const target = await nshellApi("whois", { username });
      if (!target) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      ctx.addLine({ type: "info", content: "fetching your followers..." });
      const myFollowers = await nshellApi("followers", { fid: String(ctx.user.fid), limit: "100" });
      ctx.addLine({ type: "info", content: `fetching @${username}'s followers...` });
      const theirFollowers = await nshellApi("followers", { fid: String(target.fid), limit: "100" });

      const mySet = new Set((myFollowers ?? []).map((f: Record<string, unknown>) => f.fid));
      const mutuals = (theirFollowers ?? []).filter((f: Record<string, unknown>) => mySet.has(f.fid));

      if (mutuals.length === 0) {
        ctx.addLine({ type: "info", content: `no mutual followers with @${username}.` });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: mutuals.map((f: Record<string, unknown>) => ({
          username: `@${f.username || "—"}`,
          name: String(f.displayName || "—").slice(0, 20),
          followers: fmt(f.followerCount as number),
          power: f.powerBadge ? "⚡" : "",
        })),
      });
      lastResultData = mutuals;
      lastResultOffset = mutuals.length;
      ctx.addLine({ type: "info", content: `  ${mutuals.length} mutual followers with @${username}` });
      return { data: mutuals };
    },
  },

  /* ── New: /stats ── */
  stats: {
    description: "your engagement summary",
    usage: "/stats",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      ctx.addLine({ type: "info", content: "fetching your stats..." });
      const user = await nshellApi("user-by-fid", { fid: String(ctx.user.fid) });
      if (!user) {
        ctx.addLine({ type: "error", content: "couldn't load your profile. try again." });
        return {};
      }
      const badge = user.power_badge ? " ⚡" : "";
      const lines = [
        `@${user.username}${badge} — engagement summary`,
        ``,
        `  followers   ${fmt(user.follower_count)}`,
        `  following   ${fmt(user.following_count)}`,
        `  ratio       ${user.follower_count && user.following_count ? (user.follower_count / user.following_count).toFixed(2) : "—"}`,
      ];
      if (user.experimental?.neynar_user_score !== undefined) {
        lines.push(`  neynar      ${user.experimental.neynar_user_score}`);
      }
      if (user.power_badge) {
        lines.push(`  power       ⚡ verified`);
      }
      ctx.addLine({ type: "card", content: lines.join("\n") });

      // Usage stats
      const usage = getUsageStats();
      if (usage.total > 0) {
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "system", content: "  ── nSh3// usage ──" });
        ctx.addLine({ type: "result", content: `  commands    ${fmt(usage.total)} in ${usage.days}d` });
        ctx.addLine({ type: "result", content: `  most used   /${usage.topCmd} (${usage.topCount}x)` });
      }

      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({
        type: "table",
        content: "",
        data: [
          { action: "/feed", _cmd: "/feed" },
          { action: "/casts", _cmd: `/casts @${ctx.user.username}` },
          { action: "/popular", _cmd: `/popular @${ctx.user.username}` },
          { action: "/trending", _cmd: "/trending" },
        ],
      });
      return {
        data: [user],
        suggestions: [
          { label: "popular", cmd: `/popular @${ctx.user.username}` },
          { label: "casts", cmd: `/casts @${ctx.user.username}` },
          { label: "/feed", cmd: "/feed" },
          { label: "/trending", cmd: "/trending" },
        ],
      };
    },
  },

  /* ── New: /more ── */
  more: {
    description: "paginate last result",
    usage: "/more",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!lastResultData || lastResultData.length === 0) {
        ctx.addLine({ type: "info", content: "no previous result to paginate." });
        ctx.addLine({ type: "info", content: "run a command first, then /more to see next page." });
        return {};
      }
      const page = lastResultData.slice(lastResultOffset, lastResultOffset + PAGE_SIZE);
      if (page.length === 0) {
        ctx.addLine({ type: "info", content: "end of results." });
        return {};
      }
      lastResultOffset += page.length;
      if (typeof page[0] === "object" && page[0] !== null) {
        ctx.addLine({
          type: "table",
          content: "",
          data: page as Record<string, unknown>[],
        });
      }
      const remaining = lastResultData.length - lastResultOffset;
      ctx.addLine({
        type: "info",
        content: `showing ${lastResultOffset}/${lastResultData.length}${remaining > 0 ? " — /more for next page" : " (end)"}`,
      });
      return { data: page };
    },
  },

  filter: {
    description: "filter piped data by pattern",
    usage: "/filter <pattern>",
    tier: "free",
    handler: async (args, pipeData, ctx) => {
      const pattern = args.trim().replace(/^["']|["']$/g, "").toLowerCase();
      if (!pattern) {
        ctx.addLine({ type: "error", content: "usage: /filter <pattern>" });
        return {};
      }
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data to filter. pipe data into this command." });
        return {};
      }
      const filtered = pipeData.filter((item) => {
        const str = JSON.stringify(item).toLowerCase();
        return str.includes(pattern);
      });
      ctx.addLine({
        type: "info",
        content: `filtered: ${filtered.length}/${pipeData.length} results match "${pattern}"`,
      });
      if (filtered.length > 0 && typeof filtered[0] === "object") {
        ctx.addLine({
          type: "table",
          content: "",
          data: filtered.map((item) => {
            if (typeof item === "object" && item !== null) {
              const obj: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
                obj[k] = typeof v === "string" ? v.slice(0, 30) : v;
              }
              return obj;
            }
            return { value: item };
          }),
        });
      }
      return { data: filtered };
    },
  },

  export: {
    description: "export piped data as csv/json",
    usage: "/export csv|json",
    tier: "free",
    handler: async (args, pipeData, ctx) => {
      const format = args.trim().toLowerCase() || "csv";
      if (format !== "csv" && format !== "json") {
        ctx.addLine({ type: "error", content: "supported formats: csv, json" });
        return {};
      }
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data to export. pipe data into this command." });
        ctx.addLine({ type: "info", content: "example: /trending | /export csv" });
        return {};
      }
      const maxRows = ctx.isPro ? Infinity : 10;
      const exportData = pipeData.slice(0, maxRows);
      if (!ctx.isPro && pipeData.length > maxRows) {
        ctx.addLine({ type: "info", content: `exporting ${maxRows}/${pipeData.length} rows. Pro unlocks all — /upgrade` });
      }
      if (format === "json") {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nshell-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        ctx.addLine({ type: "result", content: `exported ${exportData.length} records as json.` });
        return {};
      }
      // CSV
      const items = exportData as Record<string, unknown>[];
      if (items.length === 0 || typeof items[0] !== "object") {
        ctx.addLine({ type: "error", content: "data is not tabular." });
        return {};
      }
      const keys = Object.keys(items[0]);
      const rows = [keys.join(",")];
      for (const item of items) {
        rows.push(keys.map((k) => `"${String((item as Record<string, unknown>)[k] ?? "").replace(/"/g, '""')}"`).join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nshell-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      ctx.addLine({ type: "result", content: `exported ${items.length} records as csv.` });
      if (!ctx.isPro && pipeData.length > maxRows) {
        ctx.addLine({ type: "info", content: `  ${pipeData.length - maxRows} rows hidden. /upgrade for full exports` });
      }
      return {};
    },
  },

  status: {
    description: "show session info",
    usage: "/status",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const ttfLabel = _sessionData.ttfCommand > 0 ? `${(_sessionData.ttfCommand / 1000).toFixed(1)}s` : "—";
      const lines = [
        `operator    ${ctx.user?.username ? `@${ctx.user.username}` : "anonymous"}`,
        `fid         ${ctx.user?.fid ?? "—"}`,
        `wallet      ${ctx.address ? `${ctx.address.slice(0, 6)}...${ctx.address.slice(-4)}` : "not connected"}`,
        `tier        ${ctx.isPro ? "pro" : "free"}`,
        `chain       base (8453)`,
        `protocol    farcaster`,
        `session     ${new Date().toISOString()}`,
        `ttf-cmd     ${ttfLabel}`,
        `cmds        ${_sessionData.cmds}`,
      ];
      ctx.addLine({ type: "card", content: lines.join("\n") });
      return {
        suggestions: [
          { label: "/stats", cmd: "/stats" },
          { label: "/permissions", cmd: "/permissions" },
          { label: "/topcmds", cmd: "/topcmds" },
        ],
      };
    },
  },

  profile: {
    description: "your farcaster profile",
    usage: "/profile",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      ctx.addLine({ type: "info", content: "fetching your profile..." });
      try {
        const user = await nshellApi("user-by-fid", { fid: String(ctx.user.fid) });
        if (!user) {
          ctx.addLine({ type: "error", content: "couldn't load your profile. try again." });
          return {};
        }
        const badge = user.power_badge ? " ⚡" : "";
        const lines = [
          `@${user.username}${badge}`,
          `  name       ${user.display_name || "—"}`,
          `  fid        ${user.fid}`,
          `  followers  ${fmt(user.follower_count)}`,
          `  following  ${fmt(user.following_count)}`,
          `  bio        ${(user.profile?.bio?.text || "—").slice(0, 80)}`,
          `  tier       ${ctx.isPro ? "pro" : "free"}`,
        ];
        if (ctx.address) {
          lines.push(`  wallet     ${ctx.address.slice(0, 6)}...${ctx.address.slice(-4)}`);
        }
        ctx.addLine({ type: "card", content: lines.join("\n") });
        ctx.addLine({ type: "info", content: "  /followers — see who follows you | /feed — your personalized feed" });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't load your profile. try again." });
      }
      return {};
    },
  },

  clear: {
    description: "clear terminal",
    usage: "/clear",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.clearLines();
      ctx.addLine({ type: "system", content: "terminal cleared. /help for commands." });
      return {
        suggestions: [
          { label: "/trending", cmd: "/trending" },
          { label: "/feed", cmd: "/feed" },
          { label: "/discover", cmd: "/discover" },
        ],
      };
    },
  },

  pro: {
    description: "your pro features & status",
    usage: "/pro",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.isPro) {
        ctx.addLine({ type: "system", content: "━━━ free tier ━━━" });
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "result", content: "  everything explores free. Pro unlocks power:" });
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "result", content: "  /popular /analytics /watchlist — deep analysis" });
        ctx.addLine({ type: "result", content: "  /quote /reply /send /swap — actions" });
        ctx.addLine({ type: "result", content: "  /sort /head /tail /count /bulk — power pipes" });
        ctx.addLine({ type: "result", content: "  50 AI queries/day · unlimited results & exports" });
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  /trial — free 24h trial, no commitment" });
        ctx.addLine({ type: "system", content: `  ${PROMO.weekly} or ${PROMO.daily} — /upgrade` });
        return {};
      }
      ctx.addLine({ type: "system", content: "━━━ pro active ━━━" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  /popular /analytics /watchlist — deep analysis" });
      ctx.addLine({ type: "result", content: "  /quote /reply /send /swap — actions" });
      ctx.addLine({ type: "result", content: "  /sort /head /tail /count /bulk — power pipes" });
      ctx.addLine({ type: "result", content: "  50 AI queries/day · unlimited results & exports" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "info", content: "  /invite — share nSh3// with your followers" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━" });
      return {};
    },
  },

  upgrade: {
    description: "pro pass info & pricing",
    usage: "/upgrade",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (ctx.isPro) {
        ctx.addLine({ type: "result", content: "  you already have Pro active. /pro to see your features." });
        return {};
      }
      ctx.addLine({ type: "system", content: "━━━ nSh3// pro ━━━" });
      ctx.addLine({ type: "result", content: "  $0.50/day or $2/week USDC on Base" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  explore free. pro unlocks power:" });
      ctx.addLine({ type: "result", content: "  /popular /analytics /watchlist — deep analysis" });
      ctx.addLine({ type: "result", content: "  /quote /reply /send /swap — actions" });
      ctx.addLine({ type: "result", content: "  /sort /head /tail /count /bulk — power pipes" });
      ctx.addLine({ type: "result", content: "  50 AI/day · unlimited results & exports" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "info", content: "  /trial — free 24h trial, no card required" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━" });
      if (ctx.triggerUpgrade) {
        ctx.triggerUpgrade();
      }
      return {};
    },
  },

  feed: {
    description: "your personal feed",
    usage: "/feed",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      const limit = ctx.isPro ? 15 : 8;
      ctx.addLine({ type: "info", content: "fetching feed..." });
      const casts = await nshellApi("feed", { fid: String(ctx.user.fid), limit: String(limit) });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no feed items yet." });
        ctx.addLine({ type: "info", content: "  follow more people to fill your feed. /trending to start." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: casts.map((c: Record<string, unknown>) => ({
          author: `@${c.author}`,
          ...(c.authorBadge ? { "⚡": "⚡" } : {}),
          text: trunc(c.text, 60, c.embedCount as number),
          likes: c.likes,
          ...(c.channel ? { channel: `/${c.channel}` } : {}),
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      lastResultData = casts;
      lastResultOffset = casts.length;
      showCastHints(ctx);
      if (!ctx.isPro && casts.length >= limit) {
        showUpgradeHint(ctx, limit, "15+", "feed");
      }
      ctx.addLine({ type: "info", content: "  /feed | /filter <topic> — curate your feed" });
      return {
        data: casts,
        suggestions: [
          { label: "filter", cmd: "/filter " },
          { label: "export csv", cmd: "/export csv" },
          { label: "/notifications", cmd: "/notifications" },
          { label: "/trending", cmd: "/trending" },
        ],
      };
    },
  },

  notifications: {
    description: "your mentions, replies, likes",
    usage: "/notifications",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      ctx.addLine({ type: "info", content: "fetching notifications..." });
      const notifs = await nshellApi("notifications", { fid: String(ctx.user.fid), limit: "15" });
      if (!notifs || notifs.length === 0) {
        ctx.addLine({ type: "info", content: "no notifications yet." });
        ctx.addLine({ type: "info", content: "  cast, reply, and interact to get mentions and likes." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: notifs.map((n: Record<string, unknown>) => ({
          type: n.type,
          from: n.from || "unknown",
          text: String(n.text || "").slice(0, 50) + (String(n.text || "").length > 50 ? "..." : ""),
          time: n.time || "",
        })),
      });
      ctx.addLine({ type: "info", content: "  /open @user to view profiles | /notifications | /export csv" });
      const firstFrom = notifs[0]?.from ? String(notifs[0].from) : null;
      return {
        data: notifs,
        suggestions: [
          ...(firstFrom ? [{ label: `open ${firstFrom}`, cmd: `/open ${firstFrom}` }] : []),
          { label: "/feed", cmd: "/feed" },
          { label: "/trending", cmd: "/trending" },
        ],
      };
    },
  },

  read: {
    description: "read a specific cast",
    usage: "/read 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /read 0xhash" });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching cast ${hash.slice(0, 10)}...` });
      const cast = await nshellApi("cast", { hash });
      if (!cast) {
        ctx.addLine({ type: "error", content: "cast not found." });
        return {};
      }
      const author = cast.author || "unknown";
      const badge = cast.authorBadge ? " ⚡" : "";
      const lines = [
        `@${author}${badge}`,
        ``,
        `  ${cast.text || "(no text)"}`,
        ``,
        `  likes    ${cast.likes ?? 0}  recasts ${cast.recasts ?? 0}  replies ${cast.replies ?? 0}`,
        `  time     ${formatTimeAgo(cast.timestamp)}`,
      ];
      if (cast.channel) {
        lines.push(`  channel  /${cast.channel}`);
      }
      if (cast.embedCount > 0) {
        lines.push(`  embeds   ${cast.embedCount} (links/media attached)`);
      }
      ctx.addLine({ type: "card", content: lines.join("\n") });
      // Action hints with hash baked in for easy tapping
      ctx.addLine({
        type: "table",
        content: "",
        data: [
          { action: "♡ like", _cmd: `/like ${cast.hash}` },
          { action: "↻ share", _cmd: `/share ${cast.hash}` },
          { action: "↩ reply", _cmd: `/reply ${cast.hash} "` },
          { action: "◎ thread", _cmd: `/thread ${cast.hash}` },
          { action: "@ open", _cmd: `/open @${author}` },
        ],
      });
      return {
        data: [cast],
        suggestions: [
          { label: "thread", cmd: `/thread ${cast.hash}` },
          { label: "reactions", cmd: `/reactions ${cast.hash}` },
          { label: `@${author}`, cmd: `/open @${author}` },
          { label: "save", cmd: `/save ${cast.hash}` },
        ],
      };
    },
  },

  thread: {
    description: "view conversation thread",
    usage: "/thread 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /thread 0xhash" });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching thread ${hash.slice(0, 10)}...` });
      const thread = await nshellApi("conversation", { hash });
      if (!thread || thread.length === 0) {
        ctx.addLine({ type: "info", content: "no conversation found." });
        return { data: [] };
      }
      for (const msg of thread as Record<string, unknown>[]) {
        const indent = "  ".repeat((msg.depth as number) || 0);
        ctx.addLine({
          type: "result",
          content: `${indent}@${msg.author}: ${String(msg.text || "").slice(0, 80)}`,
        });
      }
      showCastHints(ctx);
      return { data: thread };
    },
  },

  castsearch: {
    description: "search casts (not just users)",
    usage: "/castsearch <query>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.addLine({ type: "error", content: "usage: /castsearch <query>" });
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  operators: use quotes for exact match" });
        ctx.addLine({ type: "info", content: '  example: /castsearch "base chain"' });
        ctx.addLine({ type: "info", content: "  example: /castsearch ethereum from:vitalik" });
        return {};
      }
      const limit = ctx.isPro ? 10 : 5;
      ctx.addLine({ type: "info", content: `searching casts for "${query}"...` });
      const casts = await nshellApi("cast-search", { query, limit: String(limit) });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no results found. try a different query." });
        return { data: [] };
      }
      ctx.addLine({
        type: "table",
        content: "",
        data: casts.map((c: Record<string, unknown>) => ({
          author: `@${c.author}`,
          ...(c.authorBadge ? { "⚡": "⚡" } : {}),
          text: trunc(c.text, 60, c.embedCount as number),
          likes: c.likes,
          ...(c.channel ? { channel: `/${c.channel}` } : {}),
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      lastResultData = casts;
      lastResultOffset = casts.length;
      showCastHints(ctx);
      if (!ctx.isPro && casts.length >= limit) {
        showUpgradeHint(ctx, limit, "10+", "castsearch");
      }
      ctx.addLine({ type: "info", content: "  /castsearch <query> | /export csv" });
      const firstCsHash = casts[0]?.hash ? String(casts[0].hash) : null;
      return {
        data: casts,
        suggestions: [
          { label: "filter", cmd: "/filter " },
          { label: "export csv", cmd: "/export csv" },
          ...(firstCsHash ? [{ label: "read top", cmd: `/read ${firstCsHash}` }] : []),
        ],
      };
    },
  },

  open: {
    description: "open user or cast in farcaster",
    usage: "/open @user | /open 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.addLine({ type: "error", content: "usage: /open @user or /open 0xhash" });
        return {};
      }
      try {
        if (target.startsWith("@") || !target.startsWith("0x")) {
          const username = target.replace(/^@/, "");
          const user = await nshellApi("whois", { username });
          if (!user) {
            ctx.addLine({ type: "error", content: `user @${username} not found.` });
            return {};
          }
          await sdk.actions.viewProfile({ fid: user.fid });
          ctx.addLine({ type: "result", content: `opened @${username} profile.` });
        } else {
          await sdk.actions.viewCast({ hash: target });
          ctx.addLine({ type: "result", content: `opened cast ${target.slice(0, 10)}...` });
        }
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  follow: {
    description: "open a user's profile to follow",
    usage: "/follow @username",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const target = args.trim().replace(/^@/, "");
      if (!target) {
        ctx.addLine({ type: "error", content: "usage: /follow @username" });
        return {};
      }
      ctx.addLine({ type: "info", content: `looking up @${target}...` });
      try {
        const user = await nshellApi("whois", { username: target });
        if (!user) {
          ctx.addLine({ type: "error", content: `user @${target} not found.` });
          return {};
        }
        await sdk.actions.viewProfile({ fid: user.fid });
        ctx.addLine({ type: "result", content: `opened @${target} — follow from their profile.` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open profile. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  reply: {
    description: "reply to a cast",
    usage: '/reply 0xhash "text"',
    tier: "pro",
    proHint: "lets you reply to casts",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "reply")) return {};
      const match = args.match(/^(0x[a-fA-F0-9]+)\s+["']?(.*?)["']?$/);
      if (!match) {
        ctx.addLine({ type: "error", content: 'usage: /reply 0xhash "your reply"' });
        return {};
      }
      const [, parent, text] = match;
      if (!text.trim()) {
        ctx.addLine({ type: "error", content: "reply text cannot be empty." });
        return {};
      }
      try {
        await sdk.actions.composeCast({ text: `${text.trim()}\n\nvia ${APP_URL}`, parent: { type: "cast", hash: parent } });
        ctx.addLine({ type: "result", content: "reply compose window opened." });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  send: {
    description: "send tokens to a user",
    usage: "/send @user 5 USDC",
    tier: "pro",
    proHint: "lets you send tokens to users",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "send")) return {};
      const match = args.match(/^@?(\S+)\s+([\d.]+)\s+(\S+)$/i);
      if (!match) {
        ctx.addLine({ type: "error", content: "usage: /send @user 5 USDC" });
        return {};
      }
      const [, username, amount, tokenName] = match;
      const tokenKey = tokenName.toLowerCase();
      const tokenUri = TOKEN_MAP[tokenKey];
      if (!tokenUri) {
        ctx.addLine({ type: "error", content: `unknown token: ${tokenName}. supported: ${Object.keys(TOKEN_MAP).join(", ")}` });
        return {};
      }
      ctx.addLine({ type: "info", content: `resolving @${username}...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      try {
        await sdk.actions.sendToken({
          recipientFid: user.fid,
          token: tokenUri,
          amount,
        });
        ctx.addLine({ type: "result", content: `send ${amount} ${tokenName.toUpperCase()} to @${username} — window opened.` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open send. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  swap: {
    description: "swap tokens",
    usage: "/swap 100 USDC ETH",
    tier: "pro",
    proHint: "lets you swap tokens directly",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "swap")) return {};
      const match = args.match(/^([\d.]+)\s+(\S+)\s+(\S+)$/i);
      if (!match) {
        ctx.addLine({ type: "error", content: "usage: /swap 100 USDC ETH" });
        return {};
      }
      const [, amount, sellName, buyName] = match;
      const sellKey = sellName.toLowerCase();
      const buyKey = buyName.toLowerCase();
      const sellUri = TOKEN_MAP[sellKey];
      const buyUri = TOKEN_MAP[buyKey];
      if (!sellUri) {
        ctx.addLine({ type: "error", content: `unknown sell token: ${sellName}. supported: ${Object.keys(TOKEN_MAP).join(", ")}` });
        return {};
      }
      if (!buyUri) {
        ctx.addLine({ type: "error", content: `unknown buy token: ${buyName}. supported: ${Object.keys(TOKEN_MAP).join(", ")}` });
        return {};
      }
      try {
        await sdk.actions.swapToken({
          sellToken: sellUri,
          buyToken: buyUri,
          sellAmount: amount,
        });
        ctx.addLine({ type: "result", content: `swap ${amount} ${sellName.toUpperCase()} → ${buyName.toUpperCase()} — window opened.` });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open swap. make sure you're in the farcaster app." });
      }
      return {};
    },
  },

  sort: {
    description: "sort piped data",
    usage: "/sort <field> [asc|desc]",
    tier: "pro",
    proHint: "sorts piped data by any field",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "sort")) return {};
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data to sort. pipe data into this command." });
        return {};
      }
      const parts = args.trim().split(/\s+/);
      const field = parts[0];
      const order = parts[1]?.toLowerCase() === "desc" ? "desc" : "asc";
      if (!field) {
        ctx.addLine({ type: "error", content: "usage: /sort <field> [asc|desc]" });
        return {};
      }
      const sorted = [...pipeData].sort((a, b) => {
        const va = (a as Record<string, unknown>)[field];
        const vb = (b as Record<string, unknown>)[field];
        if (typeof va === "number" && typeof vb === "number") {
          return order === "asc" ? va - vb : vb - va;
        }
        const sa = String(va ?? "");
        const sb = String(vb ?? "");
        return order === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
      ctx.addLine({ type: "info", content: `sorted ${sorted.length} items by ${field} (${order})` });
      if (sorted.length > 0 && typeof sorted[0] === "object") {
        ctx.addLine({ type: "table", content: "", data: sorted as Record<string, unknown>[] });
      }
      return { data: sorted };
    },
  },

  head: {
    description: "first N items from piped data",
    usage: "/head <n>",
    tier: "pro",
    proHint: "shows first N items from results",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "head")) return {};
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data. pipe data into this command." });
        return {};
      }
      const n = parseInt(args.trim()) || 5;
      const sliced = pipeData.slice(0, n);
      ctx.addLine({ type: "info", content: `showing first ${sliced.length} of ${pipeData.length}` });
      if (sliced.length > 0 && typeof sliced[0] === "object") {
        ctx.addLine({ type: "table", content: "", data: sliced as Record<string, unknown>[] });
      }
      return { data: sliced };
    },
  },

  tail: {
    description: "last N items from piped data",
    usage: "/tail <n>",
    tier: "pro",
    proHint: "shows last N items from results",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "tail")) return {};
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data. pipe data into this command." });
        return {};
      }
      const n = parseInt(args.trim()) || 5;
      const sliced = pipeData.slice(-n);
      ctx.addLine({ type: "info", content: `showing last ${sliced.length} of ${pipeData.length}` });
      if (sliced.length > 0 && typeof sliced[0] === "object") {
        ctx.addLine({ type: "table", content: "", data: sliced as Record<string, unknown>[] });
      }
      return { data: sliced };
    },
  },

  count: {
    description: "count items or group by field",
    usage: "/count [field]",
    tier: "pro",
    proHint: "counts and groups piped data",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "count")) return {};
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data. pipe data into this command." });
        return {};
      }
      const field = args.trim();
      if (!field) {
        ctx.addLine({ type: "result", content: `count: ${pipeData.length}` });
        return { data: [{ count: pipeData.length }] };
      }
      const groups: Record<string, number> = {};
      for (const item of pipeData) {
        const val = String((item as Record<string, unknown>)[field] ?? "unknown");
        groups[val] = (groups[val] || 0) + 1;
      }
      const grouped = Object.entries(groups)
        .sort(([, a], [, b]) => b - a)
        .map(([value, count]) => ({ [field]: value, count }));
      ctx.addLine({ type: "info", content: `${pipeData.length} total, ${grouped.length} unique ${field} values` });
      ctx.addLine({ type: "table", content: "", data: grouped });
      return { data: grouped };
    },
  },

  uniq: {
    description: "deduplicate by field",
    usage: "/uniq <field>",
    tier: "pro",
    proHint: "deduplicates piped data",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "uniq")) return {};
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data. pipe data into this command." });
        return {};
      }
      const field = args.trim();
      if (!field) {
        ctx.addLine({ type: "error", content: "usage: /uniq <field>" });
        return {};
      }
      const seen = new Set<string>();
      const unique = pipeData.filter((item) => {
        const val = String((item as Record<string, unknown>)[field] ?? "");
        if (seen.has(val)) return false;
        seen.add(val);
        return true;
      });
      ctx.addLine({ type: "info", content: `unique: ${unique.length}/${pipeData.length} by ${field}` });
      if (unique.length > 0 && typeof unique[0] === "object") {
        ctx.addLine({ type: "table", content: "", data: unique as Record<string, unknown>[] });
      }
      return { data: unique };
    },
  },

  /* ── Bookmarks ── */

  save: {
    description: "bookmark a cast or user",
    usage: "/save 0xhash | /save @user",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.addLine({ type: "error", content: "usage: /save 0xhash or /save @user" });
        return {};
      }
      const bookmarks = getBookmarks();
      if (bookmarks.some((b) => b.target === target)) {
        ctx.addLine({ type: "info", content: `already bookmarked: ${target}` });
        return {};
      }
      bookmarks.push({ target, savedAt: Date.now() });
      saveBookmarks(bookmarks);
      ctx.addLine({ type: "result", content: `bookmarked: ${target}` });
      ctx.addLine({ type: "info", content: `  ${bookmarks.length} total. /bookmarks to view all` });
      return {};
    },
  },

  unsave: {
    description: "remove a bookmark",
    usage: "/unsave 0xhash | /unsave @user",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.addLine({ type: "error", content: "usage: /unsave 0xhash or /unsave @user" });
        return {};
      }
      const bookmarks = getBookmarks();
      const filtered = bookmarks.filter((b) => b.target !== target);
      if (filtered.length === bookmarks.length) {
        ctx.addLine({ type: "info", content: `not bookmarked: ${target}` });
        return {};
      }
      saveBookmarks(filtered);
      ctx.addLine({ type: "result", content: `removed: ${target}` });
      return {};
    },
  },

  bookmarks: {
    description: "list your bookmarks",
    usage: "/bookmarks",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const bookmarks = getBookmarks();
      if (bookmarks.length === 0) {
        ctx.addLine({ type: "info", content: "no bookmarks yet." });
        ctx.addLine({ type: "info", content: "  /save 0xhash or /save @user to bookmark" });
        return {};
      }
      ctx.addLine({ type: "system", content: `━━━ bookmarks (${bookmarks.length}) ━━━` });
      for (const b of bookmarks) {
        const age = Math.round((Date.now() - b.savedAt) / 60000);
        const when = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
        ctx.addLine({ type: "result", content: `  ${b.target}  (${when})` });
      }
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "info", content: "  /open <target> to view | /unsave <target> to remove" });
      return { data: bookmarks };
    },
  },

  /* ── Aliases ── */

  alias: {
    description: "create a command shortcut",
    usage: "/alias gm = /cast \"gm\"",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const match = args.match(/^(\S+)\s*=\s*(.+)$/);
      if (!match) {
        ctx.addLine({ type: "error", content: 'usage: /alias gm = /cast "gm"' });
        return {};
      }
      const [, name, command] = match;
      const aliases = getAliases();
      aliases[name.toLowerCase()] = command.trim();
      saveAliases(aliases);
      ctx.addLine({ type: "result", content: `alias set: /${name} → ${command.trim()}` });
      return {};
    },
  },

  unalias: {
    description: "remove an alias",
    usage: "/unalias gm",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const name = args.trim().toLowerCase();
      if (!name) {
        ctx.addLine({ type: "error", content: "usage: /unalias <name>" });
        return {};
      }
      const aliases = getAliases();
      if (!aliases[name]) {
        ctx.addLine({ type: "info", content: `no alias: ${name}` });
        return {};
      }
      delete aliases[name];
      saveAliases(aliases);
      ctx.addLine({ type: "result", content: `removed alias: ${name}` });
      return {};
    },
  },

  aliases: {
    description: "list your aliases",
    usage: "/aliases",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const aliases = getAliases();
      const entries = Object.entries(aliases);
      if (entries.length === 0) {
        ctx.addLine({ type: "info", content: "no aliases set." });
        ctx.addLine({ type: "info", content: '  /alias gm = /cast "gm" to create one' });
        return {};
      }
      ctx.addLine({ type: "system", content: `━━━ aliases (${entries.length}) ━━━` });
      for (const [name, cmd] of entries) {
        ctx.addLine({ type: "result", content: `  /${name}  →  ${cmd}` });
      }
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "info", content: "  /unalias <name> to remove" });
      return {};
    },
  },
  /* ── AI: /ask ── */
  ask: {
    description: "ask the AI anything",
    usage: "/ask <question>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.addLine({ type: "error", content: "usage: /ask <question>" });
        ctx.addLine({ type: "info", content: '  example: /ask what is farcaster' });
        return {};
      }

      // Rate limit: free 5/day, pro 50/day
      const limit = ctx.isPro ? 50 : 5;
      const quota = getAiQuota();
      if (quota.count >= limit) {
        trackEvent("ai_limit_hit", ctx, { command: "ask" });
        ctx.addLine({ type: "error", content: `daily AI limit reached (${limit}/${limit}).` });
        if (!ctx.isPro) {
          ctx.addLine({ type: "info", content: "  upgrade for 50 AI queries/day — /upgrade" });
        } else {
          ctx.addLine({ type: "info", content: "  limit resets at midnight." });
        }
        return {};
      }

      ctx.addLine({ type: "info", content: "thinking..." });
      trackEvent("ai_query", ctx, { command: "ask" });

      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            username: ctx.user?.username,
            fid: ctx.user?.fid,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          ctx.addLine({ type: "error", content: data.error || "AI unavailable. try again in a moment." });
          return {};
        }

        incrementAiQuota();
        const remaining = limit - (quota.count + 1);

        ctx.addLine({ type: "system", content: "━━━ nSh3// AI ━━━" });
        // Split answer into lines for terminal feel
        const lines = data.answer.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          ctx.addLine({ type: "result", content: `  ${line}` });
        }
        ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━" });
        ctx.addLine({ type: "info", content: `  ${remaining} queries remaining today` });
      } catch {
        ctx.addLine({ type: "error", content: "AI unavailable. try again in a moment." });
      }
      return {};
    },
  },

  /* ── History: /history ── */
  history: {
    description: "show recent commands",
    usage: "/history [n] | /history search <query>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const h = getHistory();
      if (h.length === 0) {
        ctx.addLine({ type: "info", content: "no history yet. start typing commands!" });
        return {};
      }
      // Search mode
      if (args.trim().toLowerCase().startsWith("search ")) {
        const query = args.trim().slice(7).toLowerCase();
        if (!query) {
          ctx.addLine({ type: "error", content: "usage: /history search <query>" });
          return {};
        }
        const filtered = h.filter(cmd => cmd.toLowerCase().includes(query));
        if (filtered.length === 0) {
          ctx.addLine({ type: "info", content: `no history matching "${query}".` });
          return {};
        }
        ctx.addLine({ type: "system", content: `━━━ history search: "${query}" (${filtered.length}) ━━━` });
        filtered.slice(0, 20).forEach((cmd, i) => {
          ctx.addLine({ type: "result", content: `  ${String(i + 1).padStart(3)}  ${cmd}` });
        });
        ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" });
        return {};
      }
      const n = parseInt(args.trim()) || 20;
      const display = h.slice(0, n);
      ctx.addLine({ type: "system", content: `━━━ history (last ${display.length}) ━━━` });
      display.forEach((cmd, i) => {
        ctx.addLine({ type: "result", content: `  ${String(i + 1).padStart(3)}  ${cmd}` });
      });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "info", content: "  use ↑/↓ keys to recall | /history search <query>" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" });
      return {};
    },
  },

  /* ── Trial: /trial ── */
  trial: {
    description: "claim free 24h Pro trial",
    usage: "/trial",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (ctx.isPro) {
        ctx.addLine({ type: "info", content: "you already have Pro active." });
        return {};
      }
      if (!ctx.address) {
        ctx.addLine({ type: "error", content: "no wallet connected. connect via farcaster to claim trial." });
        return {};
      }

      ctx.addLine({ type: "info", content: "claiming trial..." });
      trackEvent("trial_claimed", ctx, { command: "trial" });

      try {
        const res = await fetch("/api/claim-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: ctx.address,
            username: ctx.user?.username || "",
            fid: ctx.user?.fid || 0,
          }),
        });
        const data = await res.json();

        if (data.ok) {
          try { localStorage.setItem("nshell-trial-used", "1"); } catch {}
          ctx.addLine({ type: "system", content: "━━━ trial activated ━━━" });
          ctx.addLine({ type: "result", content: "  24h Pro trial is now active." });
          ctx.addLine({ type: "result", content: "  all Pro commands unlocked for 24 hours." });
          ctx.addLine({ type: "info", content: "" });
          ctx.addLine({ type: "info", content: "  try: /feed /notifications /castsearch /ask" });
          ctx.addLine({ type: "info", content: `  after trial: /upgrade for ${PROMO.sale}` });
          ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━" });
        } else {
          ctx.addLine({ type: "error", content: data.error || "couldn't claim trial. try again." });
          if (data.error?.includes("already")) {
            ctx.addLine({ type: "info", content: `  trial already used. /upgrade for ${PROMO.sale}` });
          }
        }
      } catch {
        ctx.addLine({ type: "error", content: "couldn't claim trial. try again in a moment." });
      }
      return {};
    },
  },
  discover: {
    description: "daily curated discovery",
    usage: "/discover",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.addLine({ type: "system", content: "━━━ discover ━━━" });
      ctx.addLine({ type: "info", content: "" });

      // Use cached trending data
      try {
        const [casts, channels] = await Promise.all([
          nshellApi("trending", { limit: "10", time_window: "6h" }),
          nshellApi("trending-channels", { time_window: "1d", limit: "10" }),
        ]);

        // Hourly rotation seed
        const hourSeed = Math.floor(Date.now() / 3600000);

        // Hot cast
        if (casts && casts.length > 0) {
          const castIdx = hourSeed % casts.length;
          const hotCast = casts[castIdx] as Record<string, unknown>;
          const badge = hotCast.authorBadge ? " ⚡" : "";
          ctx.addLine({ type: "result", content: "  ── hot cast ──" });
          ctx.addLine({
            type: "card",
            content: [
              `@${hotCast.author}${badge}`,
              ``,
              `  ${String(hotCast.text || "").slice(0, 120)}`,
              ``,
              `  likes ${hotCast.likes ?? 0}  recasts ${hotCast.recasts ?? 0}`,
            ].join("\n"),
          });
          ctx.addLine({
            type: "table",
            content: "",
            data: [
              { action: "read", _cmd: `/read ${hotCast.hash}` },
              { action: "like", _cmd: `/like ${hotCast.hash}` },
            ],
          });
          ctx.addLine({ type: "info", content: "" });
        }

        // Channel spotlight
        if (channels && channels.length > 0) {
          const chIdx = (hourSeed + 3) % channels.length;
          const ch = channels[chIdx] as Record<string, unknown>;
          ctx.addLine({ type: "result", content: "  ── channel spotlight ──" });
          ctx.addLine({ type: "result", content: `  /${ch.id} — ${String(ch.name || "").slice(0, 40)}` });
          ctx.addLine({
            type: "table",
            content: "",
            data: [{ action: `/channel ${ch.id}`, _cmd: `/channel ${ch.id}` }],
          });
          ctx.addLine({ type: "info", content: "" });
        }

        // User to follow (from trending cast authors)
        if (casts && casts.length > 1) {
          const userIdx = (hourSeed + 7) % casts.length;
          const userCast = casts[userIdx] as Record<string, unknown>;
          ctx.addLine({ type: "result", content: "  ── user to follow ──" });
          ctx.addLine({
            type: "table",
            content: "",
            data: [
              { action: `@${userCast.author}`, _cmd: `/open @${userCast.author}` },
              { action: "follow", _cmd: `/follow @${userCast.author}` },
            ],
          });
        }
      } catch {
        ctx.addLine({ type: "error", content: "couldn't fetch discovery data. try again." });
      }

      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━" });
      return {
        suggestions: [
          { label: "/trending", cmd: "/trending" },
          { label: "/channels", cmd: "/channels" },
          { label: "/discover", cmd: "/discover" },
        ],
      };
    },
  },

  /* ── /compare ── */
  compare: {
    description: "compare two users side-by-side",
    usage: "/compare @user1 @user2",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const parts = args.trim().split(/\s+/).map(u => u.replace(/^@/, ""));
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        ctx.addLine({ type: "error", content: "usage: /compare @user1 @user2" });
        return {};
      }
      const [u1, u2] = parts;
      ctx.addLine({ type: "info", content: `comparing @${u1} vs @${u2}...` });
      const [user1, user2] = await Promise.all([
        nshellApi("whois", { username: u1 }),
        nshellApi("whois", { username: u2 }),
      ]);
      if (!user1) { ctx.addLine({ type: "error", content: `user @${u1} not found.` }); return {}; }
      if (!user2) { ctx.addLine({ type: "error", content: `user @${u2} not found.` }); return {}; }

      const f1 = user1.follower_count || 0;
      const f2 = user2.follower_count || 0;
      const fw1 = user1.following_count || 0;
      const fw2 = user2.following_count || 0;
      const r1 = fw1 > 0 ? (f1 / fw1).toFixed(2) : "—";
      const r2 = fw2 > 0 ? (f2 / fw2).toFixed(2) : "—";
      const s1 = user1.experimental?.neynar_user_score ?? "—";
      const s2 = user2.experimental?.neynar_user_score ?? "—";
      const p1 = user1.power_badge ? "yes" : "no";
      const p2 = user2.power_badge ? "yes" : "no";

      // Count wins
      let wins1 = 0, wins2 = 0;
      if (f1 > f2) wins1++; else if (f2 > f1) wins2++;
      if (Number(r1) > Number(r2)) wins1++; else if (Number(r2) > Number(r1)) wins2++;
      if (Number(s1) > Number(s2)) wins1++; else if (Number(s2) > Number(s1)) wins2++;
      if (p1 === "yes" && p2 !== "yes") wins1++; else if (p2 === "yes" && p1 !== "yes") wins2++;
      if (fw1 < fw2) wins1++; else if (fw2 < fw1) wins2++; // lower following = more selective

      const pad = (v: string, w: number) => v.padStart(w);
      const lines = [
        `@${u1} vs @${u2}`,
        `  followers   ${pad(fmt(f1), 8)}  |  ${fmt(f2)}`,
        `  following   ${pad(fmt(fw1), 8)}  |  ${fmt(fw2)}`,
        `  ratio       ${pad(String(r1), 8)}  |  ${r2}`,
        `  score       ${pad(String(s1), 8)}  |  ${s2}`,
        `  power       ${pad(p1, 8)}  |  ${p2}`,
        ``,
        `  verdict: ${wins1 > wins2 ? `@${u1} leads ${wins1} of 5` : wins2 > wins1 ? `@${u2} leads ${wins2} of 5` : "dead even"}`,
      ];
      ctx.addLine({ type: "card", content: lines.join("\n") });
      return {
        data: [user1, user2],
        suggestions: [
          { label: "mutual", cmd: `/mutual @${u1}` },
          { label: `@${u1}`, cmd: `/whois @${u1}` },
          { label: `@${u2}`, cmd: `/whois @${u2}` },
        ],
      };
    },
  },

  /* ── /top ── */
  top: {
    description: "your top 5 casts by engagement",
    usage: "/top",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      ctx.addLine({ type: "info", content: "fetching your casts..." });
      const casts = await nshellApi("user-casts", { fid: String(ctx.user.fid), limit: "25" });
      if (!casts || casts.length === 0) {
        ctx.addLine({ type: "info", content: "no casts found." });
        return { data: [] };
      }
      casts.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (((b.likes as number) || 0) + ((b.recasts as number) || 0)) -
        (((a.likes as number) || 0) + ((a.recasts as number) || 0))
      );
      const top5 = casts.slice(0, 5);
      ctx.addLine({
        type: "table",
        content: "",
        data: top5.map((c: Record<string, unknown>, i: number) => ({
          "#": i + 1,
          text: trunc(c.text, 50, c.embedCount as number),
          likes: c.likes,
          recasts: c.recasts,
          time: formatTimeAgo(c.timestamp),
          _hash: String(c.hash || ""),
        })),
      });
      ctx.addLine({ type: "info", content: "  free: top 5 · /popular for full analysis" });
      return {
        data: top5,
        suggestions: [
          { label: "popular", cmd: `/popular @${ctx.user.username}` },
          { label: "casts", cmd: `/casts @${ctx.user.username}` },
          { label: "/stats", cmd: "/stats" },
        ],
      };
    },
  },

  /* ── /pin ── */
  pin: {
    description: "pin a command to quick bar",
    usage: "/pin /command",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const cmd = args.trim();
      if (!cmd) {
        ctx.addLine({ type: "error", content: "usage: /pin /command" });
        return {};
      }
      const cmdName = cmd.replace(/^\//, "").split(/\s/)[0]?.toLowerCase();
      if (!COMMANDS[cmdName]) {
        ctx.addLine({ type: "error", content: `unknown command: ${cmd}` });
        return {};
      }
      const pins = getPins();
      if (pins.includes(cmd)) {
        ctx.addLine({ type: "info", content: `already pinned: ${cmd}` });
        return {};
      }
      if (pins.length >= 3) {
        ctx.addLine({ type: "error", content: "max 3 pins. /unpin one first." });
        ctx.addLine({ type: "info", content: `  current: ${pins.join(", ")}` });
        return {};
      }
      pins.push(cmd);
      savePins(pins);
      ctx.addLine({ type: "result", content: `pinned: ${cmd}` });
      ctx.addLine({ type: "info", content: `  ${pins.length}/3 pins. appears in quick bar.` });
      return {};
    },
  },

  /* ── /unpin ── */
  unpin: {
    description: "remove a pinned command",
    usage: "/unpin /command",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const cmd = args.trim();
      if (!cmd) {
        ctx.addLine({ type: "error", content: "usage: /unpin /command" });
        return {};
      }
      const pins = getPins();
      const filtered = pins.filter(p => p !== cmd);
      if (filtered.length === pins.length) {
        ctx.addLine({ type: "info", content: `not pinned: ${cmd}` });
        return {};
      }
      savePins(filtered);
      ctx.addLine({ type: "result", content: `unpinned: ${cmd}` });
      return {};
    },
  },

  /* ── /pins ── */
  pins: {
    description: "list pinned commands",
    usage: "/pins",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const pins = getPins();
      if (pins.length === 0) {
        ctx.addLine({ type: "info", content: "no pins. /pin /command to add (max 3)." });
        return {};
      }
      ctx.addLine({ type: "system", content: `━━━ pins (${pins.length}/3) ━━━` });
      for (const p of pins) {
        ctx.addLine({ type: "result", content: `  ${p}` });
      }
      ctx.addLine({ type: "info", content: "  /unpin /command to remove" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━" });
      return {};
    },
  },

  /* ── /draft ── */
  draft: {
    description: "save a cast draft",
    usage: '/draft "your idea"',
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const text = args.replace(/^["']|["']$/g, "").trim();
      if (!text) {
        ctx.addLine({ type: "error", content: 'usage: /draft "your cast idea"' });
        return {};
      }
      const drafts = getDrafts();
      if (drafts.length >= 20) {
        ctx.addLine({ type: "error", content: "max 20 drafts. /undraft # to remove one first." });
        return {};
      }
      drafts.push({ text, savedAt: Date.now() });
      saveDrafts(drafts);
      ctx.addLine({ type: "result", content: `draft saved: "${trunc(text, 50)}"` });
      ctx.addLine({ type: "info", content: `  ${drafts.length}/20 drafts. /drafts to view all` });
      return {};
    },
  },

  /* ── /drafts ── */
  drafts: {
    description: "list cast drafts",
    usage: "/drafts",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const drafts = getDrafts();
      if (drafts.length === 0) {
        ctx.addLine({ type: "info", content: "no drafts yet." });
        ctx.addLine({ type: "info", content: '  /draft "your idea" to save one' });
        return {};
      }
      ctx.addLine({ type: "system", content: `━━━ drafts (${drafts.length}) ━━━` });
      ctx.addLine({
        type: "table",
        content: "",
        data: drafts.map((d, i) => ({
          "#": i + 1,
          text: trunc(d.text, 40),
          saved: formatTimeAgo(d.savedAt),
          _cmd: `/cast "${d.text}"`,
        })),
      });
      ctx.addLine({ type: "info", content: "  tap draft to compose · /undraft # to remove" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━" });
      return {};
    },
  },

  /* ── /undraft ── */
  undraft: {
    description: "remove a draft by number",
    usage: "/undraft <#>",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const idx = parseInt(args.trim());
      if (!idx || idx < 1) {
        ctx.addLine({ type: "error", content: "usage: /undraft <#> (1-based index from /drafts)" });
        return {};
      }
      const drafts = getDrafts();
      if (idx > drafts.length) {
        ctx.addLine({ type: "error", content: `draft #${idx} not found. you have ${drafts.length} drafts.` });
        return {};
      }
      const removed = drafts.splice(idx - 1, 1)[0];
      saveDrafts(drafts);
      ctx.addLine({ type: "result", content: `removed draft #${idx}: "${trunc(removed.text, 40)}"` });
      return {};
    },
  },

  /* ── /analytics (pro) ── */
  analytics: {
    description: "your growth dashboard",
    usage: "/analytics",
    tier: "pro",
    proHint: "shows your growth analytics & engagement",
    handler: async (_args, _pipe, ctx) => {
      if (!requirePro(ctx, "analytics")) return {};
      if (!ctx.user?.fid) {
        ctx.addLine({ type: "error", content: "not logged in. connect via farcaster." });
        return {};
      }
      ctx.addLine({ type: "info", content: "building analytics..." });
      const [user, casts] = await Promise.all([
        nshellApi("user-by-fid", { fid: String(ctx.user.fid) }),
        nshellApi("user-casts", { fid: String(ctx.user.fid), limit: "25" }),
      ]);
      if (!user) {
        ctx.addLine({ type: "error", content: "couldn't load your profile." });
        return {};
      }
      const followers = user.follower_count || 0;
      // Save today's snapshot
      saveAnalyticsSnapshot(followers);
      const snaps = getAnalyticsSnapshots();

      // Compute deltas
      const today = new Date().toISOString().slice(0, 10);
      const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const snap7 = snaps.find(s => s.date <= d7);
      const snap30 = snaps.find(s => s.date <= d30);
      const delta7 = snap7 ? followers - snap7.followers : null;
      const delta30 = snap30 ? followers - snap30.followers : null;

      // Engagement rate
      const castArr = (casts || []) as Record<string, unknown>[];
      const totalLikes = castArr.reduce((sum: number, c) => sum + ((c.likes as number) || 0), 0);
      const engRate = followers > 0 && castArr.length > 0 ? ((totalLikes / castArr.length) / followers * 100).toFixed(2) : "—";

      // Casts in last 7d
      const weekAgo = Date.now() - 7 * 86400000;
      const recentCasts = castArr.filter(c => {
        const ts = c.timestamp as number;
        return ts && (ts > weekAgo / 1000 || ts > weekAgo);
      }).length;

      // Top channel
      const channelCounts: Record<string, number> = {};
      for (const c of castArr) {
        const ch = c.channel as string;
        if (ch) channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      }
      const topChannel = Object.entries(channelCounts).sort(([, a], [, b]) => b - a)[0];

      const lines = [
        `@${user.username} — growth dashboard`,
        ``,
        `  followers    ${fmt(followers)}`,
        `  7d delta     ${delta7 !== null ? (delta7 >= 0 ? "+" : "") + fmt(delta7) : "tracking..."}`,
        `  30d delta    ${delta30 !== null ? (delta30 >= 0 ? "+" : "") + fmt(delta30) : "tracking..."}`,
        `  eng rate     ${engRate}%`,
        `  casts (7d)   ${recentCasts}`,
        `  top channel  ${topChannel ? `/${topChannel[0]} (${topChannel[1]} casts)` : "—"}`,
      ];
      if (snaps.length < 2) {
        lines.push(``, `  come back daily to track your growth`);
      }
      ctx.addLine({ type: "card", content: lines.join("\n") });
      return {
        suggestions: [
          { label: "popular", cmd: `/popular @${ctx.user.username}` },
          { label: "/stats", cmd: "/stats" },
          { label: "/feed", cmd: "/feed" },
        ],
      };
    },
  },

  /* ── /watch (pro) ── */
  watch: {
    description: "add user to watchlist",
    usage: "/watch @username",
    tier: "pro",
    proHint: "tracks users you're interested in",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "watch")) return {};
      const username = args.replace(/^@/, "").trim();
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /watch @username" });
        return {};
      }
      const list = getWatchlist();
      if (list.some(w => w.username === username)) {
        ctx.addLine({ type: "info", content: `already watching @${username}` });
        return {};
      }
      if (list.length >= 10) {
        ctx.addLine({ type: "error", content: "max 10 watched users. /unwatch someone first." });
        return {};
      }
      ctx.addLine({ type: "info", content: `looking up @${username}...` });
      const user = await nshellApi("whois", { username });
      if (!user) {
        ctx.addLine({ type: "error", content: `user @${username} not found.` });
        return {};
      }
      list.push({ username, addedAt: Date.now(), lastFollowers: user.follower_count || 0 });
      saveWatchlist(list);
      ctx.addLine({ type: "result", content: `watching @${username} (${fmt(user.follower_count)} followers)` });
      ctx.addLine({ type: "info", content: `  ${list.length}/10 watched. /watchlist to see all` });
      return {};
    },
  },

  /* ── /unwatch (pro) ── */
  unwatch: {
    description: "remove from watchlist",
    usage: "/unwatch @username",
    tier: "pro",
    proHint: "removes a user from your watchlist",
    handler: async (args, _pipe, ctx) => {
      if (!requirePro(ctx, "unwatch")) return {};
      const username = args.replace(/^@/, "").trim();
      if (!username) {
        ctx.addLine({ type: "error", content: "usage: /unwatch @username" });
        return {};
      }
      const list = getWatchlist();
      const filtered = list.filter(w => w.username !== username);
      if (filtered.length === list.length) {
        ctx.addLine({ type: "info", content: `not watching @${username}` });
        return {};
      }
      saveWatchlist(filtered);
      ctx.addLine({ type: "result", content: `unwatched @${username}` });
      return {};
    },
  },

  /* ── /watchlist (pro) ── */
  watchlist: {
    description: "your tracked users",
    usage: "/watchlist",
    tier: "pro",
    proHint: "shows users you're tracking with updates",
    handler: async (_args, _pipe, ctx) => {
      if (!requirePro(ctx, "watchlist")) return {};
      const list = getWatchlist();
      if (list.length === 0) {
        ctx.addLine({ type: "info", content: "watchlist empty. /watch @user to add someone." });
        return {};
      }
      ctx.addLine({ type: "info", content: `fetching ${list.length} watched users...` });
      const results = await Promise.all(list.map(async (w) => {
        try {
          const user = await nshellApi("whois", { username: w.username });
          const currentFollowers = user?.follower_count || 0;
          const delta = w.lastFollowers !== undefined ? currentFollowers - w.lastFollowers : null;
          w.lastFollowers = currentFollowers;
          return {
            user: `@${w.username}`,
            followers: fmt(currentFollowers),
            delta: delta !== null ? (delta >= 0 ? "+" : "") + fmt(delta) : "—",
            added: formatTimeAgo(w.addedAt),
          };
        } catch {
          return { user: `@${w.username}`, followers: "error", delta: "—", added: formatTimeAgo(w.addedAt) };
        }
      }));
      const rows = results as Record<string, unknown>[];
      saveWatchlist(list); // save updated follower counts
      ctx.addLine({ type: "table", content: "", data: rows });
      ctx.addLine({ type: "info", content: "  /unwatch @user to remove | tap user to view" });
      const firstThree = list.slice(0, 3).map(w => ({ label: `@${w.username}`, cmd: `/whois @${w.username}` }));
      return {
        data: rows,
        suggestions: firstThree,
      };
    },
  },

  /* ── /digest (pro) ── */
  digest: {
    description: "AI daily summary of farcaster",
    usage: "/digest",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      // Check AI quota
      const limit = ctx.isPro ? 50 : 5;
      const quota = getAiQuota();
      if (quota.count >= limit) {
        ctx.addLine({ type: "error", content: `daily AI limit reached (${limit}/${limit}).` });
        ctx.addLine({ type: "info", content: "  limit resets at midnight." });
        return {};
      }
      ctx.addLine({ type: "info", content: "building your daily digest..." });
      try {
        const [trending, feedData] = await Promise.all([
          nshellApi("trending", { limit: "10", time_window: "24h" }),
          ctx.user?.fid ? nshellApi("feed", { fid: String(ctx.user.fid), limit: "10" }) : Promise.resolve([]),
        ]);
        const allCasts = [...(trending || []), ...(feedData || [])];
        const condensed = allCasts.slice(0, 20).map((c: Record<string, unknown>) =>
          `@${c.author}: ${String(c.text || "").slice(0, 80)}${c.channel ? ` [/${c.channel}]` : ""}`
        ).join("\n");

        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: `Summarize today's Farcaster in 3 bullets: trending topics, notable people, one action to take. Data:\n${condensed}`,
            username: ctx.user?.username,
            fid: ctx.user?.fid,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          ctx.addLine({ type: "error", content: data.error || "AI unavailable." });
          return {};
        }
        incrementAiQuota();
        ctx.addLine({ type: "system", content: "━━━ daily digest ━━━" });
        const lines = data.answer.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          ctx.addLine({ type: "result", content: `  ${line}` });
        }
        ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━" });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't generate digest. try again." });
      }
      return {
        suggestions: [
          { label: "/feed", cmd: "/feed" },
          { label: "/trending", cmd: "/trending" },
          { label: "/channels", cmd: "/channels" },
        ],
      };
    },
  },

  /* ── /sentiment (pro) ── */
  sentiment: {
    description: "AI sentiment analysis of cast replies",
    usage: "/sentiment 0xhash",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const hash = args.trim();
      if (!hash) {
        ctx.addLine({ type: "error", content: "usage: /sentiment 0xhash" });
        return {};
      }
      // Check AI quota
      const limit = ctx.isPro ? 50 : 5;
      const quota = getAiQuota();
      if (quota.count >= limit) {
        ctx.addLine({ type: "error", content: `daily AI limit reached (${limit}/${limit}).` });
        return {};
      }
      ctx.addLine({ type: "info", content: `analyzing sentiment for ${hash.slice(0, 10)}...` });
      try {
        const thread = await nshellApi("conversation", { hash });
        if (!thread || thread.length === 0) {
          ctx.addLine({ type: "info", content: "no conversation found for this cast." });
          return {};
        }
        const replies = (thread as Record<string, unknown>[])
          .filter(m => (m.depth as number) > 0)
          .slice(0, 20)
          .map(m => `@${m.author}: ${String(m.text || "").slice(0, 100)}`)
          .join("\n");
        if (!replies) {
          ctx.addLine({ type: "info", content: "no replies found to analyze." });
          return {};
        }
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: `Analyze sentiment of these cast replies: overall (positive/neutral/negative), key themes, most insightful reply. 4 lines max.\n\nReplies:\n${replies}`,
            username: ctx.user?.username,
            fid: ctx.user?.fid,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          ctx.addLine({ type: "error", content: data.error || "AI unavailable." });
          return {};
        }
        incrementAiQuota();
        ctx.addLine({ type: "system", content: "━━━ sentiment ━━━" });
        const lines = data.answer.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          ctx.addLine({ type: "result", content: `  ${line}` });
        }
        ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━" });
      } catch {
        ctx.addLine({ type: "error", content: "couldn't analyze sentiment. try again." });
      }
      return {
        suggestions: [
          { label: "read", cmd: `/read ${hash}` },
          { label: "reactions", cmd: `/reactions ${hash}` },
        ],
      };
    },
  },

  /* ── /bulk (pro pipe command) ── */
  bulk: {
    description: "bulk action on piped users",
    usage: "/bulk follow",
    tier: "pro",
    proHint: "bulk follow users from piped data",
    handler: async (args, pipeData, ctx) => {
      if (!requirePro(ctx, "bulk")) return {};
      const action = args.trim().toLowerCase();
      if (action !== "follow") {
        ctx.addLine({ type: "error", content: "usage: /bulk follow (pipe users into it)" });
        ctx.addLine({ type: "info", content: "  example: /trending | /bulk follow" });
        return {};
      }
      if (!pipeData || pipeData.length === 0) {
        ctx.addLine({ type: "error", content: "no data. pipe data into this command." });
        ctx.addLine({ type: "info", content: "  example: /trending | /bulk follow" });
        return {};
      }
      // Extract usernames from piped data
      const usernames: string[] = [];
      for (const item of pipeData) {
        const obj = item as Record<string, unknown>;
        const name = (obj.username || obj.author || "") as string;
        const clean = String(name).replace(/^@/, "").trim();
        if (clean && !usernames.includes(clean)) usernames.push(clean);
      }
      const batch = usernames.slice(0, 10);
      if (batch.length === 0) {
        ctx.addLine({ type: "error", content: "no users found in piped data." });
        return {};
      }
      ctx.addLine({ type: "info", content: `opening ${batch.length} profiles for follow...` });
      let opened = 0;
      for (const username of batch) {
        try {
          const user = await nshellApi("whois", { username });
          if (user) {
            await sdk.actions.viewProfile({ fid: user.fid });
            opened++;
            ctx.addLine({ type: "result", content: `  opened @${username} (${opened}/${batch.length})` });
            // Small delay between opens
            await new Promise(r => setTimeout(r, 300));
          }
        } catch {
          ctx.addLine({ type: "info", content: `  skipped @${username}` });
        }
      }
      ctx.addLine({ type: "result", content: `done. opened ${opened} profiles.` });
      return {};
    },
  },

  /* ── /castoutput ── */
  castoutput: {
    description: "share terminal output as a cast",
    usage: "/castoutput [redact]",
    tier: "free",
    handler: async (args, _pipe, ctx) => {
      const redact = args.trim().toLowerCase() === "redact";
      const recentLines = ctx.getRecentOutput ? ctx.getRecentOutput() : [];
      // Get last command from history
      const h = getHistory();
      const lastCmd = h.length > 0 ? h[0] : "";

      // Build shareable text from recent output
      const textLines = recentLines
        .filter(l => l.type === "result" || l.type === "card" || l.type === "system")
        .map(l => l.content.trim())
        .filter(Boolean)
        .slice(-12);

      if (textLines.length === 0 && !lastCmd) {
        ctx.addLine({ type: "info", content: "no output to share. run a command first." });
        return {};
      }

      let output = textLines.join("\n");
      // Truncate for cast length (320 max minus app url and header)
      if (output.length > 220) output = output.slice(0, 220) + "...";

      if (redact) {
        output = output.replace(/0x[a-fA-F0-9]{6,}/g, "0x••••");
        output = output.replace(/fid\s*:?\s*\d+/gi, "fid ••••");
        output = output.replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, "•.•.•.•");
      }

      const header = lastCmd ? `> ${lastCmd}` : "> nSh3//";
      const castText = `${header}\n\n${output}\n\n${APP_URL}`;

      try {
        await sdk.actions.composeCast({ text: castText });
        ctx.addLine({ type: "result", content: "compose window opened with output." });
        if (redact) {
          ctx.addLine({ type: "info", content: "  wallets & fids redacted" });
        }
      } catch {
        ctx.addLine({ type: "error", content: "couldn't open compose. make sure you're in the farcaster app." });
      }
      return {
        suggestions: [
          { label: "redact", cmd: "/castoutput redact" },
          { label: "/invite", cmd: "/invite" },
        ],
      };
    },
  },

  /* ── /keys ── */
  keys: {
    description: "keyboard shortcuts",
    usage: "/keys",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.addLine({ type: "system", content: "━━━ keyboard shortcuts ━━━" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  TAB          autocomplete command" });
      ctx.addLine({ type: "result", content: "  ↑ / ↓        recall command history" });
      ctx.addLine({ type: "result", content: "  Ctrl+L       clear terminal" });
      ctx.addLine({ type: "result", content: "  Escape       close menus" });
      ctx.addLine({ type: "result", content: "  |            pipe output between commands" });
      ctx.addLine({ type: "result", content: "  long-press   copy cell value" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  tap          cast text → read cast" });
      ctx.addLine({ type: "result", content: "  tap          @username → open profile" });
      ctx.addLine({ type: "result", content: "  tap          /channel → channel info" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━━━━" });
      return {
        suggestions: [
          { label: "/help", cmd: "/help" },
          { label: "/pins", cmd: "/pins" },
          { label: "/aliases", cmd: "/aliases" },
        ],
      };
    },
  },

  changelog: {
    description: "recent updates",
    usage: "/changelog",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.addLine({ type: "system", content: "━━━ changelog ━━━" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  v3.3 — don't gate curiosity" });
      ctx.addLine({ type: "info", content: "  · /feed /notifications /casts /castsearch — now free" });
      ctx.addLine({ type: "info", content: "  · /thread /mutual /digest /sentiment — now free" });
      ctx.addLine({ type: "info", content: "  · ghost text hints (type /whois then space)" });
      ctx.addLine({ type: "info", content: "  · /castoutput — share terminal output as a cast" });
      ctx.addLine({ type: "info", content: "  · protocol ping in header (nerd candy)" });
      ctx.addLine({ type: "info", content: "  · /keys — keyboard shortcuts reference" });
      ctx.addLine({ type: "info", content: "  · pro = power tools only. explore free." });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  v3.2 — UX polish" });
      ctx.addLine({ type: "info", content: "  · tap casts, TAB autocomplete, /popular, cleaner tables" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  v3.1 — bookmarks, aliases, reactions" });
      ctx.addLine({ type: "result", content: "  v3.0 — terminal rewrite, pipes, pro pass" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━" });
      return {
        suggestions: [
          { label: "/help", cmd: "/help" },
          { label: "/trending", cmd: "/trending" },
          { label: "/status", cmd: "/status" },
        ],
      };
    },
  },

  permissions: {
    description: "what nshell touches",
    usage: "/permissions",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.addLine({ type: "system", content: "━━━ nSh3// permissions ━━━" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── APIs called ──" });
      ctx.addLine({ type: "info", content: "  neynar (farcaster data) — profiles, casts, feeds" });
      ctx.addLine({ type: "info", content: "  openai (via /ask) — AI answers, pro only" });
      ctx.addLine({ type: "info", content: "  relay.link (via /swap /send) — onchain transactions" });
      ctx.addLine({ type: "info", content: "  base rpc (via wallet) — read balances, pro pass" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── localStorage keys ──" });
      let keyCount = 0;
      let totalBytes = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("nshell") || k.startsWith("nsc:"))) {
            keyCount++;
            totalBytes += (k.length + (localStorage.getItem(k)?.length || 0)) * 2;
          }
        }
      } catch {}
      const kb = (totalBytes / 1024).toFixed(1);
      ctx.addLine({ type: "info", content: `  ${keyCount} keys, ~${kb} KB` });
      ctx.addLine({ type: "info", content: "  usage stats, history, bookmarks, aliases, pins, drafts," });
      ctx.addLine({ type: "info", content: "  watchlist, cache, preferences, trial/onboarding flags" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── Firebase events ──" });
      ctx.addLine({ type: "info", content: "  session_start, pro_gate_hit, upgrade_viewed," });
      ctx.addLine({ type: "info", content: "  limit_hit, upsell_shown, ttf_command" });
      ctx.addLine({ type: "info", content: "  all events are anonymous counts — no cast content stored" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── wallet actions ──" });
      ctx.addLine({ type: "info", content: "  USDC approve + buy (Pro Pass only)" });
      ctx.addLine({ type: "info", content: "  /send and /swap route through relay.link" });
      ctx.addLine({ type: "info", content: "  all txns require your explicit approval" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── what we never do ──" });
      ctx.addLine({ type: "info", content: "  no server-side storage of your data" });
      ctx.addLine({ type: "info", content: "  no tracking pixels, no ad networks" });
      ctx.addLine({ type: "info", content: "  no private key access, no background transactions" });
      ctx.addLine({ type: "info", content: "  no selling data to third parties" });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━━━━━━━━━" });
      return {
        suggestions: [
          { label: "/status", cmd: "/status" },
          { label: "/help", cmd: "/help" },
          { label: "/changelog", cmd: "/changelog" },
        ],
      };
    },
  },

  topcmds: {
    description: "your most-used commands",
    usage: "/topcmds",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      const usage = getUsage();
      const entries = Object.entries(usage.cmds).sort(([, a], [, b]) => b - a).slice(0, 15);
      if (entries.length === 0) {
        ctx.addLine({ type: "info", content: "no command history yet. start typing!" });
        return {};
      }
      ctx.addLine({ type: "system", content: "━━━ top commands ━━━" });
      const data = entries.map(([name, count], i) => ({
        "#": String(i + 1),
        command: `/${name}`,
        uses: String(count),
        _cmd: `/${name}`,
      }));
      ctx.addLine({ type: "table", content: "", data });
      ctx.addLine({ type: "info", content: `  ${usage.total} total across ${Math.max(1, Math.ceil((Date.now() - usage.firstSeen) / 86400000))}d` });
      return {
        data,
        suggestions: [
          { label: "/stats", cmd: "/stats" },
          { label: "/history", cmd: "/history" },
          { label: "/trending", cmd: "/trending" },
        ],
      };
    },
  },

  quickstart: {
    description: "guided walkthrough for new users",
    usage: "/quickstart",
    tier: "free",
    handler: async (_args, _pipe, ctx) => {
      ctx.addLine({ type: "system", content: "━━━ quickstart ━━━" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "result", content: "  nshell is a terminal for farcaster." });
      ctx.addLine({ type: "result", content: "  type commands to explore, post, and analyze." });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  1. explore what's trending" });
      ctx.addLine({ type: "info", content: "     see the hottest casts right now." });
      ctx.addLine({ type: "table", content: "", data: [{ action: "try it", _cmd: "/trending" }] });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  2. look up anyone" });
      ctx.addLine({ type: "info", content: "     view any profile, followers, and stats." });
      ctx.addLine({ type: "table", content: "", data: [{ action: "try it", _cmd: "/whois @dwr" }] });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  3. post a cast" });
      ctx.addLine({ type: "info", content: "     compose and publish from the terminal." });
      ctx.addLine({ type: "table", content: "", data: [{ action: "try it", _cmd: '/cast "gm"' }] });
      ctx.addLine({ type: "info", content: "" });

      ctx.addLine({ type: "result", content: "  ── power tips ──" });
      ctx.addLine({ type: "info", content: "  TAB        autocomplete any command" });
      ctx.addLine({ type: "info", content: "  |          pipe results between commands" });
      ctx.addLine({ type: "info", content: "  /pin       pin favorite commands to quick bar" });
      ctx.addLine({ type: "info", content: "  /help      see all 40+ commands" });
      ctx.addLine({ type: "info", content: "" });
      ctx.addLine({ type: "system", content: "━━━━━━━━━━━━━━━━━━" });

      return {
        suggestions: [
          { label: "/trending", cmd: "/trending" },
          { label: "/whois @dwr", cmd: "/whois @dwr" },
          { label: "/help", cmd: "/help" },
        ],
      };
    },
  },
};

// Alias
COMMANDS.h = { ...COMMANDS.help, description: "alias for /help", usage: "/h" };

/* ── Command modes ── */
const COMMAND_MODES: Record<string, "view" | "exec" | "compose"> = {
  // view: read-only lookups
  whois: "view", search: "view", trending: "view", channel: "view",
  followers: "view", following: "view", channels: "view", read: "view",
  discover: "view", compare: "view", top: "view", feed: "view",
  notifications: "view", casts: "view", castsearch: "view", thread: "view",
  mutual: "view", popular: "view", analytics: "view", watchlist: "view",
  reactions: "view", stats: "view", status: "view", profile: "view",
  balances: "view", bookmarks: "view", drafts: "view", aliases: "view",
  pins: "view", history: "view", help: "view", h: "view", keys: "view",
  changelog: "view", permissions: "view", topcmds: "view", quickstart: "view",
  // exec: state-changing actions
  like: "exec", follow: "exec", open: "exec", save: "exec", unsave: "exec",
  watch: "exec", unwatch: "exec", pin: "exec", unpin: "exec",
  alias: "exec", unalias: "exec", send: "exec", swap: "exec",
  upgrade: "exec", pro: "exec", trial: "exec", invite: "exec",
  share: "exec", sharecast: "exec", bulk: "exec", clear: "exec",
  undraft: "exec",
  // compose: creating content
  cast: "compose", reply: "compose", quote: "compose", draft: "compose",
  ask: "compose", digest: "compose", sentiment: "compose", castoutput: "compose",
};

export function getCommandMode(input: string): "view" | "exec" | "compose" | null {
  if (!input.startsWith("/")) return null;
  const cmd = input.replace(/^\//, "").split(/\s/)[0]?.toLowerCase();
  if (!cmd) return null;
  return COMMAND_MODES[cmd] || null;
}

/* ── Bookmark storage ── */
type Bookmark = { target: string; savedAt: number };

function getBookmarks(): Bookmark[] {
  try {
    return JSON.parse(localStorage.getItem("nshell-bookmarks") || "[]");
  } catch { return []; }
}
function saveBookmarks(bookmarks: Bookmark[]) {
  try { localStorage.setItem("nshell-bookmarks", JSON.stringify(bookmarks)); } catch {}
}

/* ── Alias storage ── */
function getAliases(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("nshell-aliases") || "{}");
  } catch { return {}; }
}
function saveAliases(aliases: Record<string, string>) {
  try { localStorage.setItem("nshell-aliases", JSON.stringify(aliases)); } catch {}
}

/* ── Pin storage ── */
export function getPins(): string[] {
  try { return JSON.parse(localStorage.getItem("nshell-pins") || "[]"); } catch { return []; }
}
function savePins(pins: string[]) {
  try { localStorage.setItem("nshell-pins", JSON.stringify(pins)); } catch {}
}

/* ── Draft storage ── */
type Draft = { text: string; savedAt: number };
function getDrafts(): Draft[] {
  try { return JSON.parse(localStorage.getItem("nshell-drafts") || "[]"); } catch { return []; }
}
function saveDrafts(drafts: Draft[]) {
  try { localStorage.setItem("nshell-drafts", JSON.stringify(drafts)); } catch {}
}

/* ── Watchlist storage ── */
type WatchItem = { username: string; addedAt: number; lastFollowers?: number };
function getWatchlist(): WatchItem[] {
  try { return JSON.parse(localStorage.getItem("nshell-watchlist") || "[]"); } catch { return []; }
}
function saveWatchlist(list: WatchItem[]) {
  try { localStorage.setItem("nshell-watchlist", JSON.stringify(list)); } catch {}
}

/* ── Analytics snapshot storage ── */
type AnalyticsSnapshot = { date: string; followers: number };
function getAnalyticsSnapshots(): AnalyticsSnapshot[] {
  try { return JSON.parse(localStorage.getItem("nshell-analytics") || "[]"); } catch { return []; }
}
function saveAnalyticsSnapshot(followers: number) {
  try {
    const snaps = getAnalyticsSnapshots();
    const today = new Date().toISOString().slice(0, 10);
    // Update today's entry or add new
    const idx = snaps.findIndex(s => s.date === today);
    if (idx >= 0) { snaps[idx].followers = followers; }
    else { snaps.push({ date: today, followers }); }
    // Keep max 60 days
    while (snaps.length > 60) snaps.shift();
    localStorage.setItem("nshell-analytics", JSON.stringify(snaps));
  } catch {}
}

/* ── Usage tracking ── */
type UsageData = { total: number; cmds: Record<string, number>; firstSeen: number };

function getUsage(): UsageData {
  try {
    return JSON.parse(localStorage.getItem("nshell-usage") || "null") || { total: 0, cmds: {}, firstSeen: Date.now() };
  } catch { return { total: 0, cmds: {}, firstSeen: Date.now() }; }
}

function trackCommand(cmd: string) {
  _sessionData.cmds++;
  if (_sessionData.cmds === 1) {
    _sessionData.firstCommandAt = Date.now();
    _sessionData.ttfCommand = _sessionData.firstCommandAt - _sessionData.startedAt;
    trackEvent("ttf_command", null, { ttfMs: String(_sessionData.ttfCommand) });
  }
  try {
    const usage = getUsage();
    usage.total++;
    usage.cmds[cmd] = (usage.cmds[cmd] || 0) + 1;
    localStorage.setItem("nshell-usage", JSON.stringify(usage));
  } catch {}
}

/* ── Command history (localStorage) ── */
export function getHistory(): string[] {
  try { return JSON.parse(localStorage.getItem("nshell-history") || "[]"); } catch { return []; }
}
function saveHistory(cmd: string) {
  try {
    const h = getHistory();
    const updated = [cmd, ...h.filter(c => c !== cmd)].slice(0, 100);
    localStorage.setItem("nshell-history", JSON.stringify(updated));
  } catch {}
}

export function getUsageStats(): { total: number; topCmd: string; topCount: number; days: number } {
  const usage = getUsage();
  const entries = Object.entries(usage.cmds).sort(([, a], [, b]) => b - a);
  const [topCmd, topCount] = entries[0] || ["—", 0];
  const days = Math.max(1, Math.ceil((Date.now() - usage.firstSeen) / 86400000));
  return { total: usage.total, topCmd, topCount, days };
}

/* ═══════ PIPE ENGINE ═══════ */

export async function executeCommand(raw: string, ctx: CommandContext): Promise<{ suggestions?: { label: string; cmd: string }[] }> {
  // Resolve user aliases on the first segment (before pipes)
  let resolved = raw;
  const aliases = getAliases();
  const firstCmd = raw.replace(/^\//, "").split(/\s/)[0]?.toLowerCase();
  if (firstCmd && aliases[firstCmd] && !COMMANDS[firstCmd]) {
    resolved = raw.replace(new RegExp(`^/?${firstCmd}`, "i"), aliases[firstCmd]);
    ctx.addLine({ type: "info", content: `alias: /${firstCmd} → ${aliases[firstCmd]}` });
  }

  // Persist to history
  saveHistory(raw);

  // Split by pipe
  const segments = resolved.split(/\s*\|\s*/);
  let pipeData: unknown[] | null = null;
  let lastSuggestions: { label: string; cmd: string }[] | undefined;

  for (const segment of segments) {
    const trimmed = segment.replace(/^\//, "").trim();
    if (!trimmed) continue;

    const spaceIdx = trimmed.indexOf(" ");
    const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

    const cmdKey = cmd.toLowerCase();
    trackCommand(cmdKey);

    // Soft upsell: every 10th command per session for free users
    if (!ctx.isPro && _sessionData.cmds > 0 && _sessionData.cmds % 10 === 0) {
      const usage = getUsage();
      trackEvent("upsell_shown", ctx, { command: cmdKey });
      if (_sessionData.proGateHits >= 2) {
        ctx.addLine({ type: "info", content: `  you tried ${_sessionData.proGateHits} Pro commands this session — /trial to unlock them all` });
      } else if (usage.total >= 30) {
        ctx.addLine({ type: "info", content: `  power user alert: ${usage.total} commands — Pro unlocks everything. /trial for free 24h` });
      } else {
        ctx.addLine({ type: "info", content: `  you've run ${_sessionData.cmds} commands this session. try Pro free for 24h — /trial` });
      }
    }

    // Track only high-value events to minimize Firebase writes
    if (cmdKey === "upgrade") {
      trackEvent("upgrade_viewed", ctx, { command: "upgrade" });
    }

    const command = COMMANDS[cmdKey];
    if (!command) {
      ctx.addLine({ type: "error", content: `unknown command: ${cmd}` });
      const suggestion = suggestCommand(cmd);
      const chips: { label: string; cmd: string }[] = [];
      if (suggestion) {
        const suggestedCmd = args ? `/${suggestion} ${args}` : `/${suggestion}`;
        ctx.addLine({ type: "info", content: `did you mean /${suggestion}?` });
        chips.push({ label: `/${suggestion}${args ? " " + args : ""}`, cmd: suggestedCmd });
      }
      chips.push({ label: "/help", cmd: "/help" });
      return { suggestions: chips };
    }

    try {
      const result = await command.handler(args, pipeData, ctx);
      if (result.data) {
        pipeData = result.data;
      }
      if (result.suggestions) {
        lastSuggestions = result.suggestions;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "something went wrong. try that again.";
      ctx.addLine({ type: "error", content: message });
      return {};
    }
  }

  // First-run walkthrough: post-command guidance for first 3 commands
  try {
    const stepRaw = localStorage.getItem("nshell-walkthrough-step");
    const step = stepRaw ? parseInt(stepRaw, 10) : 0;
    if (step < 3) {
      const nextStep = step + 1;
      localStorage.setItem("nshell-walkthrough-step", String(nextStep));
      if (nextStep === 1) {
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  nice! tap results to dive deeper. try another command:" });
        if (!lastSuggestions || lastSuggestions.length === 0) {
          lastSuggestions = [
            { label: "/trending", cmd: "/trending" },
            { label: "/whois @dwr", cmd: "/whois @dwr" },
            { label: "/channels", cmd: "/channels" },
          ];
        }
      } else if (nextStep === 2) {
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  you're getting it. commands return tappable results + suggestions below." });
      } else if (nextStep === 3) {
        ctx.addLine({ type: "info", content: "" });
        ctx.addLine({ type: "info", content: "  you're ready. /quickstart anytime for a refresher." });
      }
    }
  } catch {}

  return { suggestions: lastSuggestions };
}

export function getCommandNames(): string[] {
  return Object.keys(COMMANDS).filter((k) => k !== "h");
}

export function getCommandMeta(): { name: string; description: string; tier: string }[] {
  return Object.entries(COMMANDS)
    .filter(([k]) => k !== "h")
    .map(([name, def]) => ({
      name,
      description: def.description,
      tier: def.tier || "free",
    }));
}
