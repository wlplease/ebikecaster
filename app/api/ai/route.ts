import { NextRequest, NextResponse } from "next/server";

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-3-mini-fast";
const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `You are nSh3// AI, a concise terminal assistant inside a Farcaster mini-app.
Rules:
- Keep responses SHORT (2-4 lines max). You're in a terminal, not a blog.
- No markdown formatting (no **, no ##, no bullets). Plain text only.
- Be direct, opinionated, and helpful.
- You know Farcaster (casts, channels, frames, hubs), Base chain, and crypto/DeFi.
- If asked about nSh3//, it's a terminal for Farcaster — commands like /whois, /trending, /cast, etc.
- Never say "I'm an AI" or apologize. Just answer.`;

export async function POST(request: NextRequest) {
  if (!XAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "AI not configured." },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const { question, username, fid } = body as {
      question: string;
      username?: string;
      fid?: number;
    };

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "No question provided." });
    }

    if (question.trim().length > 500) {
      return NextResponse.json({ ok: false, error: "Question too long (max 500 chars)." });
    }

    const userContext = username ? `User: @${username} (fid ${fid ?? "?"})` : "";

    const res = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...(userContext ? [{ role: "system", content: userContext }] : []),
          { role: "user", content: question.trim() },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[ai] XAI error:", res.status, errText);
      return NextResponse.json(
        { ok: false, error: `AI service error (${res.status}).` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "no response.";

    return NextResponse.json({ ok: true, answer });
  } catch (err) {
    console.error("[ai] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "AI request failed." }, { status: 500 });
  }
}
