/** Owner FID — unlimited access to all endpoints. */
const OWNER_FID = 1059075;

const rateMap = new Map<string, { count: number; resetAt: number }>();

// Daily quota map — resets at midnight UTC
const dailyMap = new Map<string, { count: number; resetAt: number }>();

// Lazy cleanup — runs inline every 60s instead of a leaked setInterval.
// Prevents memory leak on hot reloads (server-side intervals never clear).
let _lastCleanup = Date.now();
function cleanupIfNeeded() {
  const now = Date.now();
  if (now - _lastCleanup < 60_000) return;
  _lastCleanup = now;
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key);
  }
  for (const [key, entry] of dailyMap) {
    if (now > entry.resetAt) dailyMap.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  cleanupIfNeeded();
  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (entry.count >= limit) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
}

/** Daily quota — limits total requests per calendar day (UTC). */
export function dailyQuota(
  key: string,
  limit: number,
): { allowed: boolean; remaining: number } {
  cleanupIfNeeded();
  const now = Date.now();
  const entry = dailyMap.get(key);

  // Reset at next midnight UTC
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  const resetAt = tomorrow.getTime();

  if (!entry || now > entry.resetAt) {
    dailyMap.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count };
}

/**
 * Tiered rate limit: owner unlimited, pro 400/day, free 100/day.
 * Pass fid + isPro from the request for FID-based limits.
 * Falls back to IP-based daily limit when no FID is provided.
 */
export function tieredLimit(
  endpoint: string,
  opts: { fid?: number; isPro?: boolean; ip: string },
): { allowed: boolean; remaining: number } {
  // Owner: always unlimited
  if (opts.fid === OWNER_FID) return { allowed: true, remaining: 9999 };

  const key = opts.fid ? `fid:${opts.fid}` : `ip:${opts.ip}`;

  if (opts.isPro && opts.fid) {
    // Pro: 400 requests per calendar day per FID
    return dailyQuota(`tier:${endpoint}:pro:${key}`, 400);
  }

  // Free: 100 requests per calendar day
  return dailyQuota(`tier:${endpoint}:free:${key}`, 100);
}
