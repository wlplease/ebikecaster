"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useFarcasterUser } from "@/components/farcaster-gate";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useProStatus, PRO_PASS_CONTRACT, PRO_PASS_ABI, USDC_CONTRACT, USDC_ABI, WEEKLY_PRICE, DAILY_PRICE, formatProExpiry } from "@/lib/pro-pass";
import { useTheme } from "@/components/theme-provider";
import { sdk } from "@farcaster/miniapp-sdk";
import { executeCommand, getCommandNames, getCommandMeta, getCommandMode, getHistory as getCmdHistory, getUsageStats, trackEvent, getPins, PROMO, type OutputLine } from "@/lib/commands";

/* ── Timing Constants ── */
const TIMING = {
  CLOCK_UPDATE: 30_000,
  NOTIF_POLL_INITIAL: 3_000,
  NOTIF_POLL_INTERVAL: 180_000,
  NOTIF_POLL_BACKOFF_MAX: 600_000,
  RUNE_FLASH: 600,
  LONGPRESS_DELAY: 500,
  LINE_DRAIN_DEFAULT: 30,
  TOAST_DURATION: 1500,
} as const;

/* ── Storage Keys ── */
const STORAGE = {
  SOUND: "nshell-sound",
  NOTIF_SEEN: "nshell-notif-seen",
  CMD_HISTORY: "nshell-cmd-history",
  FIRST_VISIT: "nshell-first-visit",
} as const;

/* ── ASCII Logo ── */
const LOGO = [
  "  ┌─┐┌─┐┬ ┬┌─┐┬  ┬  ",
  "  │││└─┐├─┤├┤ │  │  ",
  "  ┘└┘└─┘┘ └└─┘┴─┘┴─┘",
  "     //  command the graph.",
].join("\n");

let lineCounter = 0;
function nextId() {
  return `ln-${++lineCounter}-${Date.now()}`;
}

/* ── Haptic Feedback Engine ── */
function hapticTick() {
  try { sdk.haptics.impactOccurred("light"); } catch {}
}
function hapticEnter() {
  try { sdk.haptics.impactOccurred("medium"); } catch {}
}
function hapticSuccess() {
  try { sdk.haptics.notificationOccurred("success"); } catch {}
}
function hapticError() {
  try { sdk.haptics.notificationOccurred("error"); } catch {}
}
function hapticSelect() {
  try { sdk.haptics.selectionChanged(); } catch {}
}

/* ── Sound Engine ── */
const AudioCtx = typeof window !== "undefined" ? (window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext) as typeof AudioContext : null;
let audioCtx: AudioContext | null = null;
let soundEnabled = true;

function getAudioCtx(): AudioContext | null {
  if (!soundEnabled || !AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTick() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "square";
  osc.frequency.value = 800;
  gain.gain.value = 0.03;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.05);
}

function playEnter() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "square";
  osc.frequency.value = 600;
  osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.08);
  gain.gain.value = 0.04;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.1);
}

function playSuccess() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  [440, 554, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.03;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08 * (i + 1) + 0.1);
    osc.start(ctx.currentTime + 0.08 * i);
    osc.stop(ctx.currentTime + 0.08 * (i + 1) + 0.1);
  });
}

function playError() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "sawtooth";
  osc.frequency.value = 200;
  gain.gain.value = 0.04;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

/* ── Typing delay per line type (ms) ── */
const LINE_DELAY: Record<string, number> = {
  command: 5,
  system: 18,
  info: 30,
  result: 40,
  error: 25,
  ascii: 25,
  table: 55,
  card: 60,
};

/* ═══════ MAIN COMPONENT ═══════ */

