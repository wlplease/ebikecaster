"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Image from "next/image";
import {
  BatteryCharging,
  Bike,
  CheckCircle2,
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
  Target,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  Zap,
} from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import { parseEther } from "viem";
import { useAccount, useChainId, useConnect, useReadContract, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useFarcasterUser } from "@/components/farcaster-gate";
import { CASTER_CREDITS_ABI, CASTER_CREDITS_CONTRACT, type RewardClaimPayload } from "@/lib/reward-credits";
import {
  BASE_CHAIN_ID,
  ETH_SUPPORT_AMOUNT,
  TREASURY_ADDRESS,
  USDC_ABI,
  USDC_CONTRACT,
  WEEKLY_PRICE,
  YEARLY_PRICE,
  formatPassExpiry,
} from "@/lib/pro-pass";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://castercycle.vercel.app";
const SHARE_URL = process.env.NEXT_PUBLIC_SHARE_URL || "https://farcaster.xyz/miniapps/_U8dgupnJBvv/castercycle";
const ETH_ADDRESS_REGEX_CLIENT = /^0x[0-9a-f]{40}$/i;
const COURSE_LENGTH = 11800;
const VIEW_DISTANCE = 1280;
const STORAGE_PREFIX = "castercycle";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const LIFETIME_SECONDS = 80 * 365 * 24 * 60 * 60;

type RidePhase = "ready" | "riding" | "finished";
type Lane = -1 | 0 | 1;
type EntityKind = "bolt" | "cone" | "pothole" | "barrier" | "ramp" | "gate";
type LeaderboardScope = "global" | "friends";
type LeaderboardPeriod = "daily" | "weekly";
type DashboardTab = "ride" | "shop" | "garage" | "club" | "leaders";
type RideArea = "park" | "statePark" | "bikeLand";
type MissionKind = "combo" | "clean" | "boosts" | "battery" | "bolts";
type SfxId = "start" | "lane" | "bolt" | "boost" | "hit" | "clear" | "finish" | "warning" | "near" | "combo";
type VoiceLineId =
  | "ready"
  | "start"
  | "boost"
  | "mission"
  | "finish"
  | "claim"
  | "legal"
  | "lowBattery"
  | "checkpoint"
  | "combo"
  | "nearMiss"
  | "hit"
  | "finalStretch";
type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

type RouteTheme = {
  name: string;
  tagline: string;
  area: RideArea;
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

type DailyMission = {
  kind: MissionKind;
  title: string;
  goal: string;
  target: number;
  reward: number;
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
  mission: DailyMission;
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
  feedback: string;
  feedbackT: number;
  feedbackColor: string;
  shake: number;
  missionNotified: boolean;
  batteryNotified: boolean;
  checkpointNotified: boolean;
  comboVoiceNotified: boolean;
  nearMissVoiceNotified: boolean;
  hitVoiceNotified: boolean;
  finalStretchNotified: boolean;
  entities: Entity[];
  submitted: boolean;
};

type MotorAudio = {
  osc: OscillatorNode;
  sub: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
};

type Hud = Pick<
  GameModel,
  | "phase"
  | "distance"
  | "speed"
  | "battery"
  | "score"
  | "pickups"
  | "hits"
  | "boosts"
  | "nearMisses"
  | "combo"
  | "bestCombo"
  | "targetLane"
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
  dailyScore: number;
  weeklyScore: number;
  routeName: string;
  bestDateKey?: string;
  skin: string;
};

type LoungeMessage = {
  id: string;
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  text: string;
  createdAt: number;
};

const ROUTES: RouteTheme[] = [
  {
    name: "Community Park",
    tagline: "freestyle paths, courts, fields",
    area: "park",
    skyTop: "#4f9bd5",
    skyBottom: "#b9e86f",
    road: "#335244",
    roadEdge: "#9ff28a",
    accent: "#f5d04c",
    bolt: "#f8ee64",
    hazard: "#ff5d73",
    curb: "#edf8e4",
  },
  {
    name: "State Park",
    tagline: "premium forest paths and streams",
    area: "statePark",
    skyTop: "#2d6f8f",
    skyBottom: "#d7e78a",
    road: "#30493e",
    roadEdge: "#7cf2ff",
    accent: "#ffca5f",
    bolt: "#fff275",
    hazard: "#f25f5c",
    curb: "#f3fff5",
  },
  {
    name: "E-Bike Land",
    tagline: "premium pump tracks and glow paths",
    area: "bikeLand",
    skyTop: "#372064",
    skyBottom: "#35c6b7",
    road: "#252b55",
    roadEdge: "#ff7adf",
    accent: "#7cf2ff",
    bolt: "#fbe764",
    hazard: "#ff5d73",
    curb: "#f7fbff",
  },
];

const SKINS: Skin[] = [
  { id: "signal", name: "Signal Yellow", frame: "#fbe764", battery: "#7cf2ff", trail: "#fbe764", unlock: "base", label: "starter" },
  { id: "mint", name: "Courier Mint", frame: "#7cf2ff", battery: "#a2ff9a", trail: "#a2ff9a", unlock: "streak", label: "3 day streak" },
  { id: "sunset", name: "Sunset Dash", frame: "#ff6d4a", battery: "#ffe45e", trail: "#ffb703", unlock: "score", label: "5k score" },
  { id: "spark", name: "Base Spark", frame: "#0052ff", battery: "#fbe764", trail: "#7cf2ff", unlock: "supporter", label: "ETH support" },
  { id: "carbon", name: "Carbon Pro", frame: "#f7fbff", battery: "#c4b5fd", trail: "#c4b5fd", unlock: "pro", label: "Cycle Pass" },
  { id: "forest", name: "Forest Cruiser", frame: "#9ff28a", battery: "#fbe764", trail: "#9ff28a", unlock: "pro", label: "State Park" },
  { id: "neon", name: "Glow Track", frame: "#ff7adf", battery: "#7cf2ff", trail: "#ff7adf", unlock: "pro", label: "E-Bike Land" },
];

const DAILY_MISSIONS: DailyMission[] = [
  { kind: "combo", title: "Flow Thread", goal: "Reach a 10x combo", target: 10, reward: 700 },
  { kind: "clean", title: "Clean Line", goal: "Finish with 1 hit or less", target: 1, reward: 750 },
  { kind: "boosts", title: "Ramp Chain", goal: "Hit 6 boost gates", target: 6, reward: 650 },
  { kind: "battery", title: "Range Saver", goal: "Finish above 62% battery", target: 62, reward: 725 },
  { kind: "bolts", title: "Charge Hunt", goal: "Collect 16 bolts", target: 16, reward: 625 },
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

    if (roll < 0.3) {
      entities.push({ id: id++, kind: "bolt", lane, at });
      if (random() > 0.62) entities.push({ id: id++, kind: "bolt", lane, at: at + 72 });
    } else if (roll < 0.47) {
      entities.push({ id: id++, kind: "cone", lane, at });
    } else if (roll < 0.62) {
      entities.push({ id: id++, kind: "pothole", lane, at });
    } else if (roll < 0.78) {
      entities.push({ id: id++, kind: "barrier", lane, at });
    } else if (roll < 0.91) {
      entities.push({ id: id++, kind: "ramp", lane, at });
    } else {
      entities.push({ id: id++, kind: "gate", lane, at });
    }
  }

  return entities;
}

function dailyMission(seed: number) {
  return DAILY_MISSIONS[Math.floor((seed / ROUTES.length) % DAILY_MISSIONS.length)];
}

function routeForArea(area: RideArea) {
  return ROUTES.find((route) => route.area === area) ?? ROUTES[0];
}

function makeGame(area: RideArea = "park") {
  const dateKey = localDateKey();
  const seed = dateSeed(dateKey);
  return {
    phase: "ready" as RidePhase,
    dateKey,
    route: routeForArea(area),
    mission: dailyMission(seed),
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
    feedback: "",
    feedbackT: 0,
    feedbackColor: "#fbe764",
    shake: 0,
    missionNotified: false,
    batteryNotified: false,
    checkpointNotified: false,
    comboVoiceNotified: false,
    nearMissVoiceNotified: false,
    hitVoiceNotified: false,
    finalStretchNotified: false,
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
    targetLane: game.targetLane,
  };
}

function finalScore(game: GameModel) {
  const cleanBonus = game.hits === 0 ? 1250 : Math.max(0, 520 - game.hits * 95);
  const missionBonus = missionStatus(game).done ? game.mission.reward : 0;
  return Math.round(
    game.distance * 0.88 +
      game.pickups * 230 +
      game.boosts * 320 +
      game.nearMisses * 140 +
      game.bestCombo * 95 +
      game.battery * 18 +
      cleanBonus +
      missionBonus,
  );
}

function rideSignal(game: GameModel, feedback: string, color: string, shake = 0) {
  game.feedback = feedback;
  game.feedbackColor = color;
  game.feedbackT = 0.82;
  game.shake = Math.max(game.shake, shake);
}

function missionStatus(game: GameModel) {
  const { mission } = game;

  if (mission.kind === "combo") {
    const current = Math.min(game.bestCombo, mission.target);
    return {
      done: game.bestCombo >= mission.target,
      progress: clamp(current / mission.target, 0, 1),
      label: `${current}/${mission.target} combo`,
    };
  }

  if (mission.kind === "clean") {
    const done = game.phase === "finished" && game.hits <= mission.target;
    return {
      done,
      progress: game.hits <= mission.target ? 0.72 : 0.22,
      label: `${game.hits}/${mission.target} hits`,
    };
  }

  if (mission.kind === "boosts") {
    const current = Math.min(game.boosts, mission.target);
    return {
      done: game.boosts >= mission.target,
      progress: clamp(current / mission.target, 0, 1),
      label: `${current}/${mission.target} boosts`,
    };
  }

  if (mission.kind === "battery") {
    const battery = Math.round(game.battery);
    return {
      done: game.phase === "finished" && battery >= mission.target,
      progress: clamp(battery / mission.target, 0, 1),
      label: `${battery}%/${mission.target}%`,
    };
  }

  const current = Math.min(game.pickups, mission.target);
  return {
    done: game.pickups >= mission.target,
    progress: clamp(current / mission.target, 0, 1),
    label: `${current}/${mission.target} bolts`,
  };
}

function skinShortName(name: string) {
  return name
    .replace(" Yellow", "")
    .replace(" Dash", "")
    .replace(" Spark", "")
    .replace(" Pro", "");
}

let farcasterHapticsEnabled = false;

function haptic(kind: HapticKind) {
  if (!farcasterHapticsEnabled) return;
  try {
    if (kind === "selection") sdk.haptics.selectionChanged();
    else if (kind === "success") sdk.haptics.notificationOccurred("success");
    else if (kind === "warning") sdk.haptics.notificationOccurred("warning");
    else if (kind === "error") sdk.haptics.notificationOccurred("error");
    else sdk.haptics.impactOccurred(kind);
  } catch {}
}

