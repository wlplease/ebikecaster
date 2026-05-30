"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  BatteryCharging,
  Bike,
  ChevronLeft,
  ChevronRight,
  Crown,
  Flame,
  Gauge,
  Lock,
  Map,
  Play,
  Radio,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import { parseEther } from "viem";
import { useAccount, useConnect, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useFarcasterUser } from "@/components/farcaster-gate";
import {
  DAILY_PRICE,
  PRO_PASS_ABI,
  PRO_PASS_CONTRACT,
  USDC_ABI,
  USDC_CONTRACT,
  WEEKLY_PRICE,
  formatProExpiry,
  useProStatus,
} from "@/lib/pro-pass";

const APP_URL = "https://ebikecaster.vercel.app";
const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS as `0x${string}` | undefined;
const ETH_ADDRESS_REGEX_CLIENT = /^0x[0-9a-f]{40}$/i;
const COURSE_LENGTH = 4200;
const VIEW_DISTANCE = 1180;
const STORAGE_PREFIX = "castercycle";

type RidePhase = "ready" | "riding" | "finished";
type Lane = -1 | 0 | 1;
type EntityKind = "bolt" | "cone" | "pothole" | "barrier" | "ramp";
type LeaderboardScope = "global" | "friends";

type RouteTheme = {
  name: string;
  tagline: string;
  skyTop: string;
  skyBottom: string;
  road: string;
  roadEdge: string;
  accent: string;
  bolt: string;
  hazard: string;
  curb: string;
};

type Skin = {
  id: string;
  name: string;
  frame: string;
  battery: string;
  trail: string;
  unlock: "base" | "streak" | "score" | "pro" | "supporter";
  label: string;
};

type Entity = {
  id: number;
  kind: EntityKind;
  lane: Lane;
  at: number;
  hit?: boolean;
  collected?: boolean;
};

type GameModel = {
  phase: RidePhase;
  dateKey: string;
  route: RouteTheme;
  seed: number;
  distance: number;
  speed: number;
  lane: Lane;
  targetLane: Lane;
  laneOffset: number;
  airborne: number;
  boost: number;
  battery: number;
  score: number;
  pickups: number;
  hits: number;
  boosts: number;
  nearMisses: number;
  combo: number;
  bestCombo: number;
  entities: Entity[];
  submitted: boolean;
};

type Hud = Pick<
  GameModel,
  "phase" | "distance" | "speed" | "battery" | "score" | "pickups" | "hits" | "boosts" | "nearMisses" | "combo" | "bestCombo"
>;

type PersistedStats = {
  bestToday: number;
  bestAll: number;
  streak: number;
  lastRideDate: string | null;
};

type LeaderboardRow = {
  fid: number;
  username: string;
  displayName?: string;
  pfpUrl?: string;
  score: number;
  routeName: string;
  skin: string;
};

const ROUTES: RouteTheme[] = [
  {
    name: "Neon Bike Lane",
    tagline: "thread the signal lights",
    skyTop: "#18224f",
    skyBottom: "#24b7a7",
    road: "#172033",
    roadEdge: "#53f3c4",
    accent: "#ffcc45",
    bolt: "#f9e85b",
    hazard: "#ff5d73",
    curb: "#f7fbff",
  },
  {
    name: "Solar Pier",
    tagline: "coast above the morning water",
    skyTop: "#3e85c5",
    skyBottom: "#f5c75c",
    road: "#28445f",
    roadEdge: "#a2ff9a",
    accent: "#ff6d4a",
    bolt: "#fff06a",
    hazard: "#e14d5b",
    curb: "#e7f7ff",
  },
  {
    name: "Market Loop",
    tagline: "squeeze past carts and crosswalks",
    skyTop: "#5a4bb0",
    skyBottom: "#f0846d",
    road: "#263449",
    roadEdge: "#7cf2ff",
    accent: "#ffd166",
    bolt: "#ffe45e",
    hazard: "#ff6b6b",
    curb: "#ffffff",
  },
  {
    name: "Rainline Express",
    tagline: "ride clean through slick streets",
    skyTop: "#274b6d",
    skyBottom: "#8fd6d0",
    road: "#21333d",
    roadEdge: "#b4f06d",
    accent: "#f7b267",
    bolt: "#fff275",
    hazard: "#f25f5c",
    curb: "#d7f8ff",
  },
  {
    name: "Hilltop Circuit",
    tagline: "climb, boost, and float the downhill",
    skyTop: "#206a8a",
    skyBottom: "#c8e17a",
    road: "#31423f",
    roadEdge: "#67e8f9",
    accent: "#ffb703",
    bolt: "#fef45d",
    hazard: "#fb4d3d",
    curb: "#f3fff5",
  },
];

const SKINS: Skin[] = [
  { id: "signal", name: "Signal Yellow", frame: "#fbe764", battery: "#7cf2ff", trail: "#fbe764", unlock: "base", label: "starter" },
  { id: "mint", name: "Courier Mint", frame: "#7cf2ff", battery: "#a2ff9a", trail: "#a2ff9a", unlock: "streak", label: "3 day streak" },
  { id: "sunset", name: "Sunset Dash", frame: "#ff6d4a", battery: "#ffe45e", trail: "#ffb703", unlock: "score", label: "5k score" },
  { id: "spark", name: "Base Spark", frame: "#0052ff", battery: "#fbe764", trail: "#7cf2ff", unlock: "supporter", label: "ETH support" },
  { id: "carbon", name: "Carbon Pro", frame: "#f7fbff", battery: "#c4b5fd", trail: "#c4b5fd", unlock: "pro", label: "Cycle Pass" },
];

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateSeed(key: string) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function yesterdayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildEntities(seed: number) {
  const random = mulberry32(seed);
  const entities: Entity[] = [];
  let at = 360;
  let id = 1;

  while (at < COURSE_LENGTH - 220) {
    at += 130 + random() * 115;
    const lane = ([-1, 0, 1] as Lane[])[Math.floor(random() * 3)];
    const roll = random();

    if (roll < 0.34) {
      entities.push({ id: id++, kind: "bolt", lane, at });
      if (random() > 0.62) entities.push({ id: id++, kind: "bolt", lane, at: at + 72 });
    } else if (roll < 0.52) {
      entities.push({ id: id++, kind: "cone", lane, at });
    } else if (roll < 0.68) {
      entities.push({ id: id++, kind: "pothole", lane, at });
    } else if (roll < 0.84) {
      entities.push({ id: id++, kind: "barrier", lane, at });
    } else {
      entities.push({ id: id++, kind: "ramp", lane, at });
    }
  }

  return entities;
}