export default function NShellTerminal() {
  const { user, safeAreaInsets, isStandalone } = useFarcasterUser();
  const { address } = useAccount();
  const { isPro, expiresAt: proExpiresAt, isTrial } = useProStatus(address ?? undefined);
  const { themeMode, toggleTheme } = useTheme();

  const [lines, setLines] = useState<OutputLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [processing, setProcessing] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [runeFlash, setRuneFlash] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [shiftOn, setShiftOn] = useState(false);
  const [numMode, setNumMode] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pinVersion, setPinVersion] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showAddApp, setShowAddApp] = useState(false);
  const [showTrialCard, setShowTrialCard] = useState(false);
  const [contextChips, setContextChips] = useState<{ label: string; cmd: string }[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const sessionCmdCount = useRef(0);
  const trialNudgeShown = useRef(false);
  const sessionId = useRef(Math.random().toString(16).slice(2, 8));

  const outputRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* ── Line Queue (typing effect) ── */
  const lineQueueRef = useRef<Omit<OutputLine, "id" | "timestamp">[]>([]);
  const drainingRef = useRef(false);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drainQueue = useCallback(() => {
    if (lineQueueRef.current.length === 0) {
      drainingRef.current = false;
      return;
    }
    drainingRef.current = true;
    const line = lineQueueRef.current.shift()!;
    setLines((prev) => [...prev, { ...line, id: nextId(), timestamp: Date.now() }]);
    const delay = LINE_DELAY[line.type] || 30;
    drainTimerRef.current = setTimeout(drainQueue, delay);
  }, []);

  const addLine = useCallback(
    (line: Omit<OutputLine, "id" | "timestamp">) => {
      lineQueueRef.current.push(line);
      if (!drainingRef.current) {
        drainQueue();
      }
    },
    [drainQueue],
  );

  const clearLines = useCallback(() => {
    lineQueueRef.current = [];
    if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    drainingRef.current = false;
    setLines([]);
  }, []);

  /* ── Load sound preference ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem("nshell-sound");
      if (saved === "off") {
        setSoundOn(false);
        soundEnabled = false;
      }
    } catch {}
  }, []);

  /* ── Toggle sound ── */
  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      soundEnabled = next;
      try { localStorage.setItem(STORAGE.SOUND, next ? "on" : "off"); } catch {}
      return next;
    });
  }, []);

  /* ── Offline detection ── */
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    setIsOffline(!navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  /* ── Landscape detection ── */
  useEffect(() => {
    const checkLandscape = () => {
      setIsLandscape(window.innerWidth > window.innerHeight && window.innerWidth < 900);
    };
    checkLandscape();
    window.addEventListener("resize", checkLandscape);
    window.addEventListener("orientationchange", checkLandscape);
    return () => {
      window.removeEventListener("resize", checkLandscape);
      window.removeEventListener("orientationchange", checkLandscape);
    };
  }, []);

  /* ── Load command history ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE.CMD_HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 50));
      }
    } catch {}
  }, []);

  /* ── Save command history ── */
  useEffect(() => {
    if (history.length > 0) {
      try { localStorage.setItem(STORAGE.CMD_HISTORY, JSON.stringify(history.slice(0, 50))); } catch {}
    }
  }, [history]);

  /* ── Clock ── */
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, TIMING.CLOCK_UPDATE);
    return () => clearInterval(id);
  }, []);

  /* ── Notification polling with exponential backoff ── */
  useEffect(() => {
    if (!user?.fid) return;
    let cancelled = false;
    let interval = TIMING.NOTIF_POLL_INTERVAL;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (isOffline) {
        // Back off when offline
        interval = Math.min(interval * 2, TIMING.NOTIF_POLL_BACKOFF_MAX);
        timeoutId = setTimeout(poll, interval);
        return;
      }
      try {
        const res = await fetch("/api/nshell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "notifications", params: { fid: String(user.fid), limit: "10" } }),
        });
        const data = await res.json();
        if (!cancelled && data.ok && data.data?.length > 0) {
          const lastSeen = localStorage.getItem(STORAGE.NOTIF_SEEN) || "";
          if (lastSeen) {
            const count = data.data.filter((n: Record<string, unknown>) => {
              const t = n.time as string || "";
              return t > lastSeen;
            }).length;
            setUnreadCount(count);
          } else {
            setUnreadCount(data.data.length);
          }
        }
        // Reset interval on success
        interval = TIMING.NOTIF_POLL_INTERVAL;
      } catch {
        // Exponential backoff on error
        interval = Math.min(interval * 1.5, TIMING.NOTIF_POLL_BACKOFF_MAX);
      }
      if (!cancelled) timeoutId = setTimeout(poll, interval);
    };

    timeoutId = setTimeout(poll, TIMING.NOTIF_POLL_INITIAL);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [user?.fid]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, processing]);

  /* ── Welcome (typed in line by line) ── */
  useEffect(() => {
    const op = user?.username ? `@${user.username}` : isStandalone ? "standalone" : "anonymous";

    // Clear any prior state
    lineQueueRef.current = [];
    if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    drainingRef.current = false;
    setLines([]);

    // Load persisted history into sidebar state on mount
    try {
      const persisted = getCmdHistory();
      if (persisted.length > 0) {
        setHistory(persisted);
      }
    } catch {}

    // Detect first visit
    let firstVisit = false;
    try { firstVisit = !localStorage.getItem(STORAGE.FIRST_VISIT); } catch {}

    // Track session start (once per app load)
    trackEvent("session_start", { user, isPro });

    const batch: Omit<OutputLine, "id" | "timestamp">[] = [
      { type: "ascii", content: LOGO },
      { type: "system", content: "" },
    ];

    if (firstVisit) {
      batch.push(
        { type: "result", content: `  welcome, ${op}. this is nshell.` },
        { type: "info", content: "  a terminal for farcaster — type commands to explore, post, and analyze." },
        { type: "system", content: "" },
        { type: "result", content: "  ── explore ──" },
        { type: "table", content: "", data: [
          { action: "/trending", _cmd: "/trending" },
          { action: "/discover", _cmd: "/discover" },
          { action: "/channels", _cmd: "/channels" },
        ] },
        { type: "system", content: "" },
        { type: "result", content: "  ── post ──" },
        { type: "table", content: "", data: [
          { action: '/cast "', _cmd: '/cast "' },
          { action: "/ask", _cmd: "/ask " },
        ] },
        { type: "system", content: "" },
        { type: "result", content: "  ── learn ──" },
        { type: "table", content: "", data: [
          { action: "/whois @dwr", _cmd: "/whois @dwr" },
          { action: "/quickstart", _cmd: "/quickstart" },
          { action: "/help", _cmd: "/help" },
        ] },
        { type: "system", content: "" },
      );
      try { localStorage.setItem(STORAGE.FIRST_VISIT, "1"); } catch {}
      for (const line of batch) addLine(line);
      return;
    } else {
      // Personalized returning-user welcome
      const hour = new Date().getHours();
      const greeting = hour < 5 ? "burning the midnight oil" : hour < 12 ? "gm" : hour < 18 ? "good afternoon" : "gn soon";
      const usage = getUsageStats();

      batch.push({ type: "result", content: `  ${greeting}, ${op}.` });

      if (usage.total > 0) {
        batch.push({ type: "system", content: `  ${usage.total} commands across ${usage.days}d | top: /${usage.topCmd}` });
      }

      batch.push({ type: "system", content: "" });

      // Detect expired trial returning users
      let hadTrial = false;
      try { hadTrial = !!localStorage.getItem("nshell-trial-used"); } catch {}
      if (hadTrial && !isPro) {
        trackEvent("trial_expired_return", { user, isPro });
        batch.push({ type: "system", content: `  welcome back — liked Pro? /upgrade for ${PROMO.weekly} to keep it` });
        batch.push({ type: "system", content: "" });
      }

      // Rotating tips based on usage
      const tips: { cmd: string; hint: string }[] = [];
      if (!isPro) tips.push({ cmd: "/trial", hint: "free 24h pro trial" });
      if (usage.total < 20) tips.push({ cmd: "/help", hint: "see all commands" });
      tips.push(
        { cmd: "/trending", hint: "what's hot" },
        { cmd: "/ask", hint: "AI answers" },
        { cmd: "/channels", hint: "explore channels" },
        { cmd: "/stats", hint: "your numbers" },
        { cmd: "/bookmarks", hint: "saved items" },
      );
      // Pick 3 rotating tips seeded by day
      const dayIdx = Math.floor(Date.now() / 86400000);
      const picked = tips.filter((_, i) => (i + dayIdx) % tips.length < 3).slice(0, 3);
      const tipLine = picked.map(t => `${t.cmd} ${t.hint}`).join("  ·  ");
      batch.push({ type: "info", content: `  ${tipLine}` });
      batch.push({ type: "system", content: "" });
    }

    // Trial expiry nudge (once per session)
    if (isPro && isTrial && proExpiresAt > 0 && !trialNudgeShown.current) {
      const now = Math.floor(Date.now() / 1000);
      const remaining = proExpiresAt - now;
      if (remaining > 0 && remaining < 86400) {
        const hours = Math.floor(remaining / 3600);
        batch.push({ type: "system", content: `  ★ trial expires in ${hours}h — /upgrade to keep Pro` });
        batch.push({ type: "system", content: "" });
        trialNudgeShown.current = true;
      }
    }

    for (const line of batch) addLine(line);

    // Don't show add-app on load — wait until 3rd command (see runCommand)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isStandalone, isPro, isTrial, address]);

  /* ── Rune flash ── */
  const triggerRuneFlash = useCallback(() => {
    setRuneFlash(true);
    setTimeout(() => setRuneFlash(false), 600);
  }, []);

  /* ── Autocomplete & Command Palette ── */
  const commandNames = useMemo(() => getCommandNames(), []);
  const commandMeta = useMemo(() => getCommandMeta(), []);
  const USAGE_HINTS: Record<string, string> = useMemo(() => ({
    whois: "@username",
    search: "query",
    channel: "name",
    followers: "@username",
    following: "@username",
    casts: "@username",
    popular: "@username",
    mutual: "@username",
    compare: "@user1 @user2",
    read: "0xhash",
    thread: "0xhash",
    like: "0xhash",
    share: "0xhash",
    reactions: "0xhash",
    sentiment: "0xhash",
    reply: '0xhash "text"',
    quote: '0xhash "text"',
    cast: '"your message"',
    draft: '"your idea"',
    undraft: "#",
    send: "@user 5 USDC",
    swap: "100 USDC ETH",
    filter: "pattern",
    sort: "field asc|desc",
    head: "5",
    tail: "5",
    count: "field",
    uniq: "field",
    export: "csv|json",
    castsearch: "query",
    open: "@user",
    follow: "@username",
    watch: "@username",
    unwatch: "@username",
    save: "0xhash",
    unsave: "0xhash",
    alias: 'gm = /cast "gm"',
    unalias: "name",
    pin: "/command",
    unpin: "/command",
    ask: "your question",
    trending: "1h|6h|12h|24h",
    channels: "1d|7d|30d",
    history: "search query",
    bulk: "follow",
    sharecast: "0xhash",
    castoutput: "redact",
  }), []);

  const suggestion = useMemo(() => {
    if (!input.startsWith("/")) return "";
    // If no space yet — autocomplete command name
    if (!input.includes(" ") && !input.includes("|")) {
      const partial = input.slice(1).toLowerCase();
      if (!partial) return "";
      const match = commandNames.find((c) => c.startsWith(partial) && c !== partial);
      return match ? `/${match}` : "";
    }
    // If space after command — show usage hint
    const spaceIdx = input.indexOf(" ");
    if (spaceIdx > 0) {
      const cmdName = input.slice(1, spaceIdx).toLowerCase();
      const afterSpace = input.slice(spaceIdx + 1);
      // Only show hint if user hasn't typed args yet
      if (!afterSpace && USAGE_HINTS[cmdName]) {
        return input + USAGE_HINTS[cmdName];
      }
    }
    return "";
  }, [input, commandNames, USAGE_HINTS]);

  const currentMode = useMemo(() => getCommandMode(input), [input]);

  const isNewUser = useMemo(() => getUsageStats().total < 10, [latency]);

  const paletteItems = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ") || input.includes("|")) return [];
    const partial = input.slice(1).toLowerCase();
    if (!partial) return commandMeta.slice(0, 8);
    return commandMeta.filter((c) => c.name.includes(partial)).slice(0, 6);
  }, [input, commandMeta]);

  // Show/hide palette based on input
  useEffect(() => {
    setPaletteOpen(input.startsWith("/") && !input.includes(" ") && !input.includes("|") && paletteItems.length > 0);
  }, [input, paletteItems]);

  /* ── Easter Eggs ── */
  function checkEasterEgg(raw: string): boolean {
    const lower = raw.toLowerCase().trim();

    if (lower === "neynar") {
      addLine({ type: "command", content: raw });
      addLine({ type: "system", content: ">>> ORIGIN PROTOCOL ACCESSED <<<" });
      addLine({ type: "info", content: "" });
      addLine({ type: "result", content: "neynar: the name derives from norse rune-keepers." });
      addLine({ type: "result", content: "they built the graph beneath the graph." });
      addLine({ type: "result", content: "without them, there is no social layer." });
      addLine({ type: "result", content: "the protocol remembers its builders." });
      addLine({ type: "info", content: "" });
      addLine({ type: "system", content: ">>> END TRANSMISSION <<<" });
      playSuccess();
      triggerRuneFlash();
      return true;
    }

    if (lower === "gm") {
      addLine({ type: "command", content: raw });
      addLine({ type: "ascii", content: [
        "  ┌──────────────────┐",
        "  │  gm, operator.   │",
        "  └──────────────────┘",
      ].join("\n") });
      addLine({ type: "result", content: "the sun rises on the protocol." });
      addLine({ type: "info", content: '  try: /cast "gm"' });
      playSuccess();
      return true;
    }

    if (lower === "sudo") {
      addLine({ type: "command", content: raw });
      addLine({ type: "error", content: "permission denied." });
      addLine({ type: "system", content: "nice try. this isn't that kind of terminal." });
      addLine({ type: "info", content: "  (but /upgrade gets you pretty close)" });
      playError();
      return true;
    }

    return false;
  }

  /* ── Run command ── */
  const runCommand = useCallback(async (raw: string) => {
    setProcessing(true);
    playEnter();
    addLine({ type: "command", content: raw });
    const start = performance.now();

    setShowUpgrade(false);

    sessionCmdCount.current++;

    // Show add-app card after 3rd command
    if (sessionCmdCount.current === 3) {
      try {
        if (!localStorage.getItem("nshell-app-added")) {
          setShowAddApp(true);
        }
      } catch {}
    }

    // Trial prompt: show after 8th command for non-pro users
    if (sessionCmdCount.current === 8 && !isPro) {
      try {
        if (!localStorage.getItem("nshell-trial-dismissed")) {
          setShowTrialCard(true);
        }
      } catch {}
    }
    // Clear notification badge when checking notifications
    if (raw.trim().toLowerCase().startsWith("/notification")) {
      setUnreadCount(0);
      try { localStorage.setItem("nshell-notif-seen", new Date().toISOString()); } catch {}
    }
    // Refresh pin bar after pin/unpin
    const cmdLower = raw.trim().toLowerCase();
    if (cmdLower.startsWith("/pin ") || cmdLower.startsWith("/unpin ")) {
      setTimeout(() => setPinVersion(v => v + 1), 100);
    }
    try {
      const result = await executeCommand(raw, {
        user,
        address: address ?? null,
        isPro,
        addLine,
        clearLines,
        triggerUpgrade: () => setShowUpgrade(true),
        getRecentOutput: () => lines.slice(-20),
      });
      playSuccess();
      hapticSuccess();
      if (result.suggestions) {
        setContextChips(result.suggestions);
      }

      // One-time mode indicator hint
      try {
        const cmdName = raw.replace(/^\//, "").split(/\s/)[0]?.toLowerCase();
        const mode = getCommandMode(`/${cmdName}`);
        if (mode && !localStorage.getItem("nshell-mode-hint-shown")) {
          localStorage.setItem("nshell-mode-hint-shown", "1");
          addLine({ type: "info", content: "" });
          addLine({ type: "info", content: "  V = viewing data · X = executing action · C = composing content" });
          addLine({ type: "info", content: "  the prompt prefix shows what type of command you're running." });
        }
      } catch {}
    } catch {
      playError();
      hapticError();
    }

    setLatency(Math.round(performance.now() - start));
    setProcessing(false);
    triggerRuneFlash();
  }, [user, address, isPro, addLine, clearLines, triggerRuneFlash]);

  /* ── Submit ── */
  const handleSubmit = useCallback(async () => {
    const raw = input.trim();
    if (!raw || processing) return;

    hapticEnter();
    setInput("");
    setStartMenuOpen(false);
    setProfileOpen(false);
    setHistory((prev) => [raw, ...prev.filter((h) => h !== raw)].slice(0, 100));
    setHistoryIdx(-1);

    if (checkEasterEgg(raw)) return;
    await runCommand(raw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, processing, runCommand]);

  /* ── Keyboard input handler ── */
  const handleKey = useCallback(async (key: string) => {
    playTick();
    hapticTick();
    if (key === "BACKSPACE") {
      setInput((prev) => prev.slice(0, -1));
    } else if (key === "ENTER") {
      handleSubmit();
    } else if (key === "SHIFT") {
      setShiftOn((prev) => !prev);
    } else if (key === "123") {
      setNumMode(true);
    } else if (key === "ABC") {
      setNumMode(false);
    } else if (key === "SPACE") {
      setInput((prev) => prev + " ");
    } else if (key === "PASTE") {
      try {
        const text = await navigator.clipboard.readText();
        if (text) setInput((prev) => prev + text.trim());
      } catch {
        addLine({ type: "info", content: "  clipboard not available — try long-press to paste" });
      }
    } else if (key === "TAB") {
      if (suggestion) {
        setInput(suggestion + " ");
      }
    } else if (key === "UP") {
      setHistory((prev) => {
        if (prev.length === 0) return prev;
        setHistoryIdx((idx) => {
          const newIdx = Math.min(idx + 1, prev.length - 1);
          setInput(prev[newIdx]);
          return newIdx;
        });
        return prev;
      });
    } else if (key === "DOWN") {
      setHistoryIdx((idx) => {
        if (idx > 0) {
          const newIdx = idx - 1;
          setHistory((prev) => { setInput(prev[newIdx]); return prev; });
          return newIdx;
        } else {
          setInput("");
          return -1;
        }
      });
    } else {
      const char = shiftOn ? key.toUpperCase() : key;
      setInput((prev) => prev + char);
      if (shiftOn) setShiftOn(false);
      setContextChips(null);
    }
  }, [shiftOn, suggestion, handleSubmit, addLine]);

  /* ── Quick command chips ── */
  const handleQuickCommand = useCallback((cmd: string) => {
    playTick();
    hapticSelect();
    setContextChips(null);
    // Complete commands (no trailing space/quote) execute immediately
    if (!cmd.endsWith(" ") && !cmd.endsWith('"') && !cmd.endsWith("@")) {
      setInput("");
      runCommand(cmd);
    } else {
      setInput(cmd);
    }
  }, [runCommand]);

  /* ── Physical keyboard fallback (desktop) ── */
  const handlePhysicalKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      handleKey("UP");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      handleKey("DOWN");
    } else if (e.key === "Tab") {
      e.preventDefault();
      handleKey("TAB");
    } else if (e.key === "l" && e.ctrlKey) {
      // Ctrl+L: Clear screen
      e.preventDefault();
      clearLines();
    } else if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+K: Clear screen (alternative)
      e.preventDefault();
      clearLines();
    } else if (e.key === "u" && e.ctrlKey) {
      // Ctrl+U: Clear input line
      e.preventDefault();
      setInput("");
    } else if (e.key === "c" && e.ctrlKey && !window.getSelection()?.toString()) {
      // Ctrl+C: Cancel current operation (if not selecting text)
      if (processing) {
        e.preventDefault();
        addLine({ type: "system", content: "^C" });
      }
    } else if (e.key === "Escape") {
      setStartMenuOpen(false);
      setProfileOpen(false);
      setPaletteOpen(false);
    } else if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+P: Open command palette
      e.preventDefault();
      setPaletteOpen(true);
    }
  }, [handleSubmit, handleKey, clearLines, processing, addLine]);

  /* ── Start Menu Actions ── */
  const handleAddApp = async () => {
    setStartMenuOpen(false);
    setShowAddApp(false);
    try {
      await sdk.actions.addMiniApp();
      addLine({ type: "system", content: "app added to your dock." });
      playSuccess();
      try { localStorage.setItem("nshell-app-added", "1"); } catch {}
    } catch {
      addLine({ type: "info", content: "add app not available in this context." });
    }
    triggerRuneFlash();
  };

  const handleStartAction = (cmd: string) => {
    setStartMenuOpen(false);
    setInput("");
    runCommand(cmd);
  };

  /* ── Close dropdowns on outside click ── */
  const handleContainerClick = useCallback(() => {
    setProfileOpen(false);
    setStartMenuOpen(false);
  }, []);

  /* ── Theme icon ── */
  const themeIcon = themeMode === "dark" ? "●" : themeMode === "light" ? "○" : themeMode === "amber" ? "◉" : themeMode === "ocean" ? "◈" : "◑";

  /* ── Show toast ── */
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  }, []);

  /* ── Long-press copy handler ── */
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCellTouchStart = useCallback((value: string) => {
    longPressRef.current = setTimeout(() => {
      navigator.clipboard.writeText(value).then(() => {
        hapticSuccess();
        showToast(`copied: ${value.length > 30 ? value.slice(0, 30) + "..." : value}`);
      }).catch(() => {});
    }, 500);
  }, [showToast]);
  const handleCellTouchEnd = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  return (
    <div
      className="flex flex-col h-dvh w-full max-w-[520px] mx-auto font-mono relative overflow-hidden"
      data-mode={currentMode || undefined}
      style={{ paddingTop: safeAreaInsets.top, background: "var(--t-bg)", color: "var(--t-text)" }}
      onKeyDown={handlePhysicalKey}
      onClick={handleContainerClick}
      tabIndex={0}
    >
      {/* Background grid */}
      <div className="absolute inset-0 terminal-grid pointer-events-none opacity-60" />
      <div className="absolute inset-0 scanline pointer-events-none" />
      {runeFlash && <div className="absolute inset-0 pointer-events-none z-50 animate-rune-flash" />}

      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-3 py-2.5 relative z-10 backdrop-blur-sm shrink-0"
        style={{ borderBottom: "1px solid var(--t-border)", background: "color-mix(in srgb, var(--t-bg) 80%, transparent)" }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setSidebarOpen(!sidebarOpen); }}
          className="w-10 h-10 flex items-center justify-center transition-colors text-xl"
          style={{ color: "var(--t-dim)" }}
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? "\u00d7" : "\u2261"}
        </button>
        <div className="flex items-center gap-3">
          <div className="text-base font-bold tracking-tight animate-logo-pulse select-none flex items-center gap-1.5">
            <span style={{ color: "var(--t-text)" }}>nSh3</span>
            <span style={{ color: "var(--t-dim)" }}>//</span>
            {isPro && <ProBadge expiresAt={proExpiresAt} isTrial={isTrial} />}
          </div>
          {latency !== null && (
            <div className="flex items-center gap-1.5 tabular-nums select-none" title={`${latency}ms round-trip`}>
              <span className="w-2 h-2 rounded-full" style={{ background: latency < 300 ? "#22c55e" : latency < 800 ? "#eab308" : "#ef4444" }} />
              <span className="text-[10px] font-mono" style={{ color: latency < 300 ? "#22c55e" : latency < 800 ? "#eab308" : "#ef4444" }}>{latency}ms</span>
            </div>
          )}
        </div>
        {/* Profile Button */}
        <button
          onClick={(e) => { e.stopPropagation(); setProfileOpen(!profileOpen); }}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-colors text-[12px] font-bold relative"
          style={{
            color: profileOpen ? "var(--t-bright)" : "var(--t-dim)",
            border: "1px solid var(--t-border)",
            background: profileOpen ? "var(--t-card)" : "transparent",
          }}
          aria-label={profileOpen ? "Close profile" : "Open profile"}
          aria-expanded={profileOpen}
        >
          {user?.username ? user.username.slice(0, 2).toUpperCase() : "?"}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-1 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold leading-none px-0.5"
              style={{ background: "var(--t-accent)", color: "var(--t-bg)" }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </header>

      {/* ── Offline Banner ── */}
      {isOffline && (
        <div
          className="px-3 py-2 text-[11px] font-mono flex items-center gap-2"
          style={{ background: "var(--t-error)", color: "var(--t-bg)" }}
        >
          <span>⚠</span>
          <span>You&apos;re offline. Commands will fail until connection is restored.</span>
        </div>
      )}

      {/* ── Profile Dropdown ── */}
      {profileOpen && (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setProfileOpen(false)} aria-hidden="true" />
          <div
            className="absolute right-2 top-12 z-40 animate-scale-up w-52 rounded overflow-hidden font-mono"
            style={{ background: "var(--t-panel)", border: "1px solid var(--t-border)", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* User Info */}
            <div className="px-3 py-2.5 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--t-border-dim)" }}>
              {user?.pfpUrl ? (
                <img src={user.pfpUrl} alt="" className="w-8 h-8 rounded-full shrink-0" style={{ border: "1px solid var(--t-border)" }} />
              ) : (
                <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                  style={{ background: "var(--t-card)", color: "var(--t-dim)", border: "1px solid var(--t-border)" }}>
                  {user?.username ? user.username.slice(0, 1).toUpperCase() : "?"}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-bold truncate" style={{ color: "var(--t-text)" }}>
                  {user?.username ? `@${user.username}` : "anonymous"}
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: "var(--t-muted)" }}>
                  fid {user?.fid ?? "—"} | {isPro ? (isTrial ? "trial" : "pro") : "free tier"}
                  {isPro && proExpiresAt > 0 && (() => {
                    const d = Math.floor((proExpiresAt - Date.now() / 1000) / 86400);
                    return d > 0 ? ` · ${d}d left` : "";
                  })()}
                </div>
              </div>
            </div>

            {/* Pro Status */}
            {!isPro && (
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--t-border-faint)", background: "var(--t-card)" }}>
                <button
                  className="w-full py-1.5 rounded text-[9px] font-bold uppercase tracking-wider"
                  style={{ background: "var(--t-accent)", color: "var(--t-bg)" }}
                  onClick={() => { setProfileOpen(false); setShowUpgrade(true); }}
                >
                  upgrade to pro — {PROMO.weekly}
                </button>
              </div>
            )}

            {/* Settings */}
            <div className="py-1">
              <button
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
                style={{ color: "var(--t-info)" }}
                onClick={() => { runCommand("/profile"); setProfileOpen(false); }}
              >
                <span><span className="mr-2" style={{ color: "var(--t-dim)" }}>▸</span>My Profile</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
                style={{ color: "var(--t-info)" }}
                onClick={() => { runCommand("/notifications"); setProfileOpen(false); }}
              >
                <span>
                  <span className="mr-2" style={{ color: "var(--t-dim)" }}>▸</span>
                  Notifications
                  {unreadCount > 0 && <span className="ml-1.5 text-[8px] font-bold px-1 rounded-full" style={{ background: "var(--t-accent)", color: "var(--t-bg)" }}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
                </span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
                style={{ color: "var(--t-info)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTheme();
                  // Skip amber/ocean for non-pro users (toggle will land on them, so toggle again)
                  if (!isPro) {
                    // After toggle, check if we landed on a pro theme
                    setTimeout(() => {
                      const el = document.documentElement.getAttribute("data-theme");
                      if (el === "amber" || el === "ocean") {
                        toggleTheme(); // skip past it
                      }
                    }, 10);
                  }
                }}
              >
                <span><span className="mr-2">{themeIcon}</span>Theme: {themeMode}</span>
                <span className="text-[9px]" style={{ color: "var(--t-muted)" }}>{isPro ? "cycle" : "pro: +2"}</span>
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
                style={{ color: "var(--t-info)" }}
                onClick={(e) => { e.stopPropagation(); toggleSound(); }}
              >
                <span><span className="mr-2">{soundOn ? "♫" : "♪"}</span>Sound: {soundOn ? "on" : "off"}</span>
                <span className="text-[9px]" style={{ color: "var(--t-muted)" }}>toggle</span>
              </button>
            </div>

            {/* Quick Links */}
            <div className="py-1" style={{ borderTop: "1px solid var(--t-border-faint)" }}>
              <button
                className="w-full text-left px-3 py-1.5 text-[11px]"
                style={{ color: "var(--t-info)" }}
                onClick={() => { runCommand("/invite"); setProfileOpen(false); }}
              >
                <span className="mr-2" style={{ color: "var(--t-accent)" }}>★</span>Share nSh3//
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-[11px]"
                style={{ color: "var(--t-info)" }}
                onClick={() => { handleAddApp(); setProfileOpen(false); }}
              >
                <span className="mr-2" style={{ color: "var(--t-dim)" }}>▸</span>Add to Dock
              </button>
            </div>

            <div className="px-3 py-1.5 text-[9px]" style={{ borderTop: "1px solid var(--t-border-dim)", color: "var(--t-ghost)" }}>
              nSh3// v3 | base (8453)
            </div>
          </div>
        </>
      )}

      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <>
          <div className="absolute inset-0 z-30" style={{ background: "var(--t-overlay)" }} onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-60 z-40 animate-slide-in flex flex-col"
            style={{ background: "var(--t-panel)", borderRight: "1px solid var(--t-border-dim)" }}>
            <div className="px-3 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--t-border-dim)" }}>
              <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--t-dim)" }}>history</span>
              <button onClick={() => setSidebarOpen(false)} className="text-sm" style={{ color: "var(--t-muted)" }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              {history.length === 0 && <div className="px-3 py-6 text-xs text-center" style={{ color: "var(--t-empty)" }}>no history yet</div>}
              {history.map((cmd, i) => (
                <button key={`${i}-${cmd}`}
                  onClick={() => { setInput(cmd); setSidebarOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs transition-colors truncate"
                  style={{ color: "var(--t-info)", borderBottom: "1px solid var(--t-border-faint)" }}>
                  <span style={{ color: "var(--t-muted)" }} className="mr-1">$</span>{cmd}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 text-[9px]" style={{ borderTop: "1px solid var(--t-border-dim)", color: "var(--t-ghost)" }}>
              {user?.username ? `@${user.username}` : "anonymous"} | nSh3//
            </div>
          </div>
        </>
      )}

      {/* ── Output Pane ── */}
      <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 relative z-10 scrollbar-hide min-h-0">
        {lines.map((line) => <LineRenderer key={line.id} line={line} onTap={runCommand} onCellLongPress={handleCellTouchStart} onCellTouchEnd={handleCellTouchEnd} />)}
        {showAddApp && (
          <div className="animate-fade-in pl-2 py-2">
            <div className="rounded px-3 py-2.5 max-w-xs" style={{ border: "1px solid var(--t-border)", background: "var(--t-card)" }}>
              <div className="text-[10px] mb-2" style={{ color: "var(--t-dim)" }}>
                pin nSh3// to your dock for quick access.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddApp}
                  className="flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-transform active:scale-95"
                  style={{ background: "var(--t-accent)", color: "var(--t-bg)" }}
                >
                  + add app
                </button>
                <button
                  onClick={() => { setShowAddApp(false); try { localStorage.setItem("nshell-app-added", "1"); } catch {} }}
                  className="px-3 py-1.5 rounded text-[10px]"
                  style={{ border: "1px solid var(--t-border)", color: "var(--t-muted)" }}
                >
                  skip
                </button>
              </div>
            </div>
          </div>
        )}
        {showTrialCard && !isPro && (
          <div className="animate-fade-in pl-2 py-2">
            <div className="rounded px-3 py-2.5 max-w-xs" style={{ border: "1px solid var(--t-border)", background: "var(--t-card)" }}>
              <div className="text-[10px] font-bold mb-1" style={{ color: "var(--t-accent)" }}>
                try Pro free for 24 hours
              </div>
              <div className="text-[9px] mb-2" style={{ color: "var(--t-dim)" }}>
                unlock /feed, /ask AI, /notifications, and more.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowTrialCard(false); runCommand("/trial"); }}
                  className="flex-1 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider transition-transform active:scale-95"
                  style={{ background: "var(--t-accent)", color: "var(--t-bg)" }}
                >
                  /trial
                </button>
                <button
                  onClick={() => { setShowTrialCard(false); try { localStorage.setItem("nshell-trial-dismissed", "1"); } catch {} }}
                  className="px-3 py-1.5 rounded text-[9px]"
                  style={{ border: "1px solid var(--t-border)", color: "var(--t-muted)" }}
                >
                  dismiss
                </button>
              </div>
            </div>
          </div>
        )}
        {processing && (
          <div className="text-xs py-2 flex items-center gap-3" style={{ color: "var(--t-text)" }}>
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--t-dot)" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--t-dot)", animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--t-dot)", animationDelay: "0.3s" }} />
            </span>
            <span className="text-[11px] font-medium">processing command...</span>
          </div>
        )}
        {showUpgrade && !isPro && (
          <UpgradeWidget
            onSuccess={() => {
              setShowUpgrade(false);
              trackEvent("upgrade_purchased", { user, isPro: true });
              addLine({ type: "system", content: "━━━ pro pass activated ━━━" });
              addLine({ type: "result", content: "  all pro commands unlocked." });
              addLine({ type: "info", content: "  try /feed /notifications /castsearch /popular" });
              playSuccess();
              triggerRuneFlash();
            }}
            onCancel={() => setShowUpgrade(false)}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Start Menu ── */}
      {startMenuOpen && (
        <div className="absolute bottom-0 left-2 z-40 animate-menu-up w-56 rounded-t overflow-hidden font-mono"
          style={{ background: "var(--t-panel)", border: "1px solid var(--t-border)", borderBottom: "none", boxShadow: "0 -4px 24px rgba(0,0,0,0.3)", bottom: "calc(var(--kb-height, 220px) + 36px)" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--t-border-dim)" }}>
            <div className="text-xs font-bold">
              <span style={{ color: "var(--t-text)" }}>nSh3</span>
              <span style={{ color: "var(--t-dim)" }}>//</span>
              <span className="text-[9px] font-normal ml-1.5" style={{ color: "var(--t-muted)" }}>v3.3</span>
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--t-system)" }}>command the graph.</div>
          </div>
          <div className="py-1">
            <StartMenuItem label="Add App" hint="pin to dock" onClick={handleAddApp} />
            <StartMenuItem label="Invite Friends" hint="share nSh3//" onClick={() => handleStartAction("/invite")} />
          </div>
          <div style={{ borderTop: "1px solid var(--t-border-faint)" }} className="py-1">
            <StartMenuItem label="/feed" hint="your feed" onClick={() => handleStartAction("/feed")} />
            <StartMenuItem label="/trending" hint="hot casts" onClick={() => handleStartAction("/trending")} />
            <StartMenuItem label="/notifications" hint="mentions & replies" onClick={() => handleStartAction("/notifications")} />
            <StartMenuItem label="/ask" hint="AI terminal" onClick={() => handleStartAction("/ask what is farcaster")} />
            <StartMenuItem label="/help" hint="all commands" onClick={() => handleStartAction("/help")} />
            <StartMenuItem label="/upgrade" hint="pro pass" onClick={() => handleStartAction("/upgrade")} />
          </div>
          <div className="px-3 py-1.5 text-[9px]" style={{ borderTop: "1px solid var(--t-border-dim)", color: "var(--t-ghost)" }}>
            v3.3 | {isPro ? "pro" : "free"} | base | {sessionId.current}
          </div>
        </div>
      )}

      {/* ── Command Palette ── */}
      {paletteOpen && paletteItems.length > 0 && (
        <div className="relative z-20 px-2" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-t overflow-hidden max-h-[180px] overflow-y-auto scrollbar-hide"
            style={{ background: "var(--t-panel)", border: "1px solid var(--t-border)", borderBottom: "none" }}>
            {paletteItems.map((cmd) => (
              <button
                key={cmd.name}
                className="w-full text-left px-3 py-1.5 text-[10px] flex items-center justify-between"
                style={{ color: "var(--t-text)", borderBottom: "1px solid var(--t-border-faint)" }}
                onClick={() => { setInput(`/${cmd.name} `); setPaletteOpen(false); playTick(); }}
              >
                <span>
                  <span style={{ color: "var(--t-bright)" }}>/{cmd.name}</span>
                  <span className="ml-2" style={{ color: "var(--t-muted)" }}>{cmd.description}</span>
                </span>
                {cmd.tier === "pro" && (
                  <span className="text-[7px] uppercase px-1 rounded" style={{ color: "var(--t-accent)", border: "1px solid var(--t-border)" }}>pro</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="absolute bottom-52 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded text-[11px] font-mono animate-toast"
          style={{ background: "var(--t-panel)", color: "var(--t-bright)", border: "1px solid var(--t-border)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
          {toast}
        </div>
      )}

      {/* ── Taskbar + Keyboard ── */}
      <div className="relative z-20 shrink-0" style={{ paddingBottom: safeAreaInsets.bottom }}>
        {/* Taskbar */}
        <div className="px-2 py-1.5 flex items-center gap-1.5"
          style={{ borderTop: "1px solid var(--t-border)", background: "color-mix(in srgb, var(--t-bg) 90%, transparent)" }}>
          {/* Start */}
          <button onClick={(e) => { e.stopPropagation(); setStartMenuOpen(!startMenuOpen); setProfileOpen(false); }}
            className="shrink-0 px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded flex items-center gap-1"
            style={{ color: startMenuOpen ? "var(--t-bright)" : "var(--t-dim)", border: "1px solid var(--t-border)", background: startMenuOpen ? "var(--t-card)" : "transparent" }}>
            <span className="text-[7px]">{startMenuOpen ? "▼" : "▲"}</span><span>nSh</span>
          </button>
          <div className="w-px h-3.5 shrink-0" style={{ background: "var(--t-border)" }} />
          {/* Prompt display */}
          <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="text-[9px] shrink-0 font-bold" style={{ color: currentMode === "compose" ? "var(--t-mode-compose)" : currentMode === "exec" ? "var(--t-mode-exec)" : "var(--t-dim)" }}>{currentMode === "view" ? "V·" : currentMode === "exec" ? "X·" : currentMode === "compose" ? "C·" : ""}nsh&gt;</span>
            <div className="flex-1 min-w-0 relative">
              {/* Hidden input for physical keyboard */}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handlePhysicalKey}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text");
                  if (text) setInput((prev) => prev + text.trim());
                }}
                inputMode="none"
                className="absolute inset-0 w-full bg-transparent outline-none text-[10px] font-mono opacity-0"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              />
              {/* Visual display */}
              <div className="text-[10px] truncate pr-2" style={{ color: "var(--t-text)" }}>
                {input || <span style={{ color: "var(--t-placeholder)" }}>{processing ? "processing..." : "type a command..."}</span>}
                <span className="animate-blink" style={{ color: "var(--t-caret)" }}>{"\u2588"}</span>
              </div>
              {suggestion && (
                <div className="absolute inset-0 text-[10px] pointer-events-none truncate" style={{ color: "var(--t-dim)" }}>{suggestion}</div>
              )}
            </div>
          </div>
          <div className="w-px h-3.5 shrink-0" style={{ background: "var(--t-border)" }} />
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-cursor-pulse" style={{ background: "var(--t-dot)" }} />
            <span className="text-[7px] font-mono shrink-0" style={{ color: "var(--t-ghost)" }}>{sessionId.current}</span>
            <span className="text-[8px] tabular-nums shrink-0" style={{ color: "var(--t-muted)" }}>{clock}</span>
          </div>
        </div>

        {/* ── Terminal Keyboard ── */}
        <TerminalKeyboard
          onKey={handleKey}
          onQuickCommand={handleQuickCommand}
          shiftOn={shiftOn}
          numMode={numMode}
          processing={processing}
          contextChips={contextChips}
          pinVersion={pinVersion}
          isNewUser={isNewUser}
          isLandscape={isLandscape}
        />
      </div>
    </div>
  );
}

/* ═══════ START MENU ITEM ═══════ */

function StartMenuItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button className="w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between"
      style={{ color: "var(--t-info)" }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <span><span className="mr-2" style={{ color: "var(--t-dim)" }}>▸</span>{label}</span>
      <span className="text-[9px]" style={{ color: "var(--t-muted)" }}>{hint}</span>
    </button>
  );
}

/* ═══════ TERMINAL KEYBOARD ═══════ */

const QUICK_COMMANDS = [
  "/trending", "/help", "/ask ", "/whois @", "/channels", "/search ", "/feed", "/discover", "/cast \"", "/stats", "/bookmarks", "/invite", "/casts @", "/popular @",
];

const QUICK_COMMANDS_NEW = [
  "/trending", "/discover", "/whois @", "/channels", "/help", "/quickstart", "/ask ", "/cast \"",
];

const ALPHA_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "BACKSPACE"],
  ["SHIFT", "z", "x", "c", "v", "b", "n", "m", ".", "/"],
];