export default function CasterCycleApp() {
  const { user, safeAreaInsets, isStandalone, miniAppAdded, hapticsEnabled, setMiniAppAdded } = useFarcasterUser();
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connecting } = useConnect();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameModel>(makeGame());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const lastHudRef = useRef(0);
  const coursePointerRef = useRef<{ x: number; y: number } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const motorAudioRef = useRef<MotorAudio | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const [hud, setHud] = useState<Hud>(() => emptyHud(gameRef.current));
  const [stats, setStats] = useState<PersistedStats>({ bestToday: 0, bestAll: 0, streak: 0, lastRideDate: null });
  const [selectedSkin, setSelectedSkin] = useState("signal");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>("daily");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("ride");
  const [rideArea, setRideArea] = useState<RideArea>("park");
  const [ethSupporter, setEthSupporter] = useState(false);
  const [weeklyUntil, setWeeklyUntil] = useState(0);
  const [annualUntil, setAnnualUntil] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const game = gameRef.current;
  const skin = SKINS.find((item) => item.id === selectedSkin) ?? SKINS[0];
  const displayName = user?.username ? `@${user.username}` : isStandalone ? "browser rider" : "farcaster rider";
  const progress = clamp(hud.distance / COURSE_LENGTH, 0, 1);
  const mission = missionStatus(game);
  const weeklyActive = weeklyUntil > Math.floor(Date.now() / 1000);
  const annualActive = annualUntil > Math.floor(Date.now() / 1000);
  const effectivePro = weeklyActive || annualActive;
  const passUntil = Math.max(weeklyUntil, annualUntil);

  const skinUnlocked = useCallback((item: Skin) => {
    if (item.unlock === "base") return true;
    if (item.unlock === "pro") return effectivePro;
    if (item.unlock === "supporter") return ethSupporter;
    if (item.unlock === "streak") return stats.streak >= 3;
    if (item.unlock === "score") return Math.max(stats.bestAll, hud.score) >= 5000;
    return false;
  }, [effectivePro, ethSupporter, hud.score, stats.bestAll, stats.streak]);

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
      const savedWeeklyUntil = Number(localStorage.getItem(`${STORAGE_PREFIX}:weeklyUntil`) || "0");
      const savedAnnualUntil = Number(localStorage.getItem(`${STORAGE_PREFIX}:annualUntil`) || "0");
      const savedPassActive = Math.max(savedWeeklyUntil, savedAnnualUntil) > Math.floor(Date.now() / 1000);
      setWeeklyUntil(savedWeeklyUntil);
      setAnnualUntil(savedAnnualUntil);
      setAudioEnabled(localStorage.getItem(`${STORAGE_PREFIX}:audio`) === "1");
      setVoiceEnabled(localStorage.getItem(`${STORAGE_PREFIX}:voice`) === "1");
      const savedArea = localStorage.getItem(`${STORAGE_PREFIX}:rideArea`);
      if (savedArea === "park" || ((savedArea === "statePark" || savedArea === "bikeLand") && savedPassActive)) {
        setRideArea(savedArea);
        gameRef.current = makeGame(savedArea);
      }
      const introSeen = localStorage.getItem(`${STORAGE_PREFIX}:introSeen`) === "1";
      setShowIntro(!introSeen);
      setShowWelcomeBack(introSeen);
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

  const primeAudio = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContextCtor();
    if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume().catch(() => {});
    return audioCtxRef.current;
  }, []);

  const stopMotor = useCallback(() => {
    const motor = motorAudioRef.current;
    if (!motor) return;
    motorAudioRef.current = null;
    const now = motor.gain.context.currentTime;
    try {
      motor.gain.gain.cancelScheduledValues(now);
      motor.gain.gain.setTargetAtTime(0.0001, now, 0.06);
      motor.osc.stop(now + 0.18);
      motor.sub.stop(now + 0.18);
      motor.lfo.stop(now + 0.18);
    } catch {}
  }, []);

  const startMotor = useCallback((force = false) => {
    if ((!audioEnabled && !force) || motorAudioRef.current) return;
    void primeAudio().then((ctx) => {
      if (!ctx || motorAudioRef.current) return;
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const now = ctx.currentTime;

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(240, now);
      filter.Q.setValueAtTime(0.72, now);
      osc.type = "sawtooth";
      sub.type = "triangle";
      osc.frequency.setValueAtTime(58, now);
      sub.frequency.setValueAtTime(29, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.014, now + 0.24);
      lfo.frequency.setValueAtTime(5.5, now);
      lfoGain.gain.setValueAtTime(0.0025, now);

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      gain.connect(ctx.destination);
      osc.start(now);
      sub.start(now);
      lfo.start(now);
      motorAudioRef.current = { osc, sub, gain, filter, lfo, lfoGain };
    });
  }, [audioEnabled, primeAudio]);

  const updateMotor = useCallback((current: GameModel) => {
    if (!audioEnabled || current.phase !== "riding") {
      stopMotor();
      return;
    }
    const motor = motorAudioRef.current;
    if (!motor) {
      startMotor();
      return;
    }
    const now = motor.gain.context.currentTime;
    const flow = Math.min(1, current.combo / 14);
    const boost = current.boost;
    const speedPulse = 44 + current.speed * 0.062 + boost * 32;
    const volume = 0.011 + boost * 0.012 + flow * 0.004;
    motor.osc.frequency.setTargetAtTime(speedPulse, now, 0.05);
    motor.sub.frequency.setTargetAtTime(speedPulse * 0.5, now, 0.05);
    motor.filter.frequency.setTargetAtTime(220 + boost * 520 + flow * 160, now, 0.08);
    motor.lfo.frequency.setTargetAtTime(4.8 + boost * 4.5, now, 0.08);
    motor.gain.gain.setTargetAtTime(volume, now, 0.08);
  }, [audioEnabled, startMotor, stopMotor]);

  const playSfx = useCallback((id: SfxId, force = false) => {
    if (!audioEnabled && !force) return;
    void primeAudio().then((ctx) => {
      if (!ctx) return;
      const profiles: Record<SfxId, { freq: number[]; dur: number; type: OscillatorType; gain: number }> = {
        start: { freq: [196, 392, 587], dur: 0.28, type: "triangle", gain: 0.055 },
        lane: { freq: [310, 390], dur: 0.09, type: "sine", gain: 0.035 },
        bolt: { freq: [640, 880], dur: 0.12, type: "triangle", gain: 0.045 },
        boost: { freq: [220, 440, 740], dur: 0.22, type: "sawtooth", gain: 0.04 },
        hit: { freq: [120, 74], dur: 0.18, type: "square", gain: 0.035 },
        clear: { freq: [523, 659, 784], dur: 0.34, type: "triangle", gain: 0.05 },
        finish: { freq: [392, 523, 659, 880], dur: 0.42, type: "triangle", gain: 0.052 },
        warning: { freq: [164, 110, 164], dur: 0.28, type: "square", gain: 0.026 },
        near: { freq: [880, 660, 990], dur: 0.16, type: "sine", gain: 0.026 },
        combo: { freq: [392, 587, 784, 1175], dur: 0.36, type: "triangle", gain: 0.042 },
      };
      const profile = profiles[id];
      const master = ctx.createGain();
      master.gain.setValueAtTime(profile.gain, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + profile.dur);
      master.connect(ctx.destination);

      profile.freq.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        osc.type = profile.type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.035);
        osc.connect(master);
        osc.start(ctx.currentTime + index * 0.035);
        osc.stop(ctx.currentTime + profile.dur);
      });

      if (id === "hit" || id === "near" || id === "boost") {
        const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * profile.dur), ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
          const fade = 1 - i / data.length;
          data[i] = (Math.random() * 2 - 1) * fade;
        }
        const source = ctx.createBufferSource();
        const noiseGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = id === "hit" ? "lowpass" : "highpass";
        filter.frequency.setValueAtTime(id === "hit" ? 420 : 1500, ctx.currentTime);
        noiseGain.gain.setValueAtTime(id === "hit" ? 0.032 : 0.018, ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + profile.dur);
        source.buffer = noiseBuffer;
        source.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        source.start();
      }
    });
  }, [audioEnabled, primeAudio]);

  const playVoice = useCallback((line: VoiceLineId, params: Record<string, string | number> = {}, force = false) => {
    if (!voiceEnabled && !force) return;
    const url = new URL("/api/ride-voice", window.location.origin);
    url.searchParams.set("line", line);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    voiceRef.current?.pause();
    const audio = new Audio(url.toString());
    audio.volume = 0.86;
    voiceRef.current = audio;
    void audio.play().catch(() => {});
  }, [voiceEnabled]);

  const toggleAudio = useCallback(() => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:audio`, next ? "1" : "0");
    } catch {}
    setToast(next ? "Sound on" : "Sound off");
    haptic("selection");
    if (next) {
      void primeAudio().then(() => {
        playSfx("start", true);
        if (gameRef.current.phase === "riding") startMotor(true);
      });
    } else {
      stopMotor();
    }
  }, [audioEnabled, playSfx, primeAudio, startMotor, stopMotor]);

  const toggleVoice = useCallback(() => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:voice`, next ? "1" : "0");
    } catch {}
    if (next) {
      setToast("Voice on");
      const current = gameRef.current;
      window.setTimeout(() => playVoice("ready", { route: current.route.name }), 80);
    } else {
      voiceRef.current?.pause();
    }
  }, [playVoice, voiceEnabled]);

  const loadLeaderboard = useCallback(async (scope: LeaderboardScope = leaderboardScope, period: LeaderboardPeriod = leaderboardPeriod) => {
    const current = gameRef.current;
    try {
      const url = `/api/scores?dateKey=${encodeURIComponent(current.dateKey)}&scope=${scope}&period=${period}&fid=${user?.fid ?? 0}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.rows)) setLeaderboard(data.rows);
    } catch {}
  }, [leaderboardPeriod, leaderboardScope, user?.fid]);

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
      loadLeaderboard(leaderboardScope, leaderboardPeriod);
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
      loadLeaderboard(leaderboardScope, leaderboardPeriod);
    }
  }, [address, leaderboardPeriod, leaderboardScope, loadLeaderboard, selectedSkin, user]);

  const finishRide = useCallback((reason: "course" | "battery" = "course") => {
    const current = gameRef.current;
    if (current.phase !== "riding") return;
    current.phase = "finished";
    current.score = finalScore(current) - (reason === "battery" ? 300 : 0);
    setDashboardTab("ride");
    publishStats(current);
    syncHud();
    submitScore(current);
    haptic(reason === "battery" ? "error" : "success");
    stopMotor();
    playSfx(reason === "battery" ? "hit" : "finish");
    playVoice("finish", { route: current.route.name });
  }, [playSfx, playVoice, publishStats, stopMotor, submitScore, syncHud]);

  const resetRide = useCallback(() => {
    gameRef.current = makeGame(rideArea);
    loadStats(gameRef.current.dateKey);
    syncHud();
    haptic("selection");
  }, [loadStats, rideArea, syncHud]);

  const startRide = useCallback(() => {
    if (gameRef.current.phase === "finished") {
      resetRide();
      requestAnimationFrame(() => startRide());
      return;
    }
    if (gameRef.current.phase === "ready") {
      void primeAudio();
      gameRef.current.phase = "riding";
      gameRef.current.score = 0;
      syncHud();
      haptic("medium");
      playSfx("start");
      startMotor();
      playVoice("start", { route: gameRef.current.route.name });
    }
  }, [playSfx, playVoice, primeAudio, resetRide, startMotor, syncHud]);

  const closeIntro = useCallback((ride = false) => {
    setShowIntro(false);
    setShowWelcomeBack(!miniAppAdded);
    setIntroStep(0);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:introSeen`, "1");
    } catch {}
    if (ride) requestAnimationFrame(() => startRide());
  }, [miniAppAdded, startRide]);

  const addMiniApp = useCallback(async () => {
    try {
      await sdk.actions.addMiniApp();
      setMiniAppAdded(true);
      setShowWelcomeBack(false);
      setToast("CasterCycle saved");
      haptic("success");
    } catch {
      setToast("Add from Farcaster");
    }
  }, [setMiniAppAdded]);

  const changeLane = useCallback((direction: -1 | 1) => {
    const current = gameRef.current;
    if (current.phase === "ready") {
      startRide();
      return;
    }
    if (current.phase !== "riding") return;
    current.targetLane = clamp(current.targetLane + direction, -1, 1) as Lane;
    syncHud();
    haptic("light");
    playSfx("lane");
  }, [playSfx, startRide, syncHud]);

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
      syncHud();
      haptic("medium");
      playSfx("boost");
    }
  }, [playSfx, startRide, syncHud]);

  const handleCoursePointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    coursePointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleCoursePointerUp = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const start = coursePointerRef.current;
    coursePointerRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const dx = start ? event.clientX - start.x : 0;
    const dy = start ? event.clientY - start.y : 0;

    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      changeLane(dx > 0 ? 1 : -1);
      return;
    }

    if (x < rect.width * 0.34) changeLane(-1);
    else if (x > rect.width * 0.66) changeLane(1);
    else boostOrHop();
  }, [boostOrHop, changeLane]);

  const shareCast = useCallback(async (text: string, embeds: [] | [string] | [string, string], copiedText = "Share copied") => {
    const finalText = text.trimEnd().endsWith(SHARE_URL) ? text.trimEnd() : `${text.trimEnd()}\n${SHARE_URL}`;
    try {
      await sdk.actions.composeCast({ text: finalText, embeds });
      setToast("Cast composer opened");
      haptic("success");
      return;
    } catch {}

    try {
      if (navigator.share) {
        await navigator.share({ title: "CasterCycle", text: finalText, url: SHARE_URL });
        setToast("Share sheet opened");
        return;
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(finalText);
      setToast(copiedText);
    } catch {
      try {
        await sdk.actions.openUrl(SHARE_URL);
        setToast("Opening CasterCycle");
      } catch {
        setToast("Share failed");
      }
    }
  }, []);

  const shareApp = useCallback(async () => {
    const current = gameRef.current;
    const castText = `I'm riding ${current.route.name} in CasterCycle.\n\nFree park rides, daily scores, friend leaderboards, and Base unlocks:\n${SHARE_URL}`;
    setSharing(true);
    try {
      await shareCast(castText, [`${APP_URL}/media/castercycle-card.png`, SHARE_URL], "Invite copied");
    } finally {
      setSharing(false);
    }
  }, [shareCast]);

  const shareRide = useCallback(async () => {
    const current = gameRef.current;
    const mission = missionStatus(current);
    const missionText = mission.done ? `\nDaily mission cleared: ${current.mission.title}.` : "";
    const shareImageUrl = `${APP_URL}/api/share-image?score=${current.score}&route=${encodeURIComponent(current.route.name)}&user=${encodeURIComponent(displayName)}&skin=${encodeURIComponent(skin.name)}&date=${current.dateKey}&mission=${encodeURIComponent(mission.done ? `${current.mission.title} cleared` : current.mission.goal)}`;
    const castText = `I scored ${current.score.toLocaleString()} in CasterCycle's ${current.route.name}.${missionText}\n\n${current.pickups} charge bolts, ${current.boosts} boosts, ${Math.round(current.battery)}% battery left. Beat my park ride:\n${SHARE_URL}`;
    setSharing(true);
    try {
      await shareCast(castText, [shareImageUrl, SHARE_URL], "Ride copied");
    } finally {
      setSharing(false);
    }
  }, [displayName, shareCast, skin.name]);

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

  const unlockPass = useCallback((plan: "weekly" | "lifetime") => {
    const key = plan === "weekly" ? "weeklyUntil" : "annualUntil";
    const seconds = plan === "weekly" ? WEEK_SECONDS : LIFETIME_SECONDS;
    const until = Math.floor(Date.now() / 1000) + seconds;
    if (plan === "weekly") setWeeklyUntil(until);
    else setAnnualUntil(until);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:${key}`, String(until));
      localStorage.setItem(`${STORAGE_PREFIX}:skin`, "carbon");
      localStorage.setItem(`${STORAGE_PREFIX}:rideArea`, plan === "weekly" ? "statePark" : "bikeLand");
    } catch {}
    setSelectedSkin("carbon");
    const unlockedArea = plan === "weekly" ? "statePark" : "bikeLand";
    setRideArea(unlockedArea);
    gameRef.current = makeGame(unlockedArea);
    syncHud();
    setToast(plan === "weekly" ? "State Park weekly active" : "State Park lifetime active");
    haptic("success");
  }, [syncHud]);

  const chooseRideArea = useCallback((area: RideArea) => {
    if (area === "statePark" && !effectivePro) {
      setDashboardTab("shop");
      setToast("Unlock State Park");
      haptic("warning");
      return;
    }
    if (area === "bikeLand" && !annualActive) {
      setDashboardTab("shop");
      setToast("Unlock Lifetime Pass");
      haptic("warning");
      return;
    }
    setRideArea(area);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:rideArea`, area);
    } catch {}
    if (gameRef.current.phase !== "riding") {
      gameRef.current = makeGame(area);
      syncHud();
    }
    haptic("selection");
  }, [annualActive, effectivePro, syncHud]);

  useEffect(() => {
    loadStats(gameRef.current.dateKey);
    loadLeaderboard("global", "daily");
  }, [loadLeaderboard, loadStats]);

  useEffect(() => {
    farcasterHapticsEnabled = hapticsEnabled;
  }, [hapticsEnabled]);

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
    if (miniAppAdded) setShowWelcomeBack(false);
  }, [miniAppAdded]);

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
      if (current.feedbackT > 0) current.feedbackT = Math.max(0, current.feedbackT - dt);
      if (current.shake > 0) current.shake = Math.max(0, current.shake - dt * 3.4);

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
        updateMotor(current);

        if (!current.batteryNotified && current.battery <= 25) {
          current.batteryNotified = true;
          rideSignal(current, "LOW CHARGE", current.route.hazard, 0.18);
          haptic("warning");
          playSfx("warning");
          playVoice("lowBattery");
        }

        if (!current.checkpointNotified && current.distance >= COURSE_LENGTH * 0.5) {
          current.checkpointNotified = true;
          current.score += 420 + current.combo * 22;
          rideSignal(current, "HALFWAY FLOW", current.route.bolt, 0.08);
          haptic("success");
          playSfx("clear");
          playVoice("checkpoint");
        }

        if (!current.finalStretchNotified && current.distance >= COURSE_LENGTH * 0.84) {
          current.finalStretchNotified = true;
          current.score += 520 + current.combo * 24;
          current.boost = Math.max(current.boost, 0.5);
          rideSignal(current, "FINAL STRETCH", current.route.roadEdge, 0.1);
          haptic("heavy");
          playSfx("combo");
          playVoice("finalStretch");
        }

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
            current.score += 190 + current.combo * 20;
            if (current.combo % 5 === 0) {
              current.boost = Math.max(current.boost, 0.55);
              current.score += 160;
              rideSignal(current, `${current.combo}X FLOW`, current.route.roadEdge, 0.08);
            } else {
              rideSignal(current, "+CHARGE", current.route.bolt);
            }
            haptic("light");
            playSfx("bolt");
          } else if (entity.kind === "ramp" && !entity.hit && laneMatch && rel < 36) {
            entity.hit = true;
            current.boosts += 1;
            current.combo += 1;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.airborne = 1;
            current.boost = 1;
            current.score += 360 + current.combo * 18;
            rideSignal(current, "BOOST RAMP", "#a2ff9a", 0.12);
            haptic("medium");
            playSfx("boost");
            if (current.boosts === 3) playVoice("boost", { route: current.route.name });
          } else if (entity.kind === "gate" && !entity.hit && laneMatch && rel < 38) {
            entity.hit = true;
            current.boosts += 1;
            current.combo += 2;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.boost = Math.max(current.boost, 0.88);
            current.battery = clamp(current.battery + 3.5, 0, 100);
            current.score += 450 + current.combo * 28;
            rideSignal(current, "SIGNAL GATE", current.route.roadEdge, 0.1);
            haptic("medium");
            playSfx("boost");
            if (current.boosts === 3) playVoice("boost", { route: current.route.name });
          } else if (entity.kind !== "bolt" && entity.kind !== "ramp" && entity.kind !== "gate" && !entity.hit && rel < 22) {
            entity.hit = true;
            if (laneMatch && current.airborne <= 0.35) {
              current.hits += 1;
              current.combo = 0;
              current.battery = clamp(current.battery - (entity.kind === "pothole" ? 13 : 11), 0, 100);
              current.boost = 0;
              rideSignal(current, "BATTERY HIT", current.route.hazard, 0.9);
              haptic("error");
              playSfx("hit");
              if (!current.hitVoiceNotified) {
                current.hitVoiceNotified = true;
                playVoice("hit");
              }
            } else if (laneMatch && current.airborne > 0.35) {
              current.nearMisses += 1;
              current.combo += 1;
              current.bestCombo = Math.max(current.bestCombo, current.combo);
              current.score += 170 + current.combo * 14;
              rideSignal(current, "AIR CLEAR", current.route.roadEdge, 0.08);
              haptic("light");
              playSfx("near");
            } else if (!laneMatch && Math.abs(entity.lane - current.laneOffset) < 1.18) {
              current.nearMisses += 1;
              current.combo += 1;
              current.bestCombo = Math.max(current.bestCombo, current.combo);
              current.score += 120;
              rideSignal(current, "CLOSE CALL", "#ffffff", 0.05);
              haptic("light");
              playSfx("near");
            }
          }
        }

        if (!current.comboVoiceNotified && current.combo >= 10) {
          current.comboVoiceNotified = true;
          current.boost = Math.max(current.boost, 0.68);
          rideSignal(current, "10X FLOW", current.route.bolt, 0.1);
          haptic("success");
          playSfx("combo");
          playVoice("combo");
        }

        if (!current.nearMissVoiceNotified && current.nearMisses >= 3) {
          current.nearMissVoiceNotified = true;
          current.score += 260;
          rideSignal(current, "THREAD BONUS", "#ffffff", 0.08);
          haptic("medium");
          playSfx("combo");
          playVoice("nearMiss");
        }

        const status = missionStatus(current);
        if (!current.missionNotified && status.done) {
          current.missionNotified = true;
          rideSignal(current, "MISSION CLEAR", current.route.bolt, 0.18);
          haptic("success");
          playSfx("clear");
          playVoice("mission", { mission: current.mission.title });
        }

        current.score = Math.max(
          current.score,
          Math.round(current.distance * 0.8 + current.pickups * 190 + current.boosts * 250 + current.nearMisses * 110 - current.hits * 85),
        );

        if (current.distance >= COURSE_LENGTH) finishRide("course");
        if (current.battery <= 0) finishRide("battery");
      }

      if (current.phase !== "riding") updateMotor(current);
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
  }, [finishRide, playSfx, playVoice, skin, syncHud, updateMotor]);

  const resultLabel = useMemo(() => {
    if (hud.phase !== "finished") return "daily ride";
    if (mission.done) return "mission cleared";
    if (hud.hits === 0) return "clean commute";
    if (hud.nearMisses >= 4) return "threaded traffic";
    if (hud.boosts >= 3) return "boost specialist";
    return hud.battery <= 0 ? "battery tapped" : "ride complete";
  }, [hud.battery, hud.boosts, hud.hits, hud.nearMisses, hud.phase, mission.done]);

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
        onPointerDown={handleCoursePointerDown}
        onPointerCancel={() => {
          coursePointerRef.current = null;
        }}
        onPointerUp={handleCoursePointerUp}
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
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <Trophy size={13} />
              {hud.score.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
              <BatteryCharging size={13} />
              {Math.round(hud.battery)}%
            </span>
            <button
              aria-label={audioEnabled ? "Turn sound effects off" : "Turn sound effects on"}
              className={`pointer-events-auto relative inline-flex h-7 w-7 items-center justify-center rounded border ${audioEnabled ? "border-[#fbe764]/60 bg-[#fbe764]/18 text-[#fbe764]" : "border-white/12 bg-white/8 text-white/55"}`}
              onClick={toggleAudio}
            >
              {audioEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${audioEnabled ? "bg-[#fbe764] shadow-[0_0_10px_rgba(251,231,100,0.95)]" : "bg-white/22"}`} />
            </button>
            <button
              aria-label={voiceEnabled ? "Turn route voice off" : "Turn route voice on"}
              className={`pointer-events-auto relative inline-flex h-7 w-7 items-center justify-center rounded border ${voiceEnabled ? "border-[#7cf2ff]/60 bg-[#7cf2ff]/18 text-[#7cf2ff]" : "border-white/12 bg-white/8 text-white/55"}`}
              onClick={toggleVoice}
            >
              <Radio size={14} />
              <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${voiceEnabled ? "bg-[#7cf2ff] shadow-[0_0_10px_rgba(124,242,255,0.95)]" : "bg-white/22"}`} />
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
          <div className="h-full rounded-full bg-[#fbe764]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>

      {hud.phase === "riding" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
          <div className="grid grid-cols-4 gap-2">
            <Metric icon={<Gauge size={14} />} label="mph" value={String(Math.round(hud.speed / 8))} />
            <Metric icon={<Zap size={14} />} label="bolts" value={String(hud.pickups)} />
            <Metric icon={<Flame size={14} />} label="combo" value={`${hud.combo}x`} />
            <Metric icon={<Bike size={14} />} label="lane" value={hud.targetLane === -1 ? "left" : hud.targetLane === 1 ? "right" : "mid"} />
          </div>
          <div className="pointer-events-auto mt-2 grid grid-cols-3 gap-2">
            <button
              aria-label="Move left"
              aria-pressed={hud.targetLane === -1}
              className={`inline-flex min-h-11 select-none items-center justify-center gap-1 rounded-md border text-xs font-black uppercase tracking-[0.08em] backdrop-blur-md touch-manipulation active:scale-[0.98] ${
                hud.targetLane === -1 ? "border-[#7cf2ff]/65 bg-[#7cf2ff]/18 text-[#7cf2ff]" : "border-white/18 bg-black/32 text-white/80"
              }`}
              onClick={() => changeLane(-1)}
            >
              <ChevronLeft size={18} />
              Left
            </button>
            <button
              aria-label="Hop"
              className="inline-flex min-h-11 select-none items-center justify-center gap-1 rounded-md border border-[#fbe764]/50 bg-[#fbe764]/18 text-xs font-black uppercase tracking-[0.08em] text-[#fbe764] backdrop-blur-md touch-manipulation active:scale-[0.98]"
              onClick={boostOrHop}
            >
              <Zap size={16} />
              Hop
            </button>
            <button
              aria-label="Move right"
              aria-pressed={hud.targetLane === 1}
              className={`inline-flex min-h-11 select-none items-center justify-center gap-1 rounded-md border text-xs font-black uppercase tracking-[0.08em] backdrop-blur-md touch-manipulation active:scale-[0.98] ${
                hud.targetLane === 1 ? "border-[#7cf2ff]/65 bg-[#7cf2ff]/18 text-[#7cf2ff]" : "border-white/18 bg-black/32 text-white/80"
              }`}
              onClick={() => changeLane(1)}
            >
              Right
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {hud.phase !== "riding" && (
        <section className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 px-3 pb-3">
          <div className="no-scrollbar max-h-[88dvh] overflow-y-auto overscroll-contain rounded-md border border-white/15 bg-[#111923]/92 p-4 shadow-2xl backdrop-blur-xl">
            {hud.phase === "ready" && showIntro ? (
              <OnboardingPanel
                step={introStep}
                routeName={game.route.name}
                miniAppAdded={miniAppAdded}
                onStep={setIntroStep}
                onAdd={addMiniApp}
                onSkip={() => closeIntro(false)}
                onStart={() => closeIntro(true)}
              />
            ) : hud.phase === "ready" && showWelcomeBack && !miniAppAdded ? (
              <WelcomeBackPanel
                displayName={displayName}
                routeName={game.route.name}
                onAdd={addMiniApp}
                onDismiss={() => setShowWelcomeBack(false)}
                onShare={shareApp}
                onStart={startRide}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7cf2ff]">{resultLabel}</div>
                    <h1 className="mt-1 text-3xl font-black leading-none tracking-normal text-white">CasterCycle</h1>
                    <p className="mt-2 max-w-[20rem] text-sm font-medium leading-5 text-white/68">
                      {hud.phase === "finished"
                        ? `${displayName} scored ${hud.score.toLocaleString()} on ${game.route.name}.`
                        : `${game.route.name}. Daily route, clean line, best score.`}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Image
                      src="/media/castercycle.png"
                      alt=""
                      width={58}
                      height={58}
                      className="h-[58px] w-[58px] rounded-md border border-white/15 object-cover shadow-lg"
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-5 gap-1 rounded-md border border-white/10 bg-black/18 p-1">
                  {([
                    { id: "ride", label: "Worlds", icon: <Map size={15} /> },
                    { id: "shop", label: "Shop", icon: <Wallet size={15} /> },
                    { id: "garage", label: "Bike", icon: <Bike size={15} /> },
                    { id: "club", label: "Club", icon: <Users size={15} /> },
                    { id: "leaders", label: "Rank", icon: <Trophy size={15} /> },
                  ] as { id: DashboardTab; label: string; icon: React.ReactNode }[]).map((item) => (
                    <button
                      key={item.id}
                      className={`inline-flex min-h-10 items-center justify-center gap-1 rounded text-[10px] font-black uppercase tracking-[0.06em] transition active:scale-[0.98] ${
                        dashboardTab === item.id ? "bg-[#fbe764] text-[#111923]" : "text-white/62 hover:bg-white/8"
                      }`}
                      onClick={() => {
                        haptic("selection");
                        setDashboardTab(item.id);
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>

                {dashboardTab === "ride" && (
                  <>
                    <WorldHub
                      selected={rideArea}
                      phase={hud.phase}
                      score={hud.score}
                      bestToday={Math.max(stats.bestToday, hud.score)}
                      bestAll={Math.max(stats.bestAll, hud.score)}
                      streak={stats.streak}
                      proActive={effectivePro}
                      lifetimeActive={annualActive}
                      sharing={sharing}
                      onSelect={chooseRideArea}
                      onStart={startRide}
                      onShare={hud.phase === "finished" ? shareRide : shareApp}
                    />

                    <MissionPanel mission={game.mission} status={mission} />

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <SignalChip icon={<Users size={13} />} label="rider" value={displayName} />
                      <SignalChip icon={<Radio size={13} />} label="daily" value={game.dateKey.slice(5)} />
                      <SignalChip icon={<Bike size={13} />} label="skin" value={skinShortName(skin.name)} />
                    </div>
                  </>
                )}

                {dashboardTab === "shop" && (
                  <>
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
                        {effectivePro ? formatPassExpiry(passUntil) : "Cycle Pass"}
                      </div>
                    </div>
                    <CreditsPanel
                      enabled={isConnected}
                      address={address}
                      userFid={user?.fid ?? 0}
                      dateKey={game.dateKey}
                      finished={hud.phase === "finished"}
                      onConnect={connectWallet}
                    />
                    <UpgradePanel
                      enabled={isConnected}
                      isPro={effectivePro}
                      weeklyActive={weeklyActive}
                      annualActive={annualActive}
                      onConnect={connectWallet}
                      onEthSupport={unlockEthSupporter}
                      onPassPurchased={unlockPass}
                      onVoiceInfo={() => playVoice("legal", {}, true)}
                    />
                  </>
                )}

                {dashboardTab === "garage" && (
                  <>
                    <AreaPicker selected={rideArea} proActive={effectivePro} lifetimeActive={annualActive} onSelect={chooseRideArea} />
                    <SkinPicker skins={SKINS} selected={selectedSkin} isUnlocked={skinUnlocked} onSelect={setSelectedSkin} />
                  </>
                )}

                {dashboardTab === "club" && (
                  <LoungePanel proActive={effectivePro} user={user ?? undefined} />
                )}

                {dashboardTab === "leaders" && (
                  <Leaderboard
                    rows={leaderboard}
                    scope={leaderboardScope}
                    period={leaderboardPeriod}
                    onProfile={(fid) => sdk.actions.viewProfile({ fid }).catch(() => setToast("Open in Farcaster"))}
                    onScope={(scope) => {
                      setLeaderboardScope(scope);
                      loadLeaderboard(scope, leaderboardPeriod);
                    }}
                    onPeriod={(period) => {
                      setLeaderboardPeriod(period);
                      loadLeaderboard(leaderboardScope, period);
                    }}
                  />
                )}
              </>
            )}
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

function OnboardingPanel({
  step,
  routeName,
  miniAppAdded,
  onStep,
  onAdd,
  onSkip,
  onStart,
}: {
  step: number;
  routeName: string;
  miniAppAdded: boolean;
  onStep: (step: number) => void;
  onAdd: () => void;
  onSkip: () => void;
  onStart: () => void;
}) {
  const slides = [
    {
      icon: <Bike size={22} />,
      kicker: "Welcome",
      title: "Pick a park.",
      body: `${routeName} is today's social ride. Start free, then unlock bigger worlds when you want them.`,
      accent: "#fbe764",
    },
    {
      icon: <Zap size={22} />,
      kicker: "Flow",
      title: "Chain clean lines.",
      body: "Tap lanes, hop hazards, collect charge, and keep battery for a stronger finish.",
      accent: "#7cf2ff",
    },
    {
      icon: <Share2 size={22} />,
      kicker: "Social",
      title: "Cast the score.",
      body: "Share the result, climb friends, save the app, and bring your Farcaster identity into the ride.",
      accent: "#a2ff9a",
    },
  ];
  const current = slides[step] ?? slides[0];
  const isLast = step === slides.length - 1;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7cf2ff]">First ride</div>
          <h1 className="mt-1 text-3xl font-black leading-none tracking-normal text-white">CasterCycle</h1>
        </div>
        <Image
          src="/media/castercycle.png"
          alt=""
          width={58}
          height={58}
          className="h-[58px] w-[58px] shrink-0 rounded-md border border-white/15 object-cover shadow-lg"
        />
      </div>

      <div className="mt-5 rounded-md border border-white/12 bg-white/7 p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border text-[#111923]"
            style={{ background: current.accent, borderColor: current.accent }}
          >
            {current.icon}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: current.accent }}>
              {current.kicker}
            </div>
            <div className="mt-1 text-xl font-black leading-tight text-white">{current.title}</div>
          </div>
        </div>
        <p className="mt-4 text-sm font-semibold leading-5 text-white/68">{current.body}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.kicker}
            aria-label={`Intro step ${index + 1}`}
            className="h-2 rounded-full transition"
            style={{ background: index === step ? slide.accent : "rgba(255,255,255,0.18)" }}
            onClick={() => {
              haptic("selection");
              onStep(index);
            }}
          />
        ))}
      </div>

      <div className={`mt-5 grid gap-2 ${isLast && !miniAppAdded ? "grid-cols-3" : "grid-cols-2"}`}>
        <button
          className="inline-flex min-h-12 items-center justify-center rounded-md border border-white/15 bg-white/8 px-4 text-sm font-black text-white transition active:scale-[0.98]"
          onClick={() => {
            haptic("selection");
            onSkip();
          }}
        >
          Skip
        </button>
        {isLast && !miniAppAdded && (
          <button
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#7cf2ff] px-3 text-xs font-black text-[#111923] transition active:scale-[0.98]"
            onClick={onAdd}
          >
            <Sparkles size={16} />
            Add
          </button>
        )}
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-4 text-sm font-black text-[#111923] transition active:scale-[0.98]"
          onClick={() => {
            haptic(isLast ? "medium" : "selection");
            if (isLast) onStart();
            else onStep(step + 1);
          }}
        >
          {isLast ? <Play size={18} /> : <ChevronRight size={18} />}
          {isLast ? "Start Ride" : "Next"}
        </button>
      </div>
    </div>
  );
}

function WelcomeBackPanel({
  displayName,
  routeName,
  onAdd,
  onDismiss,
  onShare,
  onStart,
}: {
  displayName: string;
  routeName: string;
  onAdd: () => void;
  onDismiss: () => void;
  onShare: () => void;
  onStart: () => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7cf2ff]">Welcome back</div>
          <h1 className="mt-1 text-3xl font-black leading-none tracking-normal text-white">CasterCycle</h1>
          <p className="mt-2 text-sm font-semibold leading-5 text-white/68">
            {displayName}, {routeName} is ready.
          </p>
        </div>
        <Image
          src="/media/castercycle.png"
          alt=""
          width={58}
          height={58}
          className="h-[58px] w-[58px] shrink-0 rounded-md border border-white/15 object-cover shadow-lg"
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <FeatureChip icon={<Zap size={13} />} label="daily" />
        <FeatureChip icon={<Trophy size={13} />} label="scores" />
        <FeatureChip icon={<Wallet size={13} />} label="base" />
      </div>

      <div className="mt-4 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/10 p-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#fbe764]">
          <Sparkles size={13} />
          Save CasterCycle
        </div>
        <p className="mt-1 text-xs font-semibold leading-5 text-white/64">
          Add it once for faster daily rides.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-1 rounded-md bg-[#fbe764] px-2 text-xs font-black text-[#111923] transition active:scale-[0.98]"
          onClick={onAdd}
        >
          <Sparkles size={17} />
          Add
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-1 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-2 text-xs font-black text-white transition active:scale-[0.98]"
          onClick={onShare}
        >
          <Share2 size={17} />
          Invite
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-1 rounded-md bg-[#7cf2ff] px-2 text-xs font-black text-[#111923] transition active:scale-[0.98]"
          onClick={() => {
            haptic("medium");
            onStart();
          }}
        >
          <Play size={17} />
          Ride
        </button>
      </div>
      <button
        className="mt-3 min-h-9 w-full rounded-md border border-white/12 bg-white/7 px-3 text-xs font-black uppercase tracking-[0.1em] text-white/58"
        onClick={() => {
          haptic("selection");
          onDismiss();
        }}
      >
        Not now
      </button>
    </div>
  );
}

function WorldHub({
  selected,
  phase,
  score,
  bestToday,
  bestAll,
  streak,
  proActive,
  lifetimeActive,
  sharing,
  onSelect,
  onStart,
  onShare,
}: {
  selected: RideArea;
  phase: RidePhase;
  score: number;
  bestToday: number;
  bestAll: number;
  streak: number;
  proActive: boolean;
  lifetimeActive: boolean;
  sharing: boolean;
  onSelect: (area: RideArea) => void;
  onStart: () => void;
  onShare: () => void;
}) {
  const worldMeta: Record<RideArea, { kicker: string; badge: string; access: string; feature: string; lockText: string }> = {
    park: {
      kicker: "Free roam",
      badge: "Open",
      access: "Community",
      feature: "Skatepark, courts, fields, streams, and open paths.",
      lockText: "Open",
    },
    statePark: {
      kicker: "Adventure",
      badge: "$0.99 week",
      access: proActive ? "Unlocked" : "Cycle Pass",
      feature: "Forest loops, stream bridges, hill descents, and longer lines.",
      lockText: "Unlock",
    },
    bikeLand: {
      kicker: "Premium",
      badge: "$7 lifetime",
      access: lifetimeActive ? "Lifetime" : "Lifetime Pass",
      feature: "Pump tracks, neon lanes, club drops, and future premium worlds.",
      lockText: "Unlock",
    },
  };

  const canRide = (area: RideArea) => area === "park" || (area === "statePark" && proActive) || (area === "bikeLand" && lifetimeActive);
  const selectedRoute = routeForArea(selected);

  return (
    <div className="mt-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7cf2ff]">Ride worlds</div>
          <div className="mt-1 truncate text-xl font-black leading-tight text-white">{selectedRoute.name}</div>
          <div className="mt-1 truncate text-xs font-semibold text-white/54">{selectedRoute.tagline}</div>
        </div>
        <div className="shrink-0 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/12 px-2 py-1 text-right">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#fbe764]">score</div>
          <div className="text-sm font-black text-white">{score.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ResultStat label="today" value={bestToday.toLocaleString()} />
        <ResultStat label="best" value={bestAll.toLocaleString()} />
        <ResultStat label="streak" value={String(streak)} />
      </div>

      <div className="mt-3 grid gap-2">
        {ROUTES.map((route) => {
          const meta = worldMeta[route.area];
          const active = selected === route.area;
          const unlocked = canRide(route.area);
          return (
            <button
              key={route.area}
              className={`grid min-h-[112px] grid-cols-[112px_1fr] gap-3 rounded-md border p-2 text-left transition active:scale-[0.99] ${
                active ? "border-[#fbe764]/72 bg-[#fbe764]/12" : "border-white/12 bg-white/7"
              }`}
              onClick={() => onSelect(route.area)}
            >
              <WorldPreview route={route} active={active} locked={!unlocked} />
              <span className="flex min-w-0 flex-col justify-between py-1">
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#7cf2ff]">{meta.kicker}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${unlocked ? "bg-[#a2ff9a] text-[#111923]" : "bg-white/10 text-white/58"}`}>
                      {unlocked ? meta.access : meta.badge}
                    </span>
                  </span>
                  <span className="mt-1 block text-base font-black leading-tight text-white">{route.name}</span>
                  <span className="mt-1 block text-xs font-semibold leading-4 text-white/56">{meta.feature}</span>
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/44">
                    {unlocked ? <CheckCircle2 size={12} /> : <Lock size={12} />}
                    {unlocked ? (active ? "Selected" : "Tap to select") : meta.lockText}
                  </span>
                  {active && <span className="h-2.5 w-2.5 rounded-full bg-[#fbe764]" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-4 text-sm font-black text-[#111923] transition active:scale-[0.98]"
          onClick={onStart}
        >
          {phase === "finished" ? <RotateCcw size={18} /> : <Play size={18} />}
          {phase === "finished" ? "Ride Again" : "Start World"}
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#7cf2ff] px-4 text-sm font-black text-[#111923] transition active:scale-[0.98] disabled:opacity-70"
          disabled={sharing}
          onClick={onShare}
        >
          <Share2 size={18} />
          {sharing ? "Opening" : phase === "finished" ? "Share" : "Invite"}
        </button>
      </div>
    </div>
  );
}

function WorldPreview({ route, active, locked }: { route: RouteTheme; active: boolean; locked: boolean }) {
  const park = route.area === "park";
  const statePark = route.area === "statePark";

  return (
    <span
      className="relative block h-full min-h-[96px] overflow-hidden rounded-md border"
      style={{
        borderColor: active ? route.accent : "rgba(255,255,255,0.14)",
        background: `linear-gradient(180deg, ${route.skyTop}, ${route.skyBottom})`,
      }}
    >
      <span className="absolute inset-x-0 bottom-0 h-[58%]" style={{ background: park ? "#4c8e48" : statePark ? "#2f6f50" : "#292a72" }} />
      <span className="absolute left-[45%] top-[10%] h-[108%] w-7 -translate-x-1/2 rotate-[-10deg] rounded-full" style={{ background: route.road }} />
      <span className="absolute left-[58%] top-[16%] h-[92%] w-5 -translate-x-1/2 rotate-[18deg] rounded-full opacity-70" style={{ background: route.roadEdge }} />
      <span className="absolute bottom-5 left-4 h-8 w-10 rounded bg-[#3d7d42]">
        <span className="absolute left-1 top-1 h-2 w-8 rounded bg-[#7cf2ff]/70" />
        <span className="absolute bottom-1 left-1 h-2 w-8 rounded bg-[#fbe764]/70" />
      </span>
      <span className="absolute bottom-8 right-4 h-5 w-9 rounded-full border-2" style={{ borderColor: route.accent }} />
      {park && (
        <>
          <span className="absolute bottom-4 right-7 h-7 w-7 rounded bg-[#cfd7d9] rotate-12" />
          <span className="absolute bottom-12 left-8 h-5 w-8 rounded border border-white/70" />
        </>
      )}
      {statePark && (
        <>
          <span className="absolute bottom-4 left-7 h-10 w-3 rounded-t-full bg-[#16452d]" />
          <span className="absolute bottom-8 left-4 h-10 w-3 rounded-t-full bg-[#1b5a38]" />
          <span className="absolute bottom-7 right-8 h-1.5 w-12 rotate-[-12deg] rounded bg-[#b88a4f]" />
        </>
      )}
      {route.area === "bikeLand" && (
        <>
          <span className="absolute bottom-5 left-6 h-3 w-12 rounded-full bg-[#ff7adf]/80" />
          <span className="absolute bottom-12 right-5 h-3 w-11 rounded-full bg-[#7cf2ff]/80" />
          <span className="absolute right-4 top-5 h-8 w-8 rounded-full border-2 border-[#fbe764]" />
        </>
      )}
      <span className="absolute bottom-8 left-[48%] h-5 w-8 -translate-x-1/2 -rotate-12 rounded-full border-2 border-[#111923] bg-[#fbe764]" />
      <span className="absolute bottom-6 left-[43%] h-3 w-3 rounded-full border-2 border-[#111923] bg-white" />
      <span className="absolute bottom-6 left-[56%] h-3 w-3 rounded-full border-2 border-[#111923] bg-white" />
      {locked && <span className="absolute inset-0 flex items-center justify-center bg-black/42 text-white"><Lock size={24} /></span>}
    </span>
  );
}

function AreaPicker({
  selected,
  proActive,
  lifetimeActive,
  onSelect,
}: {
  selected: RideArea;
  proActive: boolean;
  lifetimeActive: boolean;
  onSelect: (area: RideArea) => void;
}) {
  const areas = [
    {
      id: "park" as RideArea,
      label: "Community Park",
      meta: "Free ride",
      icon: <Bike size={15} />,
      locked: false,
    },
    {
      id: "statePark" as RideArea,
      label: "State Park",
      meta: proActive ? "Unlocked" : "$0.99 week",
      icon: proActive ? <Sparkles size={15} /> : <Lock size={15} />,
      locked: !proActive,
    },
    {
      id: "bikeLand" as RideArea,
      label: "E-Bike Land",
      meta: lifetimeActive ? "Lifetime" : "$7 lifetime",
      icon: lifetimeActive ? <Zap size={15} /> : <Lock size={15} />,
      locked: !lifetimeActive,
    },
  ];

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {areas.map((area) => (
        <button
          key={area.id}
          className={`min-h-14 rounded-md border px-3 py-2 text-left transition active:scale-[0.98] ${
            selected === area.id ? "border-[#fbe764]/70 bg-[#fbe764]/14" : "border-white/12 bg-white/7"
          }`}
          onClick={() => onSelect(area.id)}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[#7cf2ff]">{area.icon}</span>
            {selected === area.id && <span className="h-2 w-2 rounded-full bg-[#fbe764]" />}
          </span>
          <span className="mt-1 block truncate text-xs font-black text-white">{area.label}</span>
          <span className="block truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/45">{area.meta}</span>
        </button>
      ))}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/14 bg-black/28 px-1.5 py-2 text-white shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between text-[#fbe764]">{icon}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/50">{label}</div>
      <div className="whitespace-nowrap text-[12px] font-black leading-tight">{value}</div>
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

function MissionPanel({
  mission,
  status,
}: {
  mission: DailyMission;
  status: ReturnType<typeof missionStatus>;
}) {
  return (
    <div className="mt-3 rounded-md border border-[#7cf2ff]/25 bg-[#7cf2ff]/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7cf2ff]">
            <Target size={13} />
            Daily Mission
          </div>
          <div className="mt-1 truncate text-sm font-black text-white">{mission.title}</div>
          <div className="mt-0.5 text-xs font-semibold text-white/62">{mission.goal}</div>
        </div>
        <div className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-black ${status.done ? "bg-[#a2ff9a] text-[#111923]" : "bg-white/10 text-white"}`}>
          {status.done ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
          {status.done ? "CLEAR" : `+${mission.reward}`}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-[#7cf2ff]" style={{ width: `${Math.round(status.progress * 100)}%` }} />
        </div>
        <div className="w-20 text-right text-[10px] font-black uppercase tracking-[0.08em] text-white/70">{status.label}</div>
      </div>
    </div>
  );
}

function CreditsPanel({
  enabled,
  address,
  userFid,
  dateKey,
  finished,
  onConnect,
}: {
  enabled: boolean;
  address?: `0x${string}`;
  userFid: number;
  dateKey: string;
  finished: boolean;
  onConnect: () => void;
}) {
  const [status, setStatus] = useState("");
  const [requesting, setRequesting] = useState<"ride" | "share" | null>(null);
  const contractReady = !!CASTER_CREDITS_CONTRACT && ETH_ADDRESS_REGEX_CLIENT.test(CASTER_CREDITS_CONTRACT);

  const { data: balance, refetch } = useReadContract({
    address: CASTER_CREDITS_CONTRACT,
    abi: CASTER_CREDITS_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: contractReady && !!address },
  });

  const { writeContract, data: claimHash, isPending: walletOpen } = useWriteContract();
  const { isLoading: confirming, isSuccess: claimed } = useWaitForTransactionReceipt({ hash: claimHash });
  const busy = !!requesting || walletOpen || confirming;

  useEffect(() => {
    if (!claimed) return;
    setStatus("Credits claimed");
    refetch();
  }, [claimed, refetch]);

  const requestClaim = async (kind: "ride" | "share") => {
    if (!enabled) {
      onConnect();
      return;
    }
    if (!contractReady || !CASTER_CREDITS_CONTRACT) {
      setStatus("Credits contract not deployed yet");
      return;
    }
    if (!finished) {
      setStatus("Finish a ride first");
      return;
    }
    if (!userFid) {
      setStatus("Open in Farcaster to claim");
      return;
    }
    if (!address) {
      setStatus("Connect wallet to claim");
      return;
    }

    setRequesting(kind);
    setStatus(kind === "share" ? "Preparing share bonus" : "Preparing ride credits");
    try {
      const res = await sdk.quickAuth.fetch("/api/reward-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey, kind, address }),
      });
      const data = await res.json();
      if (!res.ok || !data.claim) {
        setStatus(data.error || "Credits unavailable");
        return;
      }

      const claim = data.claim as RewardClaimPayload;
      writeContract({
        address: CASTER_CREDITS_CONTRACT,
        abi: CASTER_CREDITS_ABI,
        functionName: "claim",
        args: [
          claim.to,
          BigInt(claim.fid),
          claim.dateKey,
          BigInt(claim.score),
          BigInt(claim.amount),
          claim.claimId,
          BigInt(claim.deadline),
          claim.signature,
        ],
      });
    } catch {
      setStatus("Claim request failed");
    } finally {
      setRequesting(null);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-[#0052ff]/35 bg-[#0052ff]/12 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7cf2ff]">
            <Zap size={13} />
            Onchain Credits
          </div>
          <div className="mt-1 text-sm font-black text-white">{typeof balance === "bigint" ? `${balance.toLocaleString()} CYCLE` : "CYCLE rewards"}</div>
          <div className="mt-0.5 text-xs font-semibold text-white/62">Non-transferable Base credits. No cash value.</div>
        </div>
        <div className={`rounded px-2 py-1 text-[10px] font-black ${contractReady ? "bg-[#a2ff9a] text-[#111923]" : "bg-white/10 text-white/62"}`}>
          {contractReady ? "BASE" : "SETUP"}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-3 text-xs font-black text-[#111923] disabled:opacity-55"
          disabled={busy || !finished || !contractReady}
          onClick={() => requestClaim("ride")}
        >
          <Trophy size={14} />
          {requesting === "ride" || confirming ? "Claiming" : "Ride"}
        </button>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-3 text-xs font-black text-white disabled:opacity-55"
          disabled={busy || !finished || !contractReady}
          onClick={() => requestClaim("share")}
        >
          <Share2 size={14} />
          {requesting === "share" ? "Preparing" : "Share"}
        </button>
      </div>
      <div className="mt-2 min-h-4 text-[10px] font-bold uppercase tracking-[0.08em] text-white/50">
        {status || (contractReady ? "Claim after a verified score." : "Deploy credits contract to enable.")}
      </div>
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
              onClick={() => {
                haptic(unlocked ? "selection" : "warning");
                if (unlocked) onSelect(skin.id);
              }}
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
  period,
  onProfile,
  onScope,
  onPeriod,
}: {
  rows: LeaderboardRow[];
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
  onProfile: (fid: number) => void;
  onScope: (scope: LeaderboardScope) => void;
  onPeriod: (period: LeaderboardPeriod) => void;
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
              onClick={() => {
                haptic("selection");
                onScope(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {(["daily", "weekly"] as LeaderboardPeriod[]).map((item) => (
          <button
            key={item}
            className="min-h-8 rounded-md border px-2 text-[10px] font-black uppercase tracking-[0.08em] text-white"
            style={{
              borderColor: period === item ? "rgba(251,231,100,0.72)" : "rgba(255,255,255,0.12)",
              background: period === item ? "rgba(251,231,100,0.16)" : "rgba(255,255,255,0.06)",
            }}
            onClick={() => {
              haptic("selection");
              onPeriod(item);
            }}
          >
            {item === "daily" ? "today" : "week"}
          </button>
        ))}
      </div>
      <div className="max-h-48 overflow-hidden rounded-md border border-white/12 bg-white/7">
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-xs font-semibold text-white/50">No server scores yet. Finish a ride to seed today.</div>
        ) : (
          rows.slice(0, 5).map((row, index) => (
            <button
              key={`${row.fid}-${row.username}-${index}`}
              className="flex w-full items-center gap-2 border-b border-white/8 px-3 py-2 text-left transition hover:bg-white/5 last:border-b-0"
              onClick={() => {
                haptic("selection");
                if (row.fid > 0) onProfile(row.fid);
              }}
            >
              <div className="w-5 text-xs font-black text-[#fbe764]">{index + 1}</div>
              <div
                className="h-8 w-8 shrink-0 rounded-md border border-white/14 bg-[#101923] bg-cover bg-center"
                style={{ backgroundImage: row.pfpUrl ? `url("${row.pfpUrl}")` : undefined }}
              >
                {!row.pfpUrl && <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-[#7cf2ff]">{(row.username || row.displayName || "R").slice(0, 1).toUpperCase()}</div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-white">{row.username ? `@${row.username}` : row.displayName || "rider"}</div>
                <div className="truncate text-[10px] font-bold text-white/45">{period === "weekly" && row.bestDateKey ? `best ${row.bestDateKey.slice(5)} - ` : ""}{row.routeName}</div>
              </div>
              <div className="grid min-w-[92px] grid-cols-2 gap-1 text-right">
                <div>
                  <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/38">day</div>
                  <div className="text-xs font-black text-white">{row.dailyScore.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/38">week</div>
                  <div className="text-xs font-black text-[#fbe764]">{row.weeklyScore.toLocaleString()}</div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function LoungePanel({ proActive, user }: { proActive: boolean; user?: { fid?: number; username?: string; displayName?: string; pfpUrl?: string } }) {
  const [messages, setMessages] = useState<LoungeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [posting, setPosting] = useState(false);
  const emojis = ["🚲", "⚡", "🌲", "🏀", "🎾", "⚽", "🛹"];

  const cleanDraft = (value: string) =>
    value
      .replace(/https?:\/\/\S+|www\.\S+/gi, "")
      .replace(/\s+/g, " ")
      .slice(0, 100);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/lounge", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.rows)) setMessages(data.rows);
    } catch {}
  }, []);

  useEffect(() => {
    if (proActive) void loadMessages();
  }, [loadMessages, proActive]);

  const sendMessage = async () => {
    const text = cleanDraft(draft).trim();
    if (!proActive) {
      setStatus("Pass required");
      return;
    }
    if (!user?.fid) {
      setStatus("Open in Farcaster");
      return;
    }
    if (!text) return;
    setPosting(true);
    setStatus("");
    try {
      const res = await sdk.quickAuth.fetch("/api/lounge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          username: user.username || "",
          displayName: user.displayName || "",
          pfpUrl: user.pfpUrl || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Message blocked");
        return;
      }
      setDraft("");
      if (Array.isArray(data.rows)) setMessages(data.rows);
      haptic("success");
    } catch {
      setStatus("Lounge unavailable");
    } finally {
      setPosting(false);
    }
  };

  if (!proActive) {
    return (
      <div className="mt-4 rounded-md border border-[#7cf2ff]/24 bg-[#7cf2ff]/10 p-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#7cf2ff]">
          <Users size={13} />
          Paid Club Lounge
        </div>
        <div className="mt-2 text-lg font-black text-white">Unlock the rider club.</div>
        <p className="mt-1 text-xs font-semibold leading-5 text-white/58">Short clean chat, garage talk, and paid rider drops live here.</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#7cf2ff]">
          <Users size={13} />
          Club Lounge
        </div>
        <button className="rounded border border-white/12 bg-white/7 px-2 py-1 text-[10px] font-black uppercase text-white/62" onClick={loadMessages}>
          refresh
        </button>
      </div>
      <div className="mt-2 max-h-40 overflow-hidden rounded-md border border-white/12 bg-white/7">
        {messages.length === 0 ? (
          <div className="px-3 py-4 text-xs font-semibold text-white/50">No lounge messages yet.</div>
        ) : (
          messages.slice(0, 6).map((message) => (
            <div key={message.id} className="flex gap-2 border-b border-white/8 px-3 py-2 last:border-b-0">
              <div
                className="h-7 w-7 shrink-0 rounded bg-[#101923] bg-cover bg-center"
                style={{ backgroundImage: message.pfpUrl ? `url("${message.pfpUrl}")` : undefined }}
              />
              <div className="min-w-0">
                <div className="truncate text-[10px] font-black text-[#fbe764]">{message.username ? `@${message.username}` : message.displayName || "rider"}</div>
                <div className="break-words text-xs font-semibold leading-4 text-white/78">{message.text}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-1">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            className="h-8 w-8 rounded-md border border-white/12 bg-white/7 text-sm"
            onClick={() => setDraft((value) => cleanDraft(`${value}${emoji}`))}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          maxLength={100}
          placeholder="100 chars, no links"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-white/12 bg-black/24 px-3 text-sm font-semibold text-white outline-none placeholder:text-white/32"
          onChange={(event) => setDraft(cleanDraft(event.target.value))}
        />
        <button className="rounded-md bg-[#fbe764] px-3 text-xs font-black text-[#111923] disabled:opacity-60" disabled={posting || !draft.trim()} onClick={sendMessage}>
          Send
        </button>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-bold uppercase tracking-[0.08em] text-white/38">
        <span>{status || "No links. Keep it clean."}</span>
        <span>{draft.length}/100</span>
      </div>
    </div>
  );
}

function UpgradePanel({
  enabled,
  isPro,
  weeklyActive,
  annualActive,
  onConnect,
  onEthSupport,
  onPassPurchased,
  onVoiceInfo,
}: {
  enabled: boolean;
  isPro: boolean;
  weeklyActive: boolean;
  annualActive: boolean;
  onConnect: () => void;
  onEthSupport: () => void;
  onPassPurchased: (plan: "weekly" | "lifetime") => void;
  onVoiceInfo: () => void;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [plan, setPlan] = useState<"weekly" | "lifetime">("weekly");
  const [pendingPlan, setPendingPlan] = useState<"weekly" | "lifetime" | null>(null);
  const [step, setStep] = useState<"idle" | "buying">("idle");
  const price = BigInt(plan === "weekly" ? WEEKLY_PRICE : YEARLY_PRICE);
  const priceLabel = plan === "weekly" ? "$0.99 weekly" : "$7 lifetime";

  const { data: balance } = useReadContract({
    address: USDC_CONTRACT,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract: buy, data: buyHash, reset: resetBuy } = useWriteContract();
  const { sendTransaction, data: ethHash, isPending: sendingEth } = useSendTransaction();
  const { isLoading: buying, isSuccess: bought } = useWaitForTransactionReceipt({ hash: buyHash });
  const { isLoading: confirmingEth, isSuccess: ethConfirmed } = useWaitForTransactionReceipt({ hash: ethHash });

  const hasEnough = typeof balance === "bigint" && balance >= price;
  const busy = buying || sendingEth || confirmingEth || step !== "idle";
  const treasuryReady = !!TREASURY_ADDRESS && ETH_ADDRESS_REGEX_CLIENT.test(TREASURY_ADDRESS);
  const selectedPlanActive = plan === "weekly" ? weeklyActive : annualActive;

  useEffect(() => {
    if (bought && step === "buying") {
      if (pendingPlan) onPassPurchased(pendingPlan);
      setPendingPlan(null);
      setStep("idle");
    }
  }, [bought, onPassPurchased, pendingPlan, step]);

  useEffect(() => {
    if (ethConfirmed) onEthSupport();
  }, [ethConfirmed, onEthSupport]);

  const purchase = () => {
    if (!address) {
      onConnect();
      return;
    }
    if (!treasuryReady) return;
    if (chainId !== BASE_CHAIN_ID) {
      switchChain?.({ chainId: BASE_CHAIN_ID });
      return;
    }
    setStep("buying");
    setPendingPlan(plan);
    resetBuy();
    buy({
      address: USDC_CONTRACT,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [TREASURY_ADDRESS, BigInt(plan === "weekly" ? WEEKLY_PRICE : YEARLY_PRICE)],
      chainId: BASE_CHAIN_ID,
    });
  };

  const supportWithEth = () => {
    if (!address) {
      onConnect();
      return;
    }
    if (!treasuryReady) return;
    if (chainId !== BASE_CHAIN_ID) {
      switchChain?.({ chainId: BASE_CHAIN_ID });
      return;
    }
    sendTransaction({
      to: TREASURY_ADDRESS,
      value: parseEther(ETH_SUPPORT_AMOUNT),
      chainId: BASE_CHAIN_ID,
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
            Open State Park for a week, or go lifetime for E-Bike Land, Carbon Pro, the club lounge, and future premium rides.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Play Cycle Pass payment note"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/18 text-white/72 active:scale-[0.98]"
            onClick={onVoiceInfo}
          >
            <Radio size={14} />
          </button>
          {isPro && <div className="rounded bg-[#a2ff9a] px-2 py-1 text-[10px] font-black text-[#111923]">ACTIVE</div>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="rounded-md border px-2 py-2 text-xs font-black text-white"
          style={{ borderColor: plan === "weekly" ? "#fbe764" : "rgba(255,255,255,0.14)" }}
          onClick={() => setPlan("weekly")}
        >
          <span className="block">Weekly $0.99</span>
          <span className="mt-1 block text-[10px] font-bold text-white/52">State Park</span>
        </button>
        <button
          className="rounded-md border px-2 py-2 text-xs font-black text-white"
          style={{ borderColor: plan === "lifetime" ? "#fbe764" : "rgba(255,255,255,0.14)" }}
          onClick={() => setPlan("lifetime")}
        >
          <span className="block">Lifetime $7</span>
          <span className="mt-1 block text-[10px] font-bold text-white/52">All worlds</span>
        </button>
      </div>
      <button
        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[#fbe764] px-3 text-xs font-black text-[#111923] disabled:opacity-60"
        disabled={enabled && (!hasEnough || busy || !treasuryReady || selectedPlanActive)}
        onClick={purchase}
      >
        <Wallet size={15} />
        {!enabled
          ? "Connect for Base USDC"
          : selectedPlanActive
            ? plan === "weekly" ? "Weekly Active" : "Lifetime Active"
            : !treasuryReady
              ? "Set treasury address"
              : chainId !== BASE_CHAIN_ID
                ? "Switch to Base"
              : busy
                ? "Confirming"
                : hasEnough
                  ? `Buy ${priceLabel}`
                  : "Need USDC on Base"}
      </button>
      <button
        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-3 text-xs font-black text-white disabled:opacity-60"
        disabled={enabled && (!treasuryReady || busy)}
        onClick={supportWithEth}
      >
        <Sparkles size={15} />
        {!enabled ? "Connect for Base ETH" : !treasuryReady ? "Set treasury address" : chainId !== BASE_CHAIN_ID ? "Switch to Base" : sendingEth || confirmingEth ? "Confirming ETH" : `Support ${ETH_SUPPORT_AMOUNT} ETH`}
      </button>
      <div className="mt-2 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/42">
        Treasury {TREASURY_ADDRESS}
      </div>
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
  ctx.save();
  if (game.shake > 0) {
    const pulse = Math.sin(now * 0.08) * game.shake * 7;
    ctx.translate(pulse, Math.cos(now * 0.07) * game.shake * 4);
  }

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, game.route.skyTop);
  sky.addColorStop(0.54, game.route.skyBottom);
  sky.addColorStop(1, "#111923");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawWorld(ctx, width, height, game, now);
  if (game.phase === "riding") drawSpeedLines(ctx, width, height, game, now);
  drawRoad(ctx, width, height, game);
  drawRouteFx(ctx, width, height, game, now);
  drawApproachWarnings(ctx, width, height, game, now);

  const visible = game.entities
    .filter((entity) => !entity.collected && entity.at - game.distance > -60 && entity.at - game.distance < VIEW_DISTANCE)
    .sort((a, b) => b.at - a.at);

  for (const entity of visible) {
    const rel = entity.at - game.distance;
    const progress = 1 - rel / VIEW_DISTANCE;
    drawEntity(ctx, width, height, entity, progress, game.route, now);
  }

  drawPlayer(ctx, width, height, game, skin, now);
  drawFeedback(ctx, width, height, game);

  if (game.phase === "ready") drawStartText(ctx, width, height, game);
  if (game.phase === "finished") drawFinishGate(ctx, width, height, game);
  drawVignette(ctx, width, height, game);
  ctx.restore();
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

  drawParkLandmarks(ctx, width, height, game, now);
}

function drawParkLandmarks(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  const horizon = height * 0.25;
  const statePark = game.route.area === "statePark";
  const bikeLand = game.route.area === "bikeLand";

  const grass = ctx.createLinearGradient(0, horizon, 0, height);
  grass.addColorStop(0, bikeLand ? "rgba(67,54,130,0.38)" : statePark ? "rgba(92,156,84,0.36)" : "rgba(139,203,82,0.36)");
  grass.addColorStop(0.58, bikeLand ? "rgba(38,120,122,0.72)" : statePark ? "rgba(50,112,74,0.72)" : "rgba(73,151,78,0.66)");
  grass.addColorStop(1, bikeLand ? "rgba(28,35,75,0.92)" : "rgba(24,65,50,0.92)");
  ctx.fillStyle = grass;
  ctx.fillRect(0, horizon, width, height - horizon);

  if (statePark || bikeLand) {
    ctx.fillStyle = "rgba(48,88,82,0.7)";
    ctx.beginPath();
    ctx.moveTo(0, horizon + 54);
    ctx.lineTo(width * 0.22, horizon - 8);
    ctx.lineTo(width * 0.44, horizon + 54);
    ctx.lineTo(width * 0.66, horizon - 18);
    ctx.lineTo(width, horizon + 58);
    ctx.lineTo(width, horizon + 110);
    ctx.lineTo(0, horizon + 110);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = statePark ? 0.72 : 0.62;
  ctx.strokeStyle = bikeLand ? "rgba(255,122,223,0.68)" : statePark ? "rgba(124,242,255,0.72)" : "rgba(95,202,234,0.66)";
  ctx.lineWidth = bikeLand ? 14 : statePark ? 18 : 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 9; i += 1) {
    const y = horizon + i * ((height - horizon) / 8);
    const x = width * (statePark ? 0.18 : 0.82) + Math.sin(i * 1.1 + now / 1600) * width * 0.08;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  const labels = bikeLand
    ? ["PUMP", "VELO", "JUMPS", "SHOP", "CLUB", "GLOW"]
    : statePark
    ? ["RIVER", "PINES", "LOOKOUT", "MEADOW", "TRAIL"]
    : ["SKATE", "HOOPS", "TENNIS", "SOCCER", "PICNIC", "STREAM"];

  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i += 1) {
      const loop = (i * 190 - (game.distance * (statePark ? 0.58 : 0.72)) % 190 + 190) % 190;
      const progress = loop / 190;
      const y = horizon + progress * (height - horizon);
      const scale = 0.28 + progress * 1.08;
      const x = width / 2 + side * (width * (0.24 + progress * 0.38));
      const label = labels[(i + (side > 0 ? 2 : 0)) % labels.length];
      ctx.save();
      ctx.translate(x, y - 58 * scale);
      ctx.rotate(side * (statePark ? -0.06 : -0.1));
      ctx.scale(scale, scale);

      if (bikeLand) {
        drawBikeLandFeature(ctx, label, game.route.roadEdge);
      } else if (statePark) {
        drawPineCluster(ctx, label, game.route.roadEdge);
      } else if (label === "SKATE") {
        drawSkatepark(ctx);
      } else if (label === "HOOPS") {
        drawBasketballCourt(ctx);
      } else if (label === "TENNIS") {
        drawTennisCourt(ctx);
      } else if (label === "SOCCER") {
        drawSoccerField(ctx);
      } else {
        drawParkSign(ctx, label, game.route.roadEdge);
      }
      ctx.restore();
    }
  }
}

function drawBikeLandFeature(ctx: CanvasRenderingContext2D, label: string, accent: string) {
  ctx.fillStyle = "rgba(22,28,62,0.9)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, -42, -24, 84, 48, 9);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = label === "VELO" ? "#fbe764" : "#ff7adf";
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (label === "VELO") {
    ctx.ellipse(0, 2, 29, 15, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-30, 14);
    ctx.quadraticCurveTo(-15, -20, 0, 8);
    ctx.quadraticCurveTo(16, 32, 32, -10);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, -4);
}

function drawParkSign(ctx: CanvasRenderingContext2D, label: string, accent: string) {
  ctx.fillStyle = "rgba(17,45,36,0.82)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, -34, -18, 68, 36, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
}

function drawSkatepark(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(37,54,64,0.86)";
  roundRect(ctx, -40, -22, 80, 44, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-18, 2, 16, 0, Math.PI, true);
  ctx.arc(20, 2, 16, 0, Math.PI, true);
  ctx.stroke();
}

function drawBasketballCourt(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(210,104,62,0.86)";
  roundRect(ctx, -38, -22, 76, 44, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-30, -16, 60, 32);
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTennisCourt(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(46,154,113,0.88)";
  roundRect(ctx, -40, -24, 80, 48, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-32, -18, 64, 36);
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(0, 18);
  ctx.moveTo(-32, 0);
  ctx.lineTo(32, 0);
  ctx.stroke();
}

function drawSoccerField(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(60,143,69,0.88)";
  roundRect(ctx, -44, -25, 88, 50, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-36, -19, 72, 38);
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPineCluster(ctx: CanvasRenderingContext2D, label: string, accent: string) {
  for (let i = -1; i <= 1; i += 1) {
    ctx.fillStyle = i === 0 ? "rgba(24,87,54,0.95)" : "rgba(29,105,65,0.86)";
    ctx.beginPath();
    ctx.moveTo(i * 18, -36);
    ctx.lineTo(i * 18 - 18, 8);
    ctx.lineTo(i * 18 + 18, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(91,65,38,0.92)";
    ctx.fillRect(i * 18 - 3, 8, 6, 18);
  }
  drawParkSign(ctx, label, accent);
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  const intensity = 0.2 + game.boost * 0.46 + Math.min(0.18, game.combo * 0.012);
  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.lineCap = "round";
  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const drift = ((i * 97 + now * (0.045 + game.boost * 0.04)) % 420) / 420;
    const y = height * 0.2 + drift * height * 0.76;
    const length = 24 + drift * 90 + game.boost * 40;
    const x = width / 2 + side * (width * (0.18 + drift * 0.42));
    ctx.strokeStyle = i % 3 === 0 ? game.route.roadEdge : game.route.bolt;
    ctx.lineWidth = 1.2 + drift * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * length, y + length * 0.48);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel) {
  const edge = ctx.createRadialGradient(width / 2, height * 0.5, width * 0.18, width / 2, height * 0.5, width * 0.82);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.72, "rgba(0,0,0,0.08)");
  edge.addColorStop(1, `rgba(3,8,14,${0.36 + game.boost * 0.08})`);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
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

  ctx.save();
  ctx.globalAlpha = 0.58 + game.boost * 0.24;
  for (const lane of [-1, 0, 1] as Lane[]) {
    const points = [0.12, 0.34, 0.56, 0.78].map((p) => lanePoint(width, height, lane, p));
    ctx.strokeStyle = lane === 0 ? "rgba(251,231,100,0.28)" : "rgba(124,242,255,0.22)";
    ctx.lineWidth = lane === 0 ? 8 : 5;
    ctx.shadowColor = lane === 0 ? game.route.bolt : game.route.roadEdge;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();

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

  for (let i = 0; i < 8; i += 1) {
    const loop = (i * 135 - (game.distance * 1.04) % 135 + 135) % 135;
    const p = loop / 135;
    const point = lanePoint(width, height, 0, p);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(point.scale, point.scale);
    ctx.globalAlpha = 0.36 + game.boost * 0.25;
    ctx.strokeStyle = game.route.bolt;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-18, 8);
    ctx.lineTo(0, -8);
    ctx.lineTo(18, 8);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRouteFx(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  const horizon = height * 0.25;
  const pulse = 0.5 + Math.sin(now / 260) * 0.5;
  const comboGlow = Math.min(1, game.combo / 12);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < 14; i += 1) {
    const loop = (i * 118 - (game.distance * (0.92 + game.boost * 0.22)) % 118 + 118) % 118;
    const p = loop / 118;
    const left = lanePoint(width, height, -1.42, p);
    const right = lanePoint(width, height, 1.42, p);
    const alpha = 0.12 + p * 0.45 + game.boost * 0.18;

    ctx.fillStyle = game.route.roadEdge;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(left.x, left.y, 2 + p * 5, 1.5 + p * 3, 0, 0, Math.PI * 2);
    ctx.ellipse(right.x, right.y, 2 + p * 5, 1.5 + p * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 6; i += 1) {
    const loop = (i * 210 - (game.distance * 1.08) % 210 + 210) % 210;
    const p = loop / 210;
    const point = lanePoint(width, height, 0, p);
    const scale = point.scale;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.18 + p * 0.28 + game.boost * 0.18;
    ctx.strokeStyle = i % 2 === 0 ? game.route.bolt : game.route.roadEdge;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-28, 10);
    ctx.lineTo(0, -14);
    ctx.lineTo(28, 10);
    ctx.moveTo(-18, 24);
    ctx.lineTo(0, 8);
    ctx.lineTo(18, 24);
    ctx.stroke();
    ctx.restore();
  }

  if (game.phase !== "finished") {
    const signY = horizon + 18 + Math.sin(now / 520) * 3;
    const signW = Math.min(width - 108, 238);
    ctx.globalAlpha = 0.42 + pulse * 0.12;
    ctx.fillStyle = "rgba(17,25,35,0.58)";
    ctx.strokeStyle = game.route.roadEdge;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = game.route.roadEdge;
    ctx.shadowBlur = 12;
    roundRect(ctx, width / 2 - signW / 2, signY - 20, signW, 38, 7);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(game.route.name.toUpperCase(), width / 2, signY);
  }

  if (comboGlow > 0) {
    const y = height * 0.78;
    const glow = ctx.createRadialGradient(width / 2, y, 8, width / 2, y, width * 0.4);
    glow.addColorStop(0, `rgba(251,231,100,${0.1 * comboGlow})`);
    glow.addColorStop(0.45, `rgba(124,242,255,${0.08 * comboGlow})`);
    glow.addColorStop(1, "rgba(124,242,255,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(0, height * 0.48, width, height * 0.52);
  }

  ctx.restore();
}

function drawApproachWarnings(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  if (game.phase !== "riding") return;
  const threats = game.entities
    .map((entity) => ({ entity, rel: entity.at - game.distance }))
    .filter(({ entity, rel }) =>
      entity.kind !== "bolt" &&
      entity.kind !== "ramp" &&
      entity.kind !== "gate" &&
      !entity.hit &&
      rel > 80 &&
      rel < 680 &&
      Math.abs(entity.lane - game.targetLane) < 0.35,
    )
    .slice(0, 3);

  if (threats.length === 0) return;
  const urgent = Math.min(...threats.map((threat) => threat.rel)) < 300;
  const pulse = 0.55 + Math.sin(now / 90) * 0.45;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const { rel, entity } of threats) {
    const progress = 1 - rel / VIEW_DISTANCE;
    const point = lanePoint(width, height, entity.lane, progress);
    const alpha = clamp(0.18 + progress * 0.46 + pulse * 0.12, 0.12, 0.82);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(point.scale, point.scale);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ff5d73";
    ctx.fillStyle = "rgba(255,93,115,0.12)";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#ff5d73";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.ellipse(0, 8, 44, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-26, -28);
    ctx.lineTo(0, -48);
    ctx.lineTo(26, -28);
    ctx.moveTo(-18, -12);
    ctx.lineTo(0, -26);
    ctx.lineTo(18, -12);
    ctx.stroke();
    ctx.restore();
  }

  if (urgent) {
    const meterY = height - 204;
    const laneX = lanePoint(width, height, game.targetLane, 0.88).x;
    ctx.globalAlpha = 0.34 + pulse * 0.2;
    ctx.strokeStyle = "#ff5d73";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ff5d73";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(laneX - 42, meterY);
    ctx.lineTo(laneX, meterY - 16);
    ctx.lineTo(laneX + 42, meterY);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
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
  } else if (entity.kind === "gate") {
    ctx.strokeStyle = route.roadEdge;
    ctx.shadowColor = route.roadEdge;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, -2, 33, -Math.PI * 0.12, Math.PI * 1.12);
    ctx.stroke();
    ctx.fillStyle = "rgba(17,25,35,0.82)";
    roundRect(ctx, -24, -10, 48, 20, 6);
    ctx.fill();
    ctx.fillStyle = route.bolt;
    ctx.beginPath();
    ctx.moveTo(-3, -18);
    ctx.lineTo(12, -1);
    ctx.lineTo(2, 0);
    ctx.lineTo(7, 18);
    ctx.lineTo(-13, 1);
    ctx.lineTo(-3, -1);
    ctx.closePath();
    ctx.fill();
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
  const baseY = height - 158 - game.airborne * 42;
  const horizon = height * 0.25;
  const riderProgress = clamp((baseY - horizon) / (height - 108 - horizon), 0, 1);
  const x = lanePoint(width, height, game.laneOffset, riderProgress).x;
  const laneLean = game.targetLane - game.laneOffset;
  const lean = clamp(laneLean * 0.32 + game.laneOffset * 0.035, -0.32, 0.32);
  const bob = Math.sin(now / 90) * 2;

  ctx.save();
  ctx.translate(x, baseY + bob);
  ctx.rotate(lean);
  if (game.phase === "riding") {
    ctx.strokeStyle = skin.trail;
    ctx.globalAlpha = 0.22 + game.boost * 0.35;
    ctx.lineWidth = 10 + game.boost * 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-18, 38);
    ctx.quadraticCurveTo(-28 - laneLean * 14, 82 + game.boost * 18, -12 - laneLean * 18, 130 + game.boost * 22);
    ctx.moveTo(18, 38);
    ctx.quadraticCurveTo(28 - laneLean * 14, 82 + game.boost * 18, 12 - laneLean * 18, 130 + game.boost * 22);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 12; i += 1) {
      const t = ((now * (0.0016 + game.boost * 0.0011) + i * 0.083) % 1);
      const side = i % 2 === 0 ? -1 : 1;
      const drift = Math.sin(now / 210 + i) * 7 + laneLean * 22;
      ctx.globalAlpha = (1 - t) * (0.28 + game.boost * 0.32);
      ctx.fillStyle = i % 3 === 0 ? skin.battery : skin.trail;
      ctx.beginPath();
      ctx.ellipse(side * (18 + t * 20) + drift, 48 + t * 126, 2.2 + t * 4.5, 1.4 + t * 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath();
  ctx.ellipse(0, 56 + game.airborne * 42, 46, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  const auraPower = Math.min(1, game.boost * 0.8 + game.combo * 0.035);
  if (auraPower > 0.02) {
    const aura = ctx.createRadialGradient(0, 8, 12, 0, 8, 86);
    aura.addColorStop(0, `${skin.trail}${Math.round(70 * auraPower).toString(16).padStart(2, "0")}`);
    aura.addColorStop(0.48, `${skin.battery}${Math.round(42 * auraPower).toString(16).padStart(2, "0")}`);
    aura.addColorStop(1, "rgba(124,242,255,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.ellipse(0, 6, 74, 98, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPerspectiveWheel(ctx, 34, 24, 34, now / 72, skin.trail, true);
  drawPerspectiveWheel(ctx, -38, 15, 25, now / 72, skin.trail, false);

  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 7.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-18, 32);
  ctx.lineTo(-10, -6);
  ctx.lineTo(0, -38);
  ctx.lineTo(10, -6);
  ctx.lineTo(18, 32);
  ctx.moveTo(-10, -6);
  ctx.lineTo(10, -6);
  ctx.moveTo(0, -38);
  ctx.lineTo(0, 10);
  ctx.stroke();

  ctx.strokeStyle = skin.battery;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-15, 12);
  ctx.lineTo(0, -20);
  ctx.lineTo(15, 12);
  ctx.moveTo(-17, -38);
  ctx.lineTo(0, -46);
  ctx.lineTo(17, -38);
  ctx.stroke();

  ctx.fillStyle = skin.frame;
  roundRect(ctx, -18, -13, 36, 22, 5);
  ctx.fill();
  ctx.fillStyle = "#101923";
  roundRect(ctx, -10, -8, 20, 8, 3);
  ctx.fill();

  ctx.fillStyle = "#ff4d5f";
  ctx.shadowColor = "#ff4d5f";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(0, 24, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = skin.battery;
  ctx.shadowColor = skin.battery;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(0, -51, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#101923";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-7, -70);
  ctx.lineTo(-4, -25);
  ctx.moveTo(7, -70);
  ctx.lineTo(4, -25);
  ctx.moveTo(-2, -47);
  ctx.lineTo(-24, -18);
  ctx.moveTo(2, -47);
  ctx.lineTo(24, -18);
  ctx.stroke();

  ctx.fillStyle = "#132031";
  roundRect(ctx, -18, -66, 36, 42, 12);
  ctx.fill();
  ctx.fillStyle = skin.trail;
  ctx.globalAlpha = 0.85;
  roundRect(ctx, -11, -60, 22, 26, 8);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#f6d2a8";
  ctx.beginPath();
  ctx.arc(0, -82, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff5d73";
  ctx.beginPath();
  ctx.ellipse(0, -92, 17, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFeedback(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel) {
  if (game.feedbackT <= 0 || !game.feedback) return;
  const alpha = clamp(game.feedbackT / 0.82, 0, 1);
  const y = height * 0.38 - (1 - alpha) * 18;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 18px system-ui, sans-serif";
  const textWidth = Math.min(width - 64, ctx.measureText(game.feedback).width + 42);
  ctx.fillStyle = "rgba(10,16,24,0.72)";
  ctx.strokeStyle = game.feedbackColor;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = game.feedbackColor;
  ctx.shadowBlur = 16;
  roundRect(ctx, width / 2 - textWidth / 2, y - 20, textWidth, 40, 7);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = game.feedbackColor;
  ctx.fillText(game.feedback, width / 2, y);
  ctx.restore();
}

function drawPerspectiveWheel(ctx: CanvasRenderingContext2D, y: number, radiusX: number, radiusY: number, spin: number, accent: string, rear: boolean) {
  ctx.strokeStyle = "#eef8ff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = rear ? 2.5 : 2;
  for (let i = 0; i < 4; i += 1) {
    const angle = spin + i * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(Math.cos(angle) * radiusX * 0.72, y + Math.sin(angle) * radiusY * 0.72);
    ctx.stroke();
  }
  ctx.fillStyle = rear ? "#101923" : "#172033";
  ctx.beginPath();
  ctx.ellipse(0, y, rear ? 5 : 4, rear ? 7 : 5, 0, 0, Math.PI * 2);
  ctx.fill();
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
