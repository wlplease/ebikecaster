import { NextRequest, NextResponse } from "next/server";

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

function neynarHeaders() {
  return {
    accept: "application/json",
    "x-api-key": NEYNAR_API_KEY || "",
  };
}

/* ── Tiered in-memory cache ── */
const cache = new Map<string, { data: unknown; ts: number }>();
const MAX_CACHE = 300;

// TTLs per action (ms) — longer for stable data, shorter for live feeds
const CACHE_TTLS: Record<string, number> = {
  whois:              15 * 60 * 1000,   // 15 min — profiles rarely change
  "user-by-fid":      15 * 60 * 1000,
  channel:            15 * 60 * 1000,
  "search-users":      5 * 60 * 1000,   // 5 min
  trending:            5 * 60 * 1000,   // 5 min
  "trending-channels": 5 * 60 * 1000,
  feed:                3 * 60 * 1000,   // 3 min — more dynamic
  followers:          10 * 60 * 1000,   // 10 min
  following:          10 * 60 * 1000,
  "user-casts":        5 * 60 * 1000,
  cast:               10 * 60 * 1000,   // 10 min — individual cast rarely changes
  conversation:       10 * 60 * 1000,
  reactions:          10 * 60 * 1000,
  "cast-search":       5 * 60 * 1000,
  notifications:       2 * 60 * 1000,   // 2 min — most dynamic
};

function getCached(action: string, key: string): unknown | null {
  const entry = cache.get(key);
  const ttl = CACHE_TTLS[action] ?? 0;
  if (entry && ttl > 0 && Date.now() - entry.ts < ttl) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > MAX_CACHE) {
    const now = Date.now();
    for (const [k, v] of cache) {
      // Evict anything older than 15 min
      if (now - v.ts > 15 * 60 * 1000) cache.delete(k);
    }
    // If still too large, drop oldest 50
    if (cache.size > MAX_CACHE) {
      const entries = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < 50 && i < entries.length; i++) cache.delete(entries[i][0]);
    }
  }
}

