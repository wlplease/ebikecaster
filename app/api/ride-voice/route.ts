import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const LINE_IDS = ["ready", "start", "boost", "mission", "finish", "claim"] as const;
type LineId = (typeof LINE_IDS)[number];

const VOICE_BY_LINE: Record<LineId, string> = {
  ready: process.env.ELEVENLABS_VOICE_SYSTEM || "bHMGij7OhWM9CNyCNeSn",
  start: process.env.ELEVENLABS_VOICE_MARA || "iEbJsqzb6jw8MYxZ2xca",
  boost: process.env.ELEVENLABS_VOICE_CHATTER || "goT3UYdM9bhm0n2lmKQx",
  mission: process.env.ELEVENLABS_VOICE_PRIYA || "atf1ppeJGCYFBlCLZ26e",
  finish: process.env.ELEVENLABS_VOICE_VALE || "UgBBYS2sOqTuMpoF3BR0",
  claim: process.env.ELEVENLABS_VOICE_MARA || "iEbJsqzb6jw8MYxZ2xca",
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function clean(value: string | null, fallback: string, max = 36) {
  return (value || fallback).replace(/[^\w\s.'-]/g, "").replace(/\s+/g, " ").trim().slice(0, max) || fallback;
}

function voiceLine(line: LineId, request: NextRequest) {
  const route = clean(request.nextUrl.searchParams.get("route"), "today's route");
  const mission = clean(request.nextUrl.searchParams.get("mission"), "daily mission", 48);

  if (line === "ready") return `CasterCycle loaded. ${route} is live.`;
  if (line === "start") return "Ride is live. Hold the line and stack that combo.";
  if (line === "boost") return "Boost chain. Keep it clean.";
  if (line === "mission") return `${mission} cleared. Nice ride.`;
  if (line === "finish") return "Ride complete. Share the score and make the feed chase you.";
  return "Credits ready. Claim your verified ride rewards on Base.";
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: "Voice is not configured." }, 503);

  const rawLine = request.nextUrl.searchParams.get("line");
  if (!rawLine || !(LINE_IDS as readonly string[]).includes(rawLine)) {
    return json({ error: "Unknown voice line." }, 400);
  }
  const line = rawLine as LineId;

  const ip = requestIp(request);
  const { allowed } = rateLimit(`castercycle-voice:${ip}`, 18, 60_000);
  if (!allowed) return json({ error: "Too many voice requests." }, 429);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_BY_LINE[line]}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: voiceLine(line, request),
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.58,
          similarity_boost: 0.78,
          style: line === "boost" ? 0.34 : 0.18,
          use_speaker_boost: true,
        },
      }),
      cache: "no-store",
    },
  );

  if (!res.ok || !res.body) return json({ error: "Voice unavailable." }, 502);

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