const NUM_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["-", "+", "=", "_", "(", ")", "[", "]", ":", "BACKSPACE"],
  ["!", "#", "$", "%", "&", "*", ";", "'", "?", "/"],
];

const SPECIAL_LABELS: Record<string, string> = {
  BACKSPACE: "\u232b",
  ENTER: "\u21b5",
  SHIFT: "\u21e7",
  SPACE: "\u2423",
  UP: "\u2191",
  DOWN: "\u2193",
  TAB: "\u21e5",
  PASTE: "\ud83d\udccb",
};

function TerminalKeyboard({
  onKey,
  onQuickCommand,
  shiftOn,
  numMode,
  processing,
  contextChips,
  pinVersion,
  isNewUser,
  isLandscape,
}: {
  onKey: (key: string) => void;
  onQuickCommand: (cmd: string) => void;
  shiftOn: boolean;
  numMode: boolean;
  processing: boolean;
  contextChips?: { label: string; cmd: string }[] | null;
  pinVersion?: number;
  isNewUser?: boolean;
  isLandscape?: boolean;
}) {
  // Landscape mode uses shorter keys
  const keyHeight = isLandscape ? "36px" : "42px";
  const fontSize = isLandscape ? "12px" : "13px";
  const symbolSize = isLandscape ? "14px" : "16px";
  const rows = numMode ? NUM_ROWS : ALPHA_ROWS;
  const chips = contextChips && contextChips.length > 0 ? contextChips : null;
  const quickCommands = isNewUser ? QUICK_COMMANDS_NEW : QUICK_COMMANDS;

  // Load pins and prepend to quick commands when no context chips
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    setPins(getPins());
  }, [pinVersion]);

  return (
    <div style={{ background: "var(--t-kb-bg)" }} className="select-none">
      {/* Quick Commands / Context Chips */}
      <div className="flex gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hide"
        style={{ borderTop: "1px solid var(--t-border-faint)" }}>
        {chips ? (
          chips.map((chip) => (
            <button
              key={chip.cmd}
              disabled={processing}
              onClick={() => onQuickCommand(chip.cmd)}
              className="shrink-0 px-2.5 py-1 rounded text-[9px] font-mono whitespace-nowrap transition-all active:scale-95"
              style={{
                background: processing ? "transparent" : "var(--t-key-chip-bg)",
                color: processing ? "var(--t-dim)" : "var(--t-accent)",
                border: `1px solid ${processing ? "var(--t-border-faint)" : "var(--t-accent)"}`,
                opacity: processing ? 0.4 : 1,
              }}
            >
              {chip.label}
            </button>
          ))
        ) : (
          <>
            {pins.map((cmd) => (
              <button
                key={`pin-${cmd}`}
                disabled={processing}
                onClick={() => onQuickCommand(cmd)}
                className="shrink-0 px-2.5 py-1 rounded text-[9px] font-mono whitespace-nowrap transition-all active:scale-95"
                style={{
                  background: processing ? "transparent" : "var(--t-key-chip-bg)",
                  color: processing ? "var(--t-dim)" : "var(--t-accent)",
                  border: `1px solid ${processing ? "var(--t-border-faint)" : "var(--t-accent)"}`,
                  opacity: processing ? 0.4 : 1,
                }}
              >
                {cmd}
              </button>
            ))}
            {quickCommands.filter(cmd => !pins.includes(cmd)).map((cmd) => (
              <button
                key={cmd}
                disabled={processing}
                onClick={() => onQuickCommand(cmd)}
                className="shrink-0 px-2.5 py-1 rounded text-[9px] font-mono whitespace-nowrap transition-all active:scale-95"
                style={{
                  background: processing ? "transparent" : "var(--t-key-chip-bg)",
                  color: processing ? "var(--t-dim)" : "var(--t-key-chip-text)",
                  border: `1px solid ${processing ? "var(--t-border-faint)" : "var(--t-border)"}`,
                  opacity: processing ? 0.4 : 1,
                }}
              >
                {cmd}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Key Rows */}
      <div className="px-1 pb-1 space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-[4px] justify-center">
            {row.map((key) => {
              const isSpecial = key === "BACKSPACE" || key === "SHIFT";
              const isSymbol = !!SPECIAL_LABELS[key];
              const label = SPECIAL_LABELS[key] || (key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key);
              const isShiftActive = key === "SHIFT" && shiftOn;
              const ariaLabel = isSymbol ? key.toLowerCase() : label;
              return (
                <button
                  key={`${ri}-${key}`}
                  disabled={processing}
                  onClick={() => { hapticTick(); onKey(key); }}
                  aria-label={ariaLabel}
                  className="rounded font-mono flex items-center justify-center transition-transform active:scale-95"
                  style={{
                    width: isSpecial ? "10.5%" : "9.2%",
                    height: keyHeight,
                    fontSize: isSymbol ? symbolSize : fontSize,
                    fontWeight: 500,
                    background: isShiftActive ? "var(--t-key-active)" : isSpecial ? "var(--t-key-special)" : "var(--t-key-bg)",
                    color: isShiftActive ? "var(--t-bright)" : "var(--t-key-text)",
                    textShadow: "var(--t-key-text-shadow)",
                    border: "1px solid var(--t-key-border)",
                    boxShadow: "0 1px 0 var(--t-key-border)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ))}

        {/* Bottom row: specials */}
        <div className="flex gap-[4px] justify-center">
          <button
            disabled={processing}
            onClick={() => { hapticTick(); onKey(numMode ? "ABC" : "123"); }}
            className="rounded text-[11px] font-mono flex items-center justify-center transition-transform active:scale-95"
            style={{
              width: "12%",
              height: keyHeight,
              fontWeight: 500,
              background: "var(--t-key-special)",
              color: "var(--t-key-text)",
              textShadow: "var(--t-key-text-shadow)",
              border: "1px solid var(--t-key-border)",
              boxShadow: "0 1px 0 var(--t-key-border)",
            }}
          >
            {numMode ? "ABC" : "123"}
          </button>
          <KeyBtn label={SPECIAL_LABELS.PASTE} onClick={() => { hapticTick(); onKey("PASTE"); }} processing={processing} height={keyHeight} />
          <KeyBtn label="@" onClick={() => { hapticTick(); onKey("@"); }} processing={processing} height={keyHeight} />
          <KeyBtn label="&quot;" onClick={() => { hapticTick(); onKey('"'); }} processing={processing} height={keyHeight} />
          <button
            disabled={processing}
            onClick={() => { hapticTick(); onKey("SPACE"); }}
            className="rounded text-[11px] font-mono flex items-center justify-center transition-transform active:scale-95"
            style={{
              flex: "1",
              height: keyHeight,
              fontWeight: 500,
              background: "var(--t-key-bg)",
              color: "var(--t-key-text)",
              textShadow: "var(--t-key-text-shadow)",
              border: "1px solid var(--t-key-border)",
              boxShadow: "0 1px 0 var(--t-key-border)",
            }}
          >
            {SPECIAL_LABELS.SPACE}
          </button>
          <KeyBtn label={SPECIAL_LABELS.TAB} onClick={() => { hapticTick(); onKey("TAB"); }} processing={processing} height={keyHeight} />
          <KeyBtn label={SPECIAL_LABELS.UP} onClick={() => { hapticTick(); onKey("UP"); }} processing={processing} height={keyHeight} />
          <KeyBtn label={SPECIAL_LABELS.DOWN} onClick={() => { hapticTick(); onKey("DOWN"); }} processing={processing} height={keyHeight} />
          <button
            disabled={processing}
            onClick={() => { hapticEnter(); onKey("ENTER"); }}
            className="rounded text-[12px] font-mono font-bold flex items-center justify-center transition-transform active:scale-95"
            style={{
              width: "15%",
              height: keyHeight,
              background: "var(--t-accent)",
              color: "var(--t-bg)",
              border: "1px solid var(--t-accent)",
              boxShadow: "0 1px 0 var(--t-key-border)",
            }}
          >
            {SPECIAL_LABELS.ENTER}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyBtn({ label, onClick, processing, height = "42px" }: { label: string; onClick: () => void; processing: boolean; height?: string }) {
  return (
    <button
      disabled={processing}
      onClick={onClick}
      className="rounded text-[13px] font-mono flex items-center justify-center transition-transform active:scale-95"
      style={{
        width: "9.2%",
        height,
        fontWeight: 500,
        background: "var(--t-key-bg)",
        color: "var(--t-key-text)",
        textShadow: "var(--t-key-text-shadow)",
        border: "1px solid var(--t-key-border)",
        boxShadow: "0 1px 0 var(--t-key-border)",
      }}
    >
      {label}
    </button>
  );
}

/* ═══════ UPGRADE WIDGET ═══════ */

function UpgradeWidget({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { address } = useAccount();
  const [plan, setPlan] = useState<"weekly" | "daily">("weekly");
  const [step, setStep] = useState<"idle" | "approving" | "buying" | "success">("idle");

  const price = plan === "weekly" ? WEEKLY_PRICE : DAILY_PRICE;
  const priceLabel = plan === "weekly" ? "$2.00" : "$0.50";
  const planLabel = plan === "weekly" ? "7 days" : "24 hours";

  // USDC balance
  const { data: usdcBalance } = useReadContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  // USDC allowance
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: "allowance",
    args: address ? [address as `0x${string}`, PRO_PASS_CONTRACT] : undefined,
    query: { enabled: !!address },
  });

  // Pro expiry
  const { data: expiresAtData } = useReadContract({
    address: PRO_PASS_CONTRACT,
    abi: PRO_PASS_ABI,
    functionName: "expiresAt",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  const balance = usdcBalance ? Number(usdcBalance) : 0;
  const allowance = usdcAllowance ? Number(usdcAllowance) : 0;
  const hasEnough = balance >= price;
  const needsApproval = allowance < price;
  const balanceDisplay = (balance / 1e6).toFixed(2);
  const expiryTs = expiresAtData ? Number(expiresAtData) : 0;
  const expiryLabel = expiryTs > 0 ? formatProExpiry(expiryTs) : "none";

  // Approve
  const { writeContract: writeApprove, data: approveTxHash, isPending: isApproving, error: approveError, reset: resetApprove } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Buy
  const { writeContract: writeBuy, data: buyTxHash, isPending: isBuying, error: buyError, reset: resetBuy } = useWriteContract();
  const { isLoading: buyConfirming, isSuccess: buyConfirmed } = useWaitForTransactionReceipt({ hash: buyTxHash });

  // After approval → auto buy
  useEffect(() => {
    if (approveConfirmed && step === "approving") {
      refetchAllowance();
      setStep("buying");
      resetBuy();
      writeBuy({
        address: PRO_PASS_CONTRACT,
        abi: PRO_PASS_ABI,
        functionName: plan === "weekly" ? "buyWeekly" : "buyDaily",
      });
    }
  }, [approveConfirmed, step, refetchAllowance, resetBuy, writeBuy, plan]);

  // After buy confirmed
  useEffect(() => {
    if (buyConfirmed && step === "buying") {
      setStep("success");
      if (address) {
        localStorage.setItem(`pro-purchased-${address.toLowerCase()}`, Date.now().toString());
      }
      onSuccess();
    }
  }, [buyConfirmed, step, address, onSuccess]);

  // Error recovery
  useEffect(() => {
    if (approveError && step === "approving") setStep("idle");
  }, [approveError, step]);
  useEffect(() => {
    if (buyError && step === "buying") setStep("idle");
  }, [buyError, step]);

  const APPROVE_AMOUNT = BigInt(price) * 52n;

  const handleBuy = () => {
    if (!address) return;
    if (needsApproval) {
      setStep("approving");
      resetApprove();
      writeApprove({
        address: USDC_CONTRACT,
        abi: USDC_ABI,
        functionName: "approve",
        args: [PRO_PASS_CONTRACT, APPROVE_AMOUNT],
      });
    } else {
      setStep("buying");
      resetBuy();
      writeBuy({
        address: PRO_PASS_CONTRACT,
        abi: PRO_PASS_ABI,
        functionName: plan === "weekly" ? "buyWeekly" : "buyDaily",
      });
    }
  };

  const isProcessing = isApproving || approveConfirming || isBuying || buyConfirming;
  const stepLabel = step === "approving"
    ? (approveConfirming ? "confirming approval..." : "approve USDC spend...")
    : step === "buying"
      ? (buyConfirming ? "confirming purchase..." : "purchasing pass...")
      : null;

  if (!address) {
    return (
      <div className="animate-fade-in pl-2 py-2">
        <div className="rounded px-3 py-3 max-w-sm" style={{ border: "1px solid var(--t-border)", background: "var(--t-card)" }}>
          <div className="text-[10px]" style={{ color: "var(--t-error)" }}>no wallet connected. connect via farcaster to purchase.</div>
          <button onClick={onCancel} className="mt-2 text-[9px] underline" style={{ color: "var(--t-muted)" }}>dismiss</button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pl-2 py-2">
      <div className="rounded px-3 py-3 max-w-sm upsell-glow" style={{ border: "1px solid var(--t-border)", background: "var(--t-card)" }}>
        <div className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--t-accent)" }}>
          purchase pro pass
        </div>

        {/* Plan selector */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setPlan("weekly")}
            className="flex-1 py-1.5 rounded text-[10px] font-bold text-center"
            style={{
              border: `1px solid ${plan === "weekly" ? "var(--t-accent)" : "var(--t-border)"}`,
              background: plan === "weekly" ? "var(--t-hover)" : "transparent",
              color: plan === "weekly" ? "var(--t-bright)" : "var(--t-muted)",
            }}
          >
            weekly $2.00
          </button>
          <button
            onClick={() => setPlan("daily")}
            className="flex-1 py-1.5 rounded text-[10px] font-bold text-center"
            style={{
              border: `1px solid ${plan === "daily" ? "var(--t-accent)" : "var(--t-border)"}`,
              background: plan === "daily" ? "var(--t-hover)" : "transparent",
              color: plan === "daily" ? "var(--t-bright)" : "var(--t-muted)",
            }}
          >
            daily $0.50
          </button>
        </div>

        {/* Info */}
        <div className="text-[9px] space-y-0.5 mb-2" style={{ color: "var(--t-dim)" }}>
          <div>plan: {planLabel} for {priceLabel} USDC</div>
          <div>balance: {balanceDisplay} USDC</div>
          <div>status: {expiryLabel}</div>
        </div>

        {!hasEnough && (
          <div className="text-[9px] mb-2" style={{ color: "var(--t-error)" }}>
            insufficient USDC. need {(price / 1e6).toFixed(2)} USDC on Base.
          </div>
        )}

        {/* Status */}
        {stepLabel && (
          <div className="text-[9px] mb-2 flex items-center gap-1" style={{ color: "var(--t-info)" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--t-dot)" }} />
            {stepLabel}
          </div>
        )}

        {approveError && (
          <div className="text-[9px] mb-2" style={{ color: "var(--t-error)" }}>approval failed. try again.</div>
        )}
        {buyError && (
          <div className="text-[9px] mb-2" style={{ color: "var(--t-error)" }}>purchase failed. try again.</div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleBuy}
            disabled={!hasEnough || isProcessing}
            className="flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-transform active:scale-95"
            style={{
              background: hasEnough && !isProcessing ? "var(--t-accent)" : "var(--t-border)",
              color: hasEnough && !isProcessing ? "var(--t-bg)" : "var(--t-muted)",
            }}
          >
            {isProcessing ? "processing..." : needsApproval ? "approve & buy" : `buy ${plan}`}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-[10px]"
            style={{ border: "1px solid var(--t-border)", color: "var(--t-muted)" }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════ PRO BADGE ═══════ */

function ProBadge({ expiresAt, isTrial }: { expiresAt: number; isTrial?: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  const expLabel = diff > 0 && diff < 86400
    ? `${Math.floor(diff / 3600)}h`
    : diff > 0 && diff < 604800
      ? `${Math.floor(diff / 86400)}d`
      : null;
  const label = isTrial ? "trial" : "pro";
  const urgent = isTrial && diff > 0 && diff < 86400;
  return (
    <span className={`text-[8px] uppercase tracking-[0.15em] px-1 py-0.5 rounded font-medium ${isTrial ? "" : "pro-shimmer"}`}
      style={{ color: urgent ? "var(--t-accent)" : "var(--t-bright)", border: `1px solid ${urgent ? "var(--t-accent)" : "var(--t-border)"}` }}>
      {label}{expLabel ? ` · ${expLabel}` : ""}
    </span>
  );
}

/* ═══════ LINE RENDERER ═══════ */

/* ── Detect tappable cell values ── */
function cellAction(key: string, value: string, row?: Record<string, unknown>): string | null {
  const v = value.trim();
  // Row with hidden _cmd → entire row is an action button
  if (row?._cmd) {
    return String(row._cmd);
  }
  // @username → open profile
  if ((key === "author" || key === "username" || key === "from") && v.startsWith("@")) {
    return `/open ${v}`;
  }
  // hash column → open cast
  if (key === "hash" && /^0x[a-f0-9]/i.test(v)) {
    return `/read ${v}`;
  }
  // text column → read cast using hidden _hash
  if (key === "text" && row?._hash) {
    return `/read ${row._hash}`;
  }
  // /channel → channel info
  if (key === "channel" && v.startsWith("/")) {
    return `/channel ${v.slice(1)}`;
  }
  // lead column → open profile
  if (key === "lead" && v.startsWith("@")) {
    return `/open ${v}`;
  }
  return null;
}

/* ═══════ PARSED TEXT (tappable @mentions) ═══════ */

function ParsedText({ text, onTap }: { text: string; onTap?: (cmd: string) => void }) {
  const parts = text.split(/(@[\w.]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^@[\w.]+$/.test(part) ? (
          <span
            key={i}
            style={{ color: "var(--t-accent)", cursor: onTap ? "pointer" : undefined }}
            onClick={onTap ? (e) => { e.stopPropagation(); onTap(`/open ${part}`); hapticSelect(); } : undefined}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function TableWithScrollHint({ data, keys, onTap, onCellLongPress, onCellTouchEnd }: {
  data: Record<string, unknown>[];
  keys: string[];
  onTap?: (cmd: string) => void;
  onCellLongPress?: (value: string) => void;
  onCellTouchEnd?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setCanScroll(el.scrollWidth > el.clientWidth + 4);
    check();
    const onScroll = () => {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      setCanScroll(!atEnd && el.scrollWidth > el.clientWidth + 4);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [data]);

  return (
    <div className="animate-fade-in pl-2 py-1 relative">
      <div ref={scrollRef} className="overflow-x-auto scrollbar-hide">
        <table className="text-[10px] border-collapse w-full">
          <thead>
            <tr>
              {keys.map((key) => (
                <th key={key} className="text-left pr-3 pb-1 font-normal uppercase tracking-wider whitespace-nowrap"
                  style={{ color: "var(--t-header)", borderBottom: "1px solid var(--t-border-dim)" }}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="transition-colors" style={{ borderBottom: "1px solid var(--t-border-faint)" }}>
                {keys.map((key) => {
                  const val = String(row[key] ?? "—");
                  const action = onTap ? cellAction(key, val, row as Record<string, unknown>) : null;
                  return action ? (
                    <td key={key} className="pr-3 py-1 max-w-[120px] truncate cursor-pointer"
                      style={{ color: "var(--t-accent)" }}
                      onClick={(e) => { e.stopPropagation(); hapticSelect(); onTap!(action); }}
                      onTouchStart={onCellLongPress ? () => onCellLongPress(val) : undefined}
                      onTouchEnd={onCellTouchEnd}
                      onTouchMove={onCellTouchEnd}
                      onContextMenu={(e) => e.preventDefault()}>
                      {val}
                    </td>
                  ) : (
                    <td key={key} className="pr-3 py-1 max-w-[120px] truncate" style={{ color: "var(--t-cell)" }}
                      onTouchStart={onCellLongPress ? () => onCellLongPress(val) : undefined}
                      onTouchEnd={onCellTouchEnd}
                      onTouchMove={onCellTouchEnd}
                      onContextMenu={(e) => e.preventDefault()}>
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canScroll && (
        <div className="absolute right-0 top-0 bottom-4 w-6 flex items-center justify-center pointer-events-none"
          style={{ background: "linear-gradient(to right, transparent, var(--t-bg))" }}>
          <span className="text-[9px] animate-pulse" style={{ color: "var(--t-dim)" }}>→</span>
        </div>
      )}
      <div className="text-[9px] mt-1" style={{ color: "var(--t-table-footer)" }}>{data.length} record{data.length !== 1 ? "s" : ""}</div>
    </div>
  );
}

const LineRenderer = memo(function LineRenderer({ line, onTap, onCellLongPress, onCellTouchEnd }: { line: OutputLine; onTap?: (cmd: string) => void; onCellLongPress?: (value: string) => void; onCellTouchEnd?: () => void }) {
  switch (line.type) {
    case "command":
      return (
        <div className="text-xs animate-fade-in py-0.5">
          <span style={{ color: "var(--t-muted)" }}>$ </span>
          <span className="font-medium" style={{ color: "var(--t-bright)" }}>{line.content}</span>
        </div>
      );
    case "result":
      return (
        <div className="text-xs animate-fade-in pl-2 py-0.5 leading-relaxed flex">
          <span className="shrink-0 w-0.5 mr-1.5 rounded-full self-stretch" style={{ background: "var(--t-accent)", opacity: 0.4 }} />
          <span className="min-w-0" style={{ color: "var(--t-text)" }}><ParsedText text={line.content} onTap={onTap} /></span>
        </div>
      );
    case "error":
      return <div className="text-xs animate-fade-in pl-2 py-0.5" style={{ color: "var(--t-error)" }}>{line.content}</div>;
    case "info":
      return <div className="text-xs animate-fade-in pl-2 py-0.5" style={{ color: "var(--t-info)" }}>{line.content || "\u00a0"}</div>;
    case "system":
      return <div className="text-[10px] animate-fade-in uppercase tracking-[0.15em] py-0.5" style={{ color: "var(--t-system)" }}>{line.content || "\u00a0"}</div>;
    case "ascii":
      return <pre className="text-[9px] leading-tight animate-fade-in whitespace-pre font-mono py-1 overflow-x-auto scrollbar-hide" style={{ color: "var(--t-accent)" }}>{line.content}</pre>;
    case "table": {
      const data = line.data as Record<string, unknown>[] | undefined;
      if (!data || data.length === 0) return null;
      const allKeys = Object.keys(data[0]);
      const keys = allKeys.filter((k) => !k.startsWith("_"));

      // Action chip mode: rows with _cmd render as horizontal tappable buttons
      const isActionChips = data.every((row) => "_cmd" in row);
      if (isActionChips && onTap) {
        return (
          <div className="animate-fade-in pl-2 py-1 flex flex-wrap gap-1.5">
            {data.map((row, i) => (
              <button
                key={i}
                className="px-2.5 py-1 rounded text-[10px] font-mono transition-transform active:scale-95 cursor-pointer"
                style={{ background: "var(--t-card)", color: "var(--t-accent)", border: "1px solid var(--t-border)" }}
                onClick={(e) => { e.stopPropagation(); hapticSelect(); onTap(String(row._cmd)); }}
              >
                {String(row[keys[0]] ?? "")}
              </button>
            ))}
          </div>
        );
      }

      return (
        <TableWithScrollHint data={data} keys={keys} onTap={onTap} onCellLongPress={onCellLongPress} onCellTouchEnd={onCellTouchEnd} />
      );
    }
    case "card":
      return (
        <div className="animate-fade-in pl-2 py-1">
          <div className="rounded px-3 py-2 max-w-sm border-glow" style={{ border: "1px solid var(--t-border)", background: "var(--t-card)" }}>
            <div className="text-[11px] whitespace-pre-wrap font-mono leading-relaxed break-words overflow-hidden" style={{ color: "var(--t-text)" }}><ParsedText text={line.content} onTap={onTap} /></div>
          </div>
        </div>
      );
    default:
      return <div className="text-xs animate-fade-in py-0.5" style={{ color: "var(--t-text)" }}>{line.content}</div>;
  }
});
