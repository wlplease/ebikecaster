export type NeynarProfile = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
};

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function fetchNeynarProfiles(fids: number[], viewerFid = 0) {
  const apiKey = process.env.NEYNAR_API_KEY;
  const uniqueFids = Array.from(new Set(fids.map((fid) => Math.floor(Number(fid))).filter((fid) => fid > 0))).slice(0, 100);
  const profiles = new Map<number, NeynarProfile>();
  if (!apiKey || uniqueFids.length === 0) return profiles;

  const url = new URL("https://api.neynar.com/v2/farcaster/user/bulk/");
  url.searchParams.set("fids", uniqueFids.join(","));
  if (viewerFid > 0) url.searchParams.set("viewer_fid", String(Math.floor(viewerFid)));

  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
      next: { revalidate: 300 },
    });
    if (!res.ok) return profiles;
    const data = await res.json();
    for (const user of data.users || []) {
      const fid = Number(user?.fid || 0);
      if (fid <= 0) continue;
      profiles.set(fid, {
        fid,
        username: cleanText(user?.username, 64),
        displayName: cleanText(user?.display_name, 80),
        pfpUrl: cleanUrl(user?.pfp_url),
      });
    }
  } catch {}

  return profiles;
}