function makeGame() {
  const dateKey = localDateKey();
  const seed = dateSeed(dateKey);
  return {
    phase: "ready" as RidePhase,
    dateKey,
    route: ROUTES[seed % ROUTES.length],
    seed,
    distance: 0,
    speed: 310,
    lane: 0 as Lane,
    targetLane: 0 as Lane,
    laneOffset: 0,
    airborne: 0,
    boost: 0,
    battery: 100,
    score: 0,
    pickups: 0,
    hits: 0,
    boosts: 0,
    nearMisses: 0,
    combo: 0,
    bestCombo: 0,
    entities: buildEntities(seed),
    submitted: false,
  };
}

function emptyHud(game: GameModel): Hud {
  return {
    phase: game.phase,
    distance: game.distance,
    speed: game.speed,
    battery: game.battery,
    score: game.score,
    pickups: game.pickups,
    hits: game.hits,
    boosts: game.boosts,
    nearMisses: game.nearMisses,
    combo: game.combo,
    bestCombo: game.bestCombo,
  };
}

function finalScore(game: GameModel) {
  const cleanBonus = game.hits === 0 ? 1250 : Math.max(0, 520 - game.hits * 95);
  return Math.round(
    game.distance * 0.88 +
      game.pickups * 230 +
      game.boosts * 320 +
      game.nearMisses * 140 +
      game.bestCombo * 95 +
      game.battery * 18 +
      cleanBonus,
  );
}

function skinShortName(name: string) {
  return name
    .replace(" Yellow", "")
    .replace(" Dash", "")
    .replace(" Spark", "")
    .replace(" Pro", "");
}

function haptic(kind: "light" | "medium" | "success" | "error") {
  try {
    if (kind === "success") sdk.haptics.notificationOccurred("success");
    else if (kind === "error") sdk.haptics.notificationOccurred("error");
    else sdk.haptics.impactOccurred(kind);
  } catch {}
}