async function neynarError(action: string, res: Response): Promise<NextResponse> {
  const errBody = await res.text().catch(() => "");
  console.error(`[nshell:${action}] neynar ${res.status}:`, errBody.slice(0, 200));

  const friendly: Record<string, string> = {
    whois: "couldn't find that user. check the username and try again.",
    trending: "couldn't load trending casts. try again in a moment.",
    followers: "couldn't load followers. try again in a moment.",
    following: "couldn't load following. try again in a moment.",
    channel: "couldn't find that channel. check the name and try again.",
    feed: "couldn't load your feed. try again in a moment.",
    notifications: "couldn't load notifications. try again in a moment.",
    cast: "couldn't load that cast. check the hash and try again.",
    "cast-search": "search is temporarily unavailable. try again in a moment.",
    "search-users": "search is temporarily unavailable. try again in a moment.",
    reactions: "couldn't load reactions. try again in a moment.",
    "user-casts": "couldn't load casts. try again in a moment.",
    conversation: "couldn't load the thread. try again in a moment.",
    "trending-channels": "couldn't load channels. try again in a moment.",
  };

  return NextResponse.json({
    ok: false,
    error: friendly[action] || "something went wrong. try again.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, params } = body as { action: string; params: Record<string, string> };

    if (!NEYNAR_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "neynar api key not configured. set NEYNAR_API_KEY in env." },
        { status: 500 },
      );
    }

    // Check cache — all read actions are cached with per-action TTLs
    const cacheKey = (action in CACHE_TTLS) ? `${action}:${JSON.stringify(params)}` : null;
    if (cacheKey) {
      const cached = getCached(action, cacheKey);
      if (cached !== null) {
        return NextResponse.json({ ok: true, data: cached });
      }
    }

    let result: unknown;

    switch (action) {
      case "whois": {
        const username = (params.username || "").replace(/^@/, "");
        if (!username) {
          return NextResponse.json({ ok: false, error: "usage: /whois @username" });
        }
        const res = await fetch(
          `${NEYNAR_BASE}/user/search?q=${encodeURIComponent(username)}&limit=1`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        result = data.result?.users?.[0] ?? null;
        break;
      }

      case "user-by-fid": {
        const fid = params.fid;
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(`${NEYNAR_BASE}/user/bulk?fids=${fid}`, {
          headers: neynarHeaders(),
        });
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        result = data.users?.[0] ?? null;
        break;
      }

      case "followers": {
        const fid = params.fid;
        const limit = params.limit || "20";
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(`${NEYNAR_BASE}/followers?fid=${fid}&limit=${limit}`, {
          headers: neynarHeaders(),
        });
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const users = (data.result?.users ?? data.users ?? []).map(
          (u: Record<string, unknown>) => {
            const inner = (u.user ?? u) as Record<string, unknown>;
            return {
              fid: inner.fid,
              username: inner.username,
              displayName: inner.display_name,
              followerCount: inner.follower_count,
              powerBadge: inner.power_badge ?? false,
            };
          },
        );
        result = users;
        break;
      }

      case "following": {
        const fid = params.fid;
        const limit = params.limit || "20";
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(`${NEYNAR_BASE}/following?fid=${fid}&limit=${limit}`, {
          headers: neynarHeaders(),
        });
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const users = (data.result?.users ?? data.users ?? []).map(
          (u: Record<string, unknown>) => {
            const inner = (u.user ?? u) as Record<string, unknown>;
            return {
              fid: inner.fid,
              username: inner.username,
              displayName: inner.display_name,
              followerCount: inner.follower_count,
              powerBadge: inner.power_badge ?? false,
            };
          },
        );
        result = users;
        break;
      }

      case "channel": {
        const name = params.name;
        if (!name) return NextResponse.json({ ok: false, error: "usage: /channel <name>" });
        const res = await fetch(
          `${NEYNAR_BASE}/channel?id=${encodeURIComponent(name)}&type=id`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        result = data.channel ?? null;
        break;
      }

      case "trending": {
        const rawLimit = Math.min(parseInt(params.limit || "10"), 10);
        const limit = String(rawLimit);
        const validWindows = ["1h", "6h", "12h", "24h"];
        const timeWindow = validWindows.includes(params.time_window) ? params.time_window : "6h";
        const res = await fetch(`${NEYNAR_BASE}/feed/trending?limit=${limit}&time_window=${timeWindow}`, {
          headers: neynarHeaders(),
        });
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const casts = (data.casts ?? []).map((c: Record<string, unknown>) => {
          const author = c.author as Record<string, unknown> | undefined;
          const reactions = c.reactions as Record<string, unknown> | undefined;
          const embeds = (c.embeds ?? []) as unknown[];
          const ch = c.channel as Record<string, unknown> | undefined;
          return {
            author: author?.username ?? "unknown",
            text: (String(c.text ?? "")).slice(0, 120),
            likes: reactions?.likes_count ?? 0,
            recasts: reactions?.recasts_count ?? 0,
            replies: (c.replies as Record<string, unknown>)?.count ?? 0,
            hash: String(c.hash ?? ""),
            timestamp: c.timestamp ?? "",
            channel: ch?.id ? String(ch.id) : null,
            authorBadge: !!(author?.power_badge),
            embedCount: embeds.length,
          };
        });
        result = casts;
        break;
      }

      case "search-users": {
        const query = params.query;
        if (!query) return NextResponse.json({ ok: false, error: "usage: /search <query>" });
        const res = await fetch(
          `${NEYNAR_BASE}/user/search?q=${encodeURIComponent(query)}&limit=10`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const users = (data.result?.users ?? []).map((u: Record<string, unknown>) => {
          const experimental = u.experimental as Record<string, unknown> | undefined;
          return {
            fid: u.fid,
            username: u.username,
            displayName: u.display_name,
            followerCount: u.follower_count,
            powerBadge: u.power_badge ?? false,
            score: experimental?.neynar_user_score,
          };
        });
        result = users;
        break;
      }

      case "feed": {
        const fid = params.fid;
        const limit = params.limit || "15";
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(
          `${NEYNAR_BASE}/feed/following?fid=${fid}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const casts = (data.casts ?? []).map((c: Record<string, unknown>) => {
          const author = c.author as Record<string, unknown> | undefined;
          const reactions = c.reactions as Record<string, unknown> | undefined;
          const embeds = (c.embeds ?? []) as unknown[];
          const ch = c.channel as Record<string, unknown> | undefined;
          return {
            author: author?.username ?? "unknown",
            text: (String(c.text ?? "")).slice(0, 120),
            likes: reactions?.likes_count ?? 0,
            recasts: reactions?.recasts_count ?? 0,
            hash: String(c.hash ?? ""),
            timestamp: c.timestamp ?? "",
            channel: ch?.id ? String(ch.id) : null,
            authorBadge: !!(author?.power_badge),
            embedCount: embeds.length,
          };
        });
        result = casts;
        break;
      }

      case "notifications": {
        const fid = params.fid;
        const limit = params.limit || "15";
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(
          `${NEYNAR_BASE}/notifications?fid=${fid}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const notifications = (data.notifications ?? []).map((n: Record<string, unknown>) => {
          const nType = String(n.type ?? "unknown");
          let actorName = "unknown";
          let text = "";

          if (nType === "follows") {
            const follows = (n.follows ?? []) as Record<string, unknown>[];
            const firstFollow = follows[0];
            const followUser = (firstFollow?.user ?? firstFollow) as Record<string, unknown> | undefined;
            actorName = String(followUser?.username ?? "unknown");
            text = "followed you";
          } else if (nType === "likes" || nType === "recasts") {
            const reactions = (n.reactions ?? []) as Record<string, unknown>[];
            const firstReaction = reactions[0];
            const reactUser = (firstReaction?.user ?? firstReaction) as Record<string, unknown> | undefined;
            actorName = String(reactUser?.username ?? "unknown");
            const castObj = n.cast as Record<string, unknown> | undefined;
            text = (String(castObj?.text ?? "")).slice(0, 60);
          } else if (nType === "reply" || nType === "mention") {
            const castObj = n.cast as Record<string, unknown> | undefined;
            const author = castObj?.author as Record<string, unknown> | undefined;
            actorName = String(author?.username ?? "unknown");
            text = (String(castObj?.text ?? "")).slice(0, 60);
          } else {
            const actor = (n.most_recent_actor ?? n.actor) as Record<string, unknown> | undefined;
            actorName = String(actor?.username ?? "unknown");
            const castObj = n.cast as Record<string, unknown> | undefined;
            text = (String(castObj?.text ?? n.text ?? "")).slice(0, 60);
          }

          return {
            type: nType,
            from: `@${actorName}`,
            text: text + (text.length >= 60 ? "..." : ""),
            time: String(n.most_recent_timestamp ?? "").slice(0, 10),
          };
        });
        result = notifications;
        break;
      }

      case "cast": {
        const hash = params.hash;
        if (!hash) return NextResponse.json({ ok: false, error: "hash required" });
        const res = await fetch(
          `${NEYNAR_BASE}/cast?identifier=${encodeURIComponent(hash)}&type=hash`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const c = data.cast;
        if (!c) return NextResponse.json({ ok: true, data: null });
        const author = c.author as Record<string, unknown> | undefined;
        const reactions = c.reactions as Record<string, unknown> | undefined;
        const embeds = (c.embeds ?? []) as unknown[];
        const ch = c.channel as Record<string, unknown> | undefined;
        result = {
          author: author?.username ?? "unknown",
          authorFid: author?.fid,
          text: String(c.text ?? ""),
          likes: reactions?.likes_count ?? 0,
          recasts: reactions?.recasts_count ?? 0,
          replies: c.replies?.count ?? 0,
          hash: String(c.hash ?? ""),
          timestamp: c.timestamp ?? "",
          channel: ch?.id ? String(ch.id) : null,
          authorBadge: !!(author?.power_badge),
          embedCount: embeds.length,
        };
        break;
      }

      case "conversation": {
        const hash = params.hash;
        if (!hash) return NextResponse.json({ ok: false, error: "hash required" });
        const res = await fetch(
          `${NEYNAR_BASE}/cast/conversation?identifier=${encodeURIComponent(hash)}&type=hash&reply_depth=2&limit=10`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const conv = data.conversation?.cast;
        if (!conv) return NextResponse.json({ ok: true, data: [] });
        const flatten = (cast: Record<string, unknown>, depth: number): Record<string, unknown>[] => {
          const author = cast.author as Record<string, unknown> | undefined;
          const flatResult: Record<string, unknown>[] = [{
            depth,
            author: author?.username ?? "unknown",
            text: (String(cast.text ?? "")).slice(0, 120),
            hash: String(cast.hash ?? "").slice(0, 10),
          }];
          const replies = ((cast.direct_replies ?? []) as Record<string, unknown>[]);
          for (const reply of replies) {
            flatResult.push(...flatten(reply, depth + 1));
          }
          return flatResult;
        };
        result = flatten(conv, 0);
        break;
      }

      case "cast-search": {
        const query = params.query;
        const limit = params.limit || "10";
        if (!query) return NextResponse.json({ ok: false, error: "query required" });
        const res = await fetch(
          `${NEYNAR_BASE}/cast/search?q=${encodeURIComponent(query)}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const casts = (data.result?.casts ?? []).map((c: Record<string, unknown>) => {
          const author = c.author as Record<string, unknown> | undefined;
          const reactions = c.reactions as Record<string, unknown> | undefined;
          const embeds = (c.embeds ?? []) as unknown[];
          const castCh = c.channel as Record<string, unknown> | undefined;
          return {
            author: author?.username ?? "unknown",
            text: (String(c.text ?? "")).slice(0, 80),
            likes: reactions?.likes_count ?? 0,
            recasts: reactions?.recasts_count ?? 0,
            hash: String(c.hash ?? ""),
            timestamp: c.timestamp ?? "",
            channel: castCh?.id ? String(castCh.id) : null,
            authorBadge: !!(author?.power_badge),
            embedCount: embeds.length,
          };
        });
        result = casts;
        break;
      }

      /* ── New: reactions for a cast ── */
      case "reactions": {
        const hash = params.hash;
        const limit = params.limit || "25";
        const type = params.type || "likes";
        if (!hash) return NextResponse.json({ ok: false, error: "hash required" });
        const res = await fetch(
          `${NEYNAR_BASE}/reactions/cast?hash=${encodeURIComponent(hash)}&types=${type}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const reactions = (data.reactions ?? []).map((r: Record<string, unknown>) => {
          const rUser = r.user as Record<string, unknown> | undefined;
          return {
            username: rUser?.username ?? "unknown",
            displayName: rUser?.display_name ?? "—",
            fid: rUser?.fid,
            type: r.reaction_type ?? type,
            powerBadge: rUser?.power_badge ?? false,
          };
        });
        result = reactions;
        break;
      }

      /* ── New: user's recent casts ── */
      case "user-casts": {
        const fid = params.fid;
        const limit = params.limit || "15";
        if (!fid) return NextResponse.json({ ok: false, error: "fid required" });
        const res = await fetch(
          `${NEYNAR_BASE}/feed/user/casts?fid=${fid}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const casts = (data.casts ?? []).map((c: Record<string, unknown>) => {
          const author = c.author as Record<string, unknown> | undefined;
          const reactions = c.reactions as Record<string, unknown> | undefined;
          const embeds = (c.embeds ?? []) as unknown[];
          const ch = c.channel as Record<string, unknown> | undefined;
          return {
            author: author?.username ?? "unknown",
            text: (String(c.text ?? "")).slice(0, 120),
            likes: reactions?.likes_count ?? 0,
            recasts: reactions?.recasts_count ?? 0,
            replies: (c.replies as Record<string, unknown>)?.count ?? 0,
            hash: String(c.hash ?? ""),
            timestamp: c.timestamp ?? "",
            channel: ch?.id ? String(ch.id) : null,
            authorBadge: !!(author?.power_badge),
            embedCount: embeds.length,
          };
        });
        result = casts;
        break;
      }

      /* ── New: trending channels ── */
      case "trending-channels": {
        const timeWindow = params.time_window || "1d";
        const limit = params.limit || "10";
        const res = await fetch(
          `${NEYNAR_BASE}/channel/trending?time_window=${timeWindow}&limit=${limit}`,
          { headers: neynarHeaders() },
        );
        if (!res.ok) return neynarError(action, res);
        const data = await res.json();
        const channels = (data.channels ?? []).map((ch: Record<string, unknown>) => {
          const channel = (ch.channel ?? ch) as Record<string, unknown>;
          return {
            id: channel.id ?? "—",
            name: channel.name ?? "—",
            followers: channel.follower_count ?? 0,
            description: (String(channel.description ?? "")).slice(0, 60),
            lead: (channel.lead as Record<string, unknown>)?.username ?? "—",
          };
        });
        result = channels;
        break;
      }

      /* ── Analytics tracking ── */
      case "track": {
        try {
          const { db, collection, addDoc, serverTimestamp } = await import("@/lib/firebase");
          const doc: Record<string, unknown> = {
            event: params.event || "unknown",
            fid: params.fid || "",
            isPro: params.isPro === "true",
            timestamp: serverTimestamp(),
          };
          // Optional enrichment fields
          if (params.command) doc.command = params.command;
          if (params.totalCommands) doc.totalCommands = parseInt(params.totalCommands) || 0;
          if (params.daysSinceFirst) doc.daysSinceFirst = parseInt(params.daysSinceFirst) || 0;
          if (params.sessionCommands) doc.sessionCommands = parseInt(params.sessionCommands) || 0;
          await addDoc(collection(db, "nshell-analytics"), doc);
          result = { tracked: true };
        } catch (err) {
          console.error("[track] Error:", err instanceof Error ? err.message : err);
          result = { tracked: false };
        }
        break;
      }

      default:
        return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
    }

    // Store in cache if cacheable
    if (cacheKey && result !== undefined) {
      setCache(cacheKey, result);
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