export default function CasterCycleApp() {
  const { user, safeAreaInsets, isStandalone } = useFarcasterUser();
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting } = useConnect();
  const { isPro, expiresAt, loading: proLoading } = useProStatus(address ?? undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameModel>(makeGame());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const lastHudRef = useRef(0);
  const [hud, setHud] = useState<Hud>(() => emptyHud(gameRef.current));
  const [stats, setStats] = useState<PersistedStats>({ bestToday: 0, bestAll: 0, streak: 0, lastRideDate: null });
  const [selectedSkin, setSelectedSkin] = useState("signal");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
  const [ethSupporter, setEthSupporter] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const game = gameRef.current;
  const skin = SKINS.find((item) => item.id === selectedSkin) ?? SKINS[0];
  const displayName = user?.username ? `@${user.username}` : isStandalone ? "browser rider" : "farcaster rider";
  const progress = clamp(hud.distance / COURSE_LENGTH, 0, 1);

  const skinUnlocked = useCallback((item: Skin) => {
    if (item.unlock === "base") return true;
    if (item.unlock === "pro") return isPro;
    if (item.unlock === "supporter") return ethSupporter;
    if (item.unlock === "streak") return stats.streak >= 3;
    if (item.unlock === "score") return Math.max(stats.bestAll, hud.score) >= 5000;
    return false;
  }, [ethSupporter, hud.score, isPro, stats.bestAll, stats.streak]);

  const loadStats = useCallback((dateKey: string) => {
    try {
      setStats({
        bestToday: Number(localStorage.getItem(`${STORAGE_PREFIX}:best:${dateKey}`) || "0"),
        bestAll: Number(localStorage.getItem(`${STORAGE_PREFIX}:best:all`) || "0"),
        streak: Number(localStorage.getItem(`${STORAGE_PREFIX}:streak`) || "0"),
        lastRideDate: localStorage.getItem(`${STORAGE_PREFIX}:lastRide`),
      });
      const savedSkin = localStorage.getItem(`${STORAGE_PREFIX}:skin`);
      if (savedSkin && SKINS.some((item) => item.id === savedSkin)) setSelectedSkin(savedSkin);
      setEthSupporter(localStorage.getItem(`${STORAGE_PREFIX}:ethSupporter`) === "1");
    } catch {}
  }, []);

  const publishStats = useCallback((finishedGame: GameModel) => {
    try {
      const todayKey = `${STORAGE_PREFIX}:best:${finishedGame.dateKey}`;
      const allKey = `${STORAGE_PREFIX}:best:all`;
      const lastRide = localStorage.getItem(`${STORAGE_PREFIX}:lastRide`);
      const currentStreak = Number(localStorage.getItem(`${STORAGE_PREFIX}:streak`) || "0");
      const nextStreak =
        lastRide === finishedGame.dateKey
          ? Math.max(1, currentStreak)
          : lastRide === yesterdayKey(finishedGame.dateKey)
            ? currentStreak + 1
            : 1;
      const bestToday = Math.max(Number(localStorage.getItem(todayKey) || "0"), finishedGame.score);
      const bestAll = Math.max(Number(localStorage.getItem(allKey) || "0"), finishedGame.score);

      localStorage.setItem(todayKey, String(bestToday));
      localStorage.setItem(allKey, String(bestAll));
      localStorage.setItem(`${STORAGE_PREFIX}:streak`, String(nextStreak));
      localStorage.setItem(`${STORAGE_PREFIX}:lastRide`, finishedGame.dateKey);
      setStats({ bestToday, bestAll, streak: nextStreak, lastRideDate: finishedGame.dateKey });
    } catch {}
  }, []);

  const syncHud = useCallback(() => setHud(emptyHud(gameRef.current)), []);

  const loadLeaderboard = useCallback(async (scope: LeaderboardScope = leaderboardScope) => {
    const current = gameRef.current;
    try {
      const url = `/api/scores?dateKey=${encodeURIComponent(current.dateKey)}&scope=${scope}&fid=${user?.fid ?? 0}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.rows)) setLeaderboard(data.rows);
    } catch {}
  }, [leaderboardScope, user?.fid]);

  const submitScore = useCallback(async (finishedGame: GameModel) => {
    if (finishedGame.submitted) return;
    finishedGame.submitted = true;
    const body = {
      dateKey: finishedGame.dateKey,
      routeName: finishedGame.route.name,
      score: finishedGame.score,
      distance: Math.round(finishedGame.distance),
      battery: Math.round(finishedGame.battery),
      pickups: finishedGame.pickups,
      hits: finishedGame.hits,
      boosts: finishedGame.boosts,
      nearMisses: finishedGame.nearMisses,
      skin: selectedSkin,
      fid: user?.fid ?? 0,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      pfpUrl: user?.pfpUrl ?? "",
      address: address ?? "",
    };

    if (!user?.fid) {
      setToast("Open in Farcaster for live leaderboard");
      loadLeaderboard();
      return;
    }

    const send = () =>
      sdk.quickAuth.fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      const res = await send();
      if (!res.ok) setToast("Leaderboard auth needed");
    } catch {
      setToast("Leaderboard saved locally");
    } finally {
      loadLeaderboard();
    }
  }, [address, loadLeaderboard, selectedSkin, user]);

  const finishRide = useCallback((reason: "course" | "battery" = "course") => {
    const current = gameRef.current;
    if (current.phase !== "riding") return;
    current.phase = "finished";
    current.score = finalScore(current) - (reason === "battery" ? 300 : 0);
    publishStats(current);
    syncHud();
    submitScore(current);
    haptic(reason === "battery" ? "error" : "success");
  }, [publishStats, submitScore, syncHud]);

  const resetRide = useCallback(() => {
    gameRef.current = makeGame();
    loadStats(gameRef.current.dateKey);
    syncHud();
    haptic("light");
  }, [loadStats, syncHud]);

  const startRide = useCallback(() => {
    if (gameRef.current.phase === "finished") {
      resetRide();
      requestAnimationFrame(() => startRide());
      return;
    }
    if (gameRef.current.phase === "ready") {
      gameRef.current.phase = "riding";
      gameRef.current.score = 0;
      syncHud();
      haptic("medium");
    }
  }, [resetRide, syncHud]);

  const changeLane = useCallback((direction: -1 | 1) => {
    const current = gameRef.current;
    if (current.phase === "ready") {
      startRide();
      return;
    }
    if (current.phase !== "riding") return;
    current.targetLane = clamp(current.targetLane + direction, -1, 1) as Lane;
    haptic("light");
  }, [startRide]);

  const boostOrHop = useCallback(() => {
    const current = gameRef.current;
    if (current.phase === "ready") {
      startRide();
      return;
    }
    if (current.phase !== "riding") return;
    if (current.airborne <= 0 && current.battery > 8) {
      current.airborne = 1;
      current.boost = Math.max(current.boost, 0.4);
      current.battery = clamp(current.battery - 2.2, 0, 100);
      haptic("medium");
    }
  }, [startRide]);

  const shareRide = useCallback(async () => {
    const current = gameRef.current;
    const shareUrl = `${APP_URL}/api/share-image?score=${current.score}&route=${encodeURIComponent(current.route.name)}&user=${encodeURIComponent(displayName)}&skin=${encodeURIComponent(skin.name)}&date=${current.dateKey}`;
    const castText = `I scored ${current.score.toLocaleString()} on today's ${current.route.name} in CasterCycle.\n\n${current.pickups} charge bolts, ${current.boosts} boosts, ${Math.round(current.battery)}% battery left. Beat my ride:\n${APP_URL}`;
    setSharing(true);
    try {
      await sdk.actions.composeCast({ text: castText, embeds: [shareUrl] });
      setToast("Cast composer opened");
      haptic("success");
    } catch {
      try {
        await navigator.clipboard.writeText(castText);
        setToast("Ride copied");
      } catch {
        setToast("Share failed");
      }
    } finally {
      setSharing(false);
    }
  }, [displayName, skin.name]);

  const connectWallet = useCallback(() => {
    const connector = connectors.find((item) => item.id.toLowerCase().includes("farcaster")) ?? connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);

  const unlockEthSupporter = useCallback(() => {
    setEthSupporter(true);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:ethSupporter`, "1");
      localStorage.setItem(`${STORAGE_PREFIX}:skin`, "spark");
    } catch {}
    setSelectedSkin("spark");
  }, []);

  useEffect(() => {
    loadStats(gameRef.current.dateKey);
    loadLeaderboard("global");
  }, [loadLeaderboard, loadStats]);

  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:skin`, selectedSkin);
    } catch {}
  }, [selectedSkin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;

    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    window.addEventListener("orientationchange", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", resize);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        event.preventDefault();
        changeLane(-1);
      }
      if (event.code === "ArrowRight" || event.code === "KeyD") {
        event.preventDefault();
        changeLane(1);
      }
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        boostOrHop();
      }
      if (event.code === "Enter" && gameRef.current.phase !== "riding") {
        event.preventDefault();
        startRide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boostOrHop, changeLane, startRide]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const step = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const shell = shellRef.current;
      if (!canvas || !ctx || !shell) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      const width = shell.clientWidth;
      const height = shell.clientHeight;
      const last = lastFrameRef.current ?? now;
      const dt = Math.min(0.034, (now - last) / 1000);
      lastFrameRef.current = now;
      const current = gameRef.current;

      if (current.phase === "riding") {
        const targetOffset = current.targetLane;
        current.laneOffset += (targetOffset - current.laneOffset) * Math.min(1, dt * 10);
        if (Math.abs(current.targetLane - current.laneOffset) < 0.03) {
          current.lane = current.targetLane;
          current.laneOffset = current.targetLane;
        }

        if (current.airborne > 0) current.airborne = Math.max(0, current.airborne - dt * 2.65);
        if (current.boost > 0) current.boost = Math.max(0, current.boost - dt * 0.85);

        current.speed = clamp(330 + current.boost * 190 + current.distance * 0.012, 320, 440);
        current.distance += current.speed * dt;
        current.battery = clamp(current.battery - dt * (1.05 + current.boost * 1.6), 0, 100);

        for (const entity of current.entities) {
          const rel = entity.at - current.distance;
          if (rel < -40 || rel > 120) continue;
          const laneMatch = Math.abs(entity.lane - current.laneOffset) < 0.42;

          if (entity.kind === "bolt" && !entity.collected && laneMatch && rel < 34) {
            entity.collected = true;
            current.pickups += 1;
            current.combo += 1;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.battery = clamp(current.battery + 7.5, 0, 100);
            current.score += 190 + current.combo * 18;
            haptic("light");
          } else if (entity.kind === "ramp" && !entity.hit && laneMatch && rel < 36) {
            entity.hit = true;
            current.boosts += 1;
            current.combo += 1;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.airborne = 1;
            current.boost = 1;
            current.score += 340;
            haptic("medium");
          } else if (entity.kind !== "bolt" && entity.kind !== "ramp" && !entity.hit && rel < 22) {
            entity.hit = true;
            if (laneMatch && current.airborne <= 0.35) {
              current.hits += 1;
              current.combo = 0;
              current.battery = clamp(current.battery - (entity.kind === "pothole" ? 13 : 11), 0, 100);
              current.boost = 0;
              haptic("error");
            } else if (!laneMatch && Math.abs(entity.lane - current.laneOffset) < 1.18) {
              current.nearMisses += 1;
              current.score += 120;
              haptic("light");
            }
          }
        }

        current.score = Math.max(
          current.score,
          Math.round(current.distance * 0.8 + current.pickups * 190 + current.boosts * 250 + current.nearMisses * 110 - current.hits * 85),
        );

        if (current.distance >= COURSE_LENGTH) finishRide("course");
        if (current.battery <= 0) finishRide("battery");
      }

      drawScene(ctx, width, height, current, skin, now);
      if (now - lastHudRef.current > 90) {
        lastHudRef.current = now;
        syncHud();
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [finishRide, skin, syncHud]);

  const resultLabel = useMemo(() => {
    if (hud.phase !== "finished") return "daily ride";
    if (hud.hits === 0) return "clean commute";
    if (hud.nearMisses >= 4) return "threaded traffic";
    if (hud.boosts >= 3) return "boost specialist";
    return hud.battery <= 0 ? "battery tapped" : "ride complete";
  }, [hud.battery, hud.boosts, hud.hits, hud.nearMisses, hud.phase]);

  return (
    <main
      ref={shellRef}
      className="relative mx-auto h-dvh w-full max-w-[520px] overflow-hidden bg-[#101b26] text-white"
      style={{ paddingTop: safeAreaInsets.top, paddingBottom: safeAreaInsets.bottom }}
    >
      <canvas
        ref={canvasRef}
        aria-label="CasterCycle forward-scrolling e-bike game"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          if (x < rect.width * 0.34) changeLane(-1);
          else if (x > rect.width * 0.66) changeLane(1);
          else boostOrHop();
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,17,27,0.08),transparent_24%,transparent_70%,rgba(7,17,27,0.48))]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-3">
        <div className="flex items-center justify-between gap-2 rounded-md border border-white/15 bg-black/28 px-3 py-2 shadow-xl backdrop-blur-md">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#fbe764]">
              <Image src="/media/castercycle.png" alt="" width={20} height={20} className="rounded object-cover" />
              CasterCycle
            </div>
            <div className="truncate text-[10px] font-semibold text-white/72">{game.route.name} - {game.route.tagline}</div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold">
            <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <Trophy size={13} />
              {hud.score.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <BatteryCharging size={13} />
              {Math.round(hud.battery)}%
            </span>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
          <div className="h-full rounded-full bg-[#fbe764]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>

      {hud.phase === "riding" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
          <div className="grid grid-cols-4 gap-2">
            <Metric icon={<Gauge size={14} />} label="speed" value={`${Math.round(hud.speed / 8)} mph`} />
            <Metric icon={<Zap size={14} />} label="bolts" value={String(hud.pickups)} />
            <Metric icon={<Sparkles size={14} />} label="misses" value={String(hud.nearMisses)} />
            <Metric icon={<Bike size={14} />} label="lane" value={game.targetLane === -1 ? "left" : game.targetLane === 1 ? "right" : "mid"} />
          </div>
          <div className="mt-2 rounded-full border border-white/20 bg-black/30 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-white/78 backdrop-blur-md">
            tap left or right to switch lanes - tap center to hop
          </div>
        </div>
      )}

      {hud.phase !== "riding" && (
        <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 px-3 pb-3">
          <div className="no-scrollbar max-h-[88dvh] overflow-y-auto overscroll-contain rounded-md border border-white/15 bg-[#111923]/92 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7cf2ff]">{resultLabel}</div>
                <h1 className="mt-1 text-3xl font-black leading-none tracking-normal text-white">CasterCycle</h1>
                <p className="mt-2 max-w-[22rem] text-sm font-medium leading-5 text-white/76">
                  {hud.phase === "finished"
                    ? `${displayName} scored ${hud.score.toLocaleString()} on ${game.route.name}.`
                    : `A daily Farcaster e-bike sprint: dodge street clutter, chain boost ramps, collect charge, and cast the score your friends have to beat.`}
                </p>
              </div>
              <div className="shrink-0">
                <Image
                  src="/media/castercycle.png"
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-md border border-white/15 object-cover shadow-lg"
                />
                <div className="-mt-3 ml-auto w-fit rounded bg-[#fbe764] px-2 py-1 text-right text-[#111923] shadow-lg">
                  <div className="text-[9px] font-black uppercase leading-none">streak</div>
                  <div className="text-lg font-black leading-none">{stats.streak}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <SignalChip icon={<Map size={13} />} label="route" value={game.route.name} />
              <SignalChip icon={<Users size={13} />} label="rider" value={displayName} />
              <SignalChip icon={<Radio size={13} />} label="daily" value={game.dateKey.slice(5)} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <ResultStat label="today" value={Math.max(stats.bestToday, hud.score).toLocaleString()} />
              <ResultStat label="best" value={Math.max(stats.bestAll, hud.score).toLocaleString()} />
              <ResultStat label="skin" value={skinShortName(skin.name)} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <FeatureChip icon={<Flame size={13} />} label="streaks" />
              <FeatureChip icon={<Trophy size={13} />} label="friends" />
              <FeatureChip icon={<Wallet size={13} />} label="base" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-4 text-sm font-black text-[#111923] transition active:scale-[0.98]"
                onClick={startRide}
              >
                {hud.phase === "finished" ? <RotateCcw size={18} /> : <Play size={18} />}
                {hud.phase === "finished" ? "Ride Again" : "Ride Today"}
              </button>
              <button
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#7cf2ff] px-4 text-sm font-black text-[#111923] transition active:scale-[0.98] disabled:opacity-70"
                disabled={hud.phase !== "finished" || sharing}
                onClick={shareRide}
              >
                <Share2 size={18} />
                {sharing ? "Opening" : "Share"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/8 px-3 text-xs font-black text-white"
                onClick={connectWallet}
                disabled={isConnected || connecting}
              >
                <Wallet size={15} />
                {isConnected ? "Wallet Ready" : connecting ? "Connecting" : "Connect Wallet"}
              </button>
              <div className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/8 px-3 text-xs font-black text-white">
                <ShieldCheck size={15} />
                {proLoading ? "Checking" : isPro ? formatProExpiry(expiresAt) : "Cycle Pass"}
              </div>
            </div>

            <UpgradePanel
              enabled={isConnected}
              isPro={isPro}
              onConnect={connectWallet}
              onEthSupport={unlockEthSupporter}
            />
            <SkinPicker skins={SKINS} selected={selectedSkin} isUnlocked={skinUnlocked} onSelect={setSelectedSkin} />
            <Leaderboard
              rows={leaderboard}
              scope={leaderboardScope}
              onScope={(scope) => {
                setLeaderboardScope(scope);
                loadLeaderboard(scope);
              }}
            />
          </div>
        </section>
      )}

      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-2 text-white/45">
        <ChevronLeft size={26} />
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-2 text-white/45">
        <ChevronRight size={26} />
      </div>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center px-4">
          <div className="rounded-md bg-[#fbe764] px-3 py-2 text-sm font-black text-[#111923] shadow-xl">{toast}</div>
        </div>
      )}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/14 bg-black/28 px-2 py-2 text-white shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between text-[#fbe764]">{icon}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">{label}</div>
      <div className="truncate text-sm font-black leading-tight">{value}</div>
    </div>
  );
}

function SignalChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-h-14 rounded-md border border-white/12 bg-white/8 px-2 py-2">
      <div className="flex items-center gap-1 text-[#7cf2ff]">{icon}<span className="text-[9px] font-black uppercase tracking-[0.12em] text-white/45">{label}</span></div>
      <div className="mt-1 truncate text-[11px] font-black leading-tight text-white">{value}</div>
    </div>
  );
}

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/18 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-white/72">
      <span className="text-[#fbe764]">{icon}</span>
      {label}
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/9 px-2 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">{label}</div>
      <div className="truncate text-base font-black leading-tight text-white">{value}</div>
    </div>
  );
}

function SkinPicker({
  skins,
  selected,
  isUnlocked,
  onSelect,
}: {
  skins: Skin[];
  selected: string;
  isUnlocked: (skin: Skin) => boolean;
  onSelect: (skin: string) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/52">
        <Bike size={13} />
        skins
      </div>
      <div className="grid grid-cols-5 gap-2">
        {skins.map((skin) => {
          const unlocked = isUnlocked(skin);
          return (
            <button
              key={skin.id}
              className="min-h-16 rounded-md border px-1.5 py-2 text-left transition active:scale-[0.98]"
              style={{
                borderColor: selected === skin.id ? skin.trail : "rgba(255,255,255,0.14)",
                background: selected === skin.id ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)",
              }}
              aria-label={`${skin.name}: ${skin.label}`}
              title={`${skin.name}: ${skin.label}`}
              onClick={() => unlocked && onSelect(skin.id)}
            >
              <span className="mb-1 flex items-center justify-between">
                <span className="h-3 w-3 rounded-full" style={{ background: skin.frame }} />
                {!unlocked && <Lock size={12} className="text-white/55" />}
              </span>
              <span className="block text-[10px] font-black leading-tight text-white">{skinShortName(skin.name)}</span>
              <span className="block text-[9px] font-bold leading-tight text-white/45">{skin.label.replace(" day streak", "d").replace(" score", "")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Leaderboard({
  rows,
  scope,
  onScope,
}: {
  rows: LeaderboardRow[];
  scope: LeaderboardScope;
  onScope: (scope: LeaderboardScope) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/52">
          <Trophy size={13} />
          leaderboard
        </div>
        <div className="flex rounded-md bg-white/8 p-0.5">
          {(["global", "friends"] as LeaderboardScope[]).map((item) => (
            <button
              key={item}
              className="rounded px-2 py-1 text-[10px] font-black uppercase text-white"
              style={{ background: scope === item ? "rgba(124,242,255,0.25)" : "transparent" }}
              onClick={() => onScope(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-32 overflow-hidden rounded-md border border-white/12 bg-white/7">
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-xs font-semibold text-white/50">No server scores yet. Finish a ride to seed today.</div>
        ) : (
          rows.slice(0, 5).map((row, index) => (
            <div key={`${row.fid}-${row.username}-${index}`} className="flex items-center gap-2 border-b border-white/8 px-3 py-2 last:border-b-0">
              <div className="w-5 text-xs font-black text-[#fbe764]">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-white">{row.username ? `@${row.username}` : row.displayName || "rider"}</div>
                <div className="truncate text-[10px] font-bold text-white/45">{row.routeName}</div>
              </div>
              <div className="text-sm font-black text-white">{row.score.toLocaleString()}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UpgradePanel({
  enabled,
  isPro,
  onConnect,
  onEthSupport,
}: {
  enabled: boolean;
  isPro: boolean;
  onConnect: () => void;
  onEthSupport: () => void;
}) {
  const { address } = useAccount();
  const [plan, setPlan] = useState<"daily" | "weekly">("weekly");
  const [step, setStep] = useState<"idle" | "approving" | "buying">("idle");
  const price = BigInt(plan === "weekly" ? WEEKLY_PRICE : DAILY_PRICE);
  const priceLabel = plan === "weekly" ? "$2 weekly" : "$0.50 daily";

  const { data: balance } = useReadContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: "allowance",
    args: address ? [address as `0x${string}`, PRO_PASS_CONTRACT] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract: approve, data: approveHash, reset: resetApprove } = useWriteContract();
  const { writeContract: buy, data: buyHash, reset: resetBuy } = useWriteContract();
  const { sendTransaction, data: ethHash, isPending: sendingEth } = useSendTransaction();
  const { isLoading: approving, isSuccess: approved } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: buying, isSuccess: bought } = useWaitForTransactionReceipt({ hash: buyHash });
  const { isLoading: confirmingEth, isSuccess: ethConfirmed } = useWaitForTransactionReceipt({ hash: ethHash });

  const hasEnough = typeof balance === "bigint" && balance >= price;
  const needsApproval = typeof allowance !== "bigint" || allowance < price;
  const busy = approving || buying || sendingEth || confirmingEth || step !== "idle";
  const treasuryReady = !!TREASURY_ADDRESS && ETH_ADDRESS_REGEX_CLIENT.test(TREASURY_ADDRESS);

  useEffect(() => {
    if (approved && step === "approving") {
      refetchAllowance();
      setStep("buying");
      resetBuy();
      buy({
        address: PRO_PASS_CONTRACT,
        abi: PRO_PASS_ABI,
        functionName: plan === "weekly" ? "buyWeekly" : "buyDaily",
      });
    }
  }, [approved, buy, plan, refetchAllowance, resetBuy, step]);

  useEffect(() => {
    if (bought && step === "buying") setStep("idle");
  }, [bought, step]);

  useEffect(() => {
    if (ethConfirmed) onEthSupport();
  }, [ethConfirmed, onEthSupport]);

  const purchase = () => {
    if (!address) {
      onConnect();
      return;
    }
    if (needsApproval) {
      setStep("approving");
      resetApprove();
      approve({
        address: USDC_CONTRACT,
        abi: USDC_ABI,
        functionName: "approve",
        args: [PRO_PASS_CONTRACT, price * 12n],
      });
    } else {
      setStep("buying");
      resetBuy();
      buy({
        address: PRO_PASS_CONTRACT,
        abi: PRO_PASS_ABI,
        functionName: plan === "weekly" ? "buyWeekly" : "buyDaily",
      });
    }
  };

  const supportWithEth = () => {
    if (!address) {
      onConnect();
      return;
    }
    if (!treasuryReady) return;
    sendTransaction({
      to: TREASURY_ADDRESS,
      value: parseEther("0.0003"),
    });
  };

  return (
    <div className="mt-4 rounded-md border border-[#fbe764]/30 bg-[#fbe764]/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">
            <Crown size={13} />
            Cycle Pass
          </div>
          <div className="mt-1 text-xs font-semibold text-white/64">
            Unlock Carbon Pro skin, premium score flair, and future pro routes. Digital access only.
          </div>
        </div>
        {isPro && <div className="rounded bg-[#a2ff9a] px-2 py-1 text-[10px] font-black text-[#111923]">ACTIVE</div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="rounded-md border px-2 py-2 text-xs font-black text-white"
          style={{ borderColor: plan === "weekly" ? "#fbe764" : "rgba(255,255,255,0.14)" }}
          onClick={() => setPlan("weekly")}
        >
          Weekly $2
        </button>
        <button
          className="rounded-md border px-2 py-2 text-xs font-black text-white"
          style={{ borderColor: plan === "daily" ? "#fbe764" : "rgba(255,255,255,0.14)" }}
          onClick={() => setPlan("daily")}
        >
          Daily $0.50
        </button>
      </div>
      <button
        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#fbe764] px-3 text-xs font-black text-[#111923] disabled:opacity-60"
        disabled={enabled && (!hasEnough || busy)}
        onClick={purchase}
      >
        <Wallet size={15} />
        {!enabled ? "Connect for Base USDC" : busy ? "Confirming" : hasEnough ? `Buy ${priceLabel}` : "Need USDC on Base"}
      </button>
      <button
        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-3 text-xs font-black text-white disabled:opacity-60"
        disabled={enabled && (!treasuryReady || busy)}
        onClick={supportWithEth}
      >
        <Sparkles size={15} />
        {!enabled ? "Connect for Base ETH" : !treasuryReady ? "Set treasury address" : sendingEth || confirmingEth ? "Confirming ETH" : "Support 0.0003 ETH"}
      </button>
    </div>
  );
}

function lanePoint(width: number, height: number, lane: number, progress: number) {
  const horizon = height * 0.25;
  const bottom = height - 108;
  const y = horizon + progress * (bottom - horizon);
  const spread = 18 + progress * width * 0.28;
  return { x: width / 2 + lane * spread, y, scale: 0.25 + progress * 1.18 };
}

function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, skin: Skin, now: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, game.route.skyTop);
  sky.addColorStop(0.54, game.route.skyBottom);
  sky.addColorStop(1, "#111923");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawWorld(ctx, width, height, game, now);
  drawRoad(ctx, width, height, game);

  const visible = game.entities
    .filter((entity) => !entity.collected && entity.at - game.distance > -60 && entity.at - game.distance < VIEW_DISTANCE)
    .sort((a, b) => b.at - a.at);

  for (const entity of visible) {
    const rel = entity.at - game.distance;
    const progress = 1 - rel / VIEW_DISTANCE;
    drawEntity(ctx, width, height, entity, progress, game.route, now);
  }

  drawPlayer(ctx, width, height, game, skin, now);

  if (game.phase === "ready") drawStartText(ctx, width, height, game);
  if (game.phase === "finished") drawFinishGate(ctx, width, height, game);
}

function drawWorld(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  const horizon = height * 0.25;
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (let i = 0; i < 28; i += 1) {
    const x = ((i * 71 + game.seed) % Math.max(1, width));
    const y = ((i * 29 + game.seed * 0.01 + now * 0.006) % Math.max(1, horizon));
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  const sunX = width * 0.72;
  const sunY = height * 0.16;
  const glow = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 120);
  glow.addColorStop(0, "rgba(255,241,138,0.95)");
  glow.addColorStop(0.45, "rgba(255,174,90,0.3)");
  glow.addColorStop(1, "rgba(255,174,90,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 120, 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i += 1) {
      const loop = (i * 140 - (game.distance * 0.55) % 140 + 140) % 140;
      const progress = loop / 140;
      const y = horizon + progress * (height - horizon);
      const scale = 0.25 + progress * 1.2;
      const x = width / 2 + side * (width * 0.33 + progress * width * 0.28);
      const w = 28 * scale;
      const h = (50 + ((i * 31 + game.seed) % 90)) * scale;
      ctx.fillStyle = side < 0 ? "rgba(45,86,104,0.55)" : "rgba(55,69,109,0.5)";
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.fillStyle = "rgba(255,231,112,0.35)";
      if ((i + Math.round(now / 1000)) % 2 === 0) ctx.fillRect(x - w * 0.18, y - h * 0.72, w * 0.24, h * 0.08);
    }
  }

  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      const loop = (i * 230 - (game.distance * 0.72) % 230 + 230) % 230;
      const progress = loop / 230;
      const y = horizon + progress * (height - horizon);
      const scale = 0.35 + progress * 0.9;
      const x = width / 2 + side * (width * 0.28 + progress * width * 0.34);
      const panelW = 44 * scale;
      const panelH = 30 * scale;
      ctx.save();
      ctx.translate(x, y - 70 * scale);
      ctx.rotate(side * -0.12);
      ctx.fillStyle = "rgba(17,25,35,0.74)";
      ctx.strokeStyle = i % 2 === 0 ? "rgba(124,242,255,0.7)" : "rgba(251,231,100,0.65)";
      ctx.lineWidth = Math.max(1, 2 * scale);
      roundRect(ctx, -panelW / 2, -panelH / 2, panelW, panelH, 5 * scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = i % 2 === 0 ? "#7cf2ff" : "#fbe764";
      ctx.font = `${Math.max(8, 12 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i % 2 === 0 ? "FC" : "CC", 0, 0);
      ctx.restore();
    }
  }
}

function drawRoad(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel) {
  const horizon = height * 0.25;
  const bottom = height - 76;
  const road = ctx.createLinearGradient(0, horizon, 0, bottom);
  road.addColorStop(0, game.route.road);
  road.addColorStop(0.72, "#1f3147");
  road.addColorStop(1, "#101923");
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(width * 0.44, horizon);
  ctx.lineTo(width * 0.56, horizon);
  ctx.lineTo(width * 0.96, bottom);
  ctx.lineTo(width * 0.04, bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    const loop = (i * 88 - (game.distance * 0.9) % 88 + 88) % 88;
    const p = loop / 88;
    const left = lanePoint(width, height, -1.28, p);
    const right = lanePoint(width, height, 1.28, p);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  ctx.strokeStyle = game.route.roadEdge;
  ctx.lineWidth = 4;
  ctx.shadowColor = game.route.roadEdge;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(width * 0.44, horizon);
  ctx.lineTo(width * 0.04, bottom);
  ctx.moveTo(width * 0.56, horizon);
  ctx.lineTo(width * 0.96, bottom);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "rgba(255,255,255,0.36)";
  ctx.lineWidth = 2;
  for (const lane of [-0.5, 0.5]) {
    ctx.beginPath();
    for (let i = 0; i < 15; i += 1) {
      const loop = (i * 94 - (game.distance * 0.8) % 94 + 94) % 94;
      const p1 = loop / 94;
      const p2 = Math.min(1, p1 + 0.18);
      const a = lanePoint(width, height, lane, p1);
      const b = lanePoint(width, height, lane, p2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, width: number, height: number, entity: Entity, progress: number, route: RouteTheme, now: number) {
  const point = lanePoint(width, height, entity.lane, progress);
  const scale = point.scale;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(scale, scale);

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(0, 24, 28, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (entity.kind === "bolt") {
    ctx.rotate(now / 420 + entity.id);
    ctx.fillStyle = route.bolt;
    ctx.shadowColor = route.bolt;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.lineTo(12, -3);
    ctx.lineTo(3, 0);
    ctx.lineTo(8, 18);
    ctx.lineTo(-13, 2);
    ctx.lineTo(-3, -1);
    ctx.closePath();
    ctx.fill();
  } else if (entity.kind === "ramp") {
    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.moveTo(-28, 18);
    ctx.lineTo(30, 18);
    ctx.lineTo(18, -16);
    ctx.lineTo(-18, -16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (entity.kind === "pothole") {
    ctx.fillStyle = "#090f17";
    ctx.beginPath();
    ctx.ellipse(0, 8, 32, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(124,242,255,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (entity.kind === "cone") {
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(24, 24);
    ctx.lineTo(-24, 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillRect(-13, 0, 26, 6);
  } else {
    ctx.fillStyle = route.hazard;
    ctx.fillRect(-28, -24, 56, 48);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(-20, -12, 40, 7);
    ctx.fillRect(-20, 8, 40, 7);
  }

  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, skin: Skin, now: number) {
  const baseY = height - 110 - game.airborne * 42;
  const x = lanePoint(width, height, game.laneOffset, 1).x;
  const lean = (game.targetLane - game.laneOffset) * 0.22;
  const bob = Math.sin(now / 90) * 2;

  ctx.save();
  ctx.translate(x, baseY + bob);
  ctx.rotate(lean);
  if (game.phase === "riding") {
    ctx.strokeStyle = skin.trail;
    ctx.globalAlpha = 0.22 + game.boost * 0.35;
    ctx.lineWidth = 9 + game.boost * 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-36, 42);
    ctx.quadraticCurveTo(-18, 72 + game.boost * 18, -6, 110 + game.boost * 22);
    ctx.moveTo(36, 42);
    ctx.quadraticCurveTo(18, 72 + game.boost * 18, 6, 110 + game.boost * 22);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath();
  ctx.ellipse(0, 38 + game.airborne * 42, 54, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-28, 20);
  ctx.lineTo(-8, -22);
  ctx.lineTo(28, 20);
  ctx.lineTo(3, 0);
  ctx.lineTo(-28, 20);
  ctx.moveTo(-8, -22);
  ctx.lineTo(3, 0);
  ctx.stroke();

  ctx.strokeStyle = skin.battery;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(3, 0);
  ctx.lineTo(22, -36);
  ctx.lineTo(42, -32);
  ctx.moveTo(-8, -22);
  ctx.lineTo(-22, -42);
  ctx.lineTo(-42, -39);
  ctx.stroke();

  ctx.fillStyle = skin.frame;
  ctx.fillRect(-18, -13, 36, 18);
  ctx.fillStyle = "#101923";
  ctx.fillRect(-10, -8, 16, 7);

  drawWheel(ctx, -31, 22, now / 60, skin.trail);
  drawWheel(ctx, 31, 22, now / 60, skin.trail);

  ctx.strokeStyle = "#101923";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-5, -47);
  ctx.lineTo(5, -18);
  ctx.moveTo(0, -34);
  ctx.lineTo(20, -4);
  ctx.moveTo(-1, -34);
  ctx.lineTo(-19, -3);
  ctx.stroke();
  ctx.fillStyle = "#f6d2a8";
  ctx.beginPath();
  ctx.arc(-6, -60, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff5d73";
  ctx.beginPath();
  ctx.ellipse(-6, -70, 16, 7, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, spin: number, accent: string) {
  ctx.strokeStyle = "#eef8ff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    const angle = spin + i * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
    ctx.stroke();
  }
}

function drawStartText(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel) {
  ctx.fillStyle = "rgba(17,25,35,0.42)";
  ctx.fillRect(width * 0.35, height * 0.26, width * 0.3, 48);
  ctx.fillStyle = "#fbe764";
  ctx.font = "900 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(game.route.name.toUpperCase(), width / 2, height * 0.26 + 30);
}

function drawFinishGate(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel) {
  const p = 0.72;
  const left = lanePoint(width, height, -1.4, p);
  const right = lanePoint(width, height, 1.4, p);
  ctx.strokeStyle = "#fbe764";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y - 70);
  ctx.lineTo(left.x, left.y + 20);
  ctx.moveTo(right.x, right.y - 70);
  ctx.lineTo(right.x, right.y + 20);
  ctx.moveTo(left.x, left.y - 70);
  ctx.lineTo(right.x, right.y - 70);
  ctx.stroke();
  ctx.fillStyle = "rgba(17,25,35,0.86)";
  ctx.fillRect(width / 2 - 54, left.y - 96, 108, 30);
  ctx.fillStyle = "#fbe764";
  ctx.font = "900 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(game.score.toLocaleString(), width / 2, left.y - 76);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
