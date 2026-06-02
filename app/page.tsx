"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
  Home,
  Lock,
  Map,
  Play,
  Radio,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Users,
  ExternalLink,
  Volume2,
  VolumeX,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import { parseEther } from "viem";
import { useAccount, useChainId, useConnect, useReadContract, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useFarcasterUser } from "@/components/farcaster-gate";
import {
  BASE_CHAIN_ID,
  DAY_PRICE,
  ETH_SUPPORT_AMOUNT,
  TREASURY_ADDRESS,
  USDC_ABI,
  USDC_CONTRACT,
  YEARLY_PRICE,
  formatPassExpiry,
} from "@/lib/pro-pass";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://castercycle.vercel.app";
const SHARE_URL = process.env.NEXT_PUBLIC_SHARE_URL || "https://farcaster.xyz/miniapps/_U8dgupnJBvv/castercycle";
const ETH_ADDRESS_REGEX_CLIENT = /^0x[0-9a-f]{40}$/i;
const COURSE_LENGTH = 16800;
const VIEW_DISTANCE = 1420;
const STORAGE_PREFIX = "castercycle";
const DAY_SECONDS = 24 * 60 * 60;
const LIFETIME_SECONDS = 80 * 365 * 24 * 60 * 60;
const FREE_ROAM_SECONDS = 30;
const KINGBULL_RANGER_URL = "https://sovrn.co/1f76den";
const KINGBULL_COUPON_CODE = process.env.NEXT_PUBLIC_KINGBULL_COUPON_CODE || "GET50OFF";
const KINGBULL_REDDIT_SEARCH_URL = "https://www.reddit.com/r/ebikes/search/?q=kingbull%20ranger&restrict_sr=1";
const TERMS_URL = `${APP_URL}/terms`;
const THEME_STORAGE_KEY = `${STORAGE_PREFIX}:theme`;

type RidePhase = "ready" | "riding" | "finished";
type Lane = -1 | 0 | 1;
type EntityKind = "bolt" | "battery" | "ring" | "cone" | "pothole" | "barrier" | "ramp" | "gate";
type LeaderboardScope = "global" | "friends";
type LeaderboardPeriod = "daily" | "weekly";
type LeaderboardMode = "dash" | "freestyle";
type DashboardTab = "ride" | "shop" | "garage" | "club" | "leaders" | "quest";
type RideArea = "park" | "statePark" | "bikeLand" | "skyline";
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
  | "finalStretch"
  | "parkZone"
  | "parkBoost"
  | "paywall";
type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";
type PassPlan = "day" | "lifetime";
type ThemeMode = "system" | "dark" | "light" | "custom";

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
  chapterNotified: number;
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
  mode?: LeaderboardMode;
};

type ParkObjective = {
  id: string;
  label: string;
  value: string;
  progress: number;
  done: boolean;
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

type FreeRideModel = {
  area: RideArea;
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  targetSpot: string | null;
  speed: number;
  pedalPower: number;
  distance: number;
  remaining: number;
  parkScore: number;
  combo: number;
  pickupCooldown: number;
  lastBoostSpot: string | null;
  jumpLines: number;
  lastJumpLineDistance: number;
  terrainFlow: number;
  lastFlowTerrain: string;
  voiceCooldown: number;
  submitted: boolean;
  terrain: string;
  message: string;
  messageT: number;
  zone: string;
  warned: boolean;
  visitedZones: string[];
};

type FreeRideHud = {
  active: boolean;
  speed: number;
  distance: number;
  remaining: number;
  score: number;
  combo: number;
  message: string;
  objectives: ParkObjective[];
  terrain: string;
  unlimited: boolean;
  zone: string;
};

type PassReceipt = {
  plan: PassPlan;
  txLabel: string;
  purchasedAt: number;
  validUntil: number;
};

type RideRecap = {
  mode: LeaderboardMode;
  title: string;
  score: number;
  distance: number;
  zones?: number;
  combo: number;
  eventLabel?: string;
  eventBonus?: number;
  routeName: string;
};

type RangerGuideMessage = {
  role: "user" | "guide";
  text: string;
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
    tagline: "open forest paths and streams",
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
    tagline: "paid pump tracks and glow paths",
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
  {
    name: "Skyline Circuit",
    tagline: "paid rooftops and glass bridges",
    area: "skyline",
    skyTop: "#15183f",
    skyBottom: "#5f7bff",
    road: "#1e274f",
    roadEdge: "#7cf2ff",
    accent: "#fbe764",
    bolt: "#c4b5fd",
    hazard: "#ff8b4a",
    curb: "#edf8ff",
  },
];

const SKINS: Skin[] = [
  { id: "signal", name: "Signal Yellow", frame: "#fbe764", battery: "#7cf2ff", trail: "#fbe764", unlock: "base", label: "starter" },
  { id: "mint", name: "Courier Mint", frame: "#7cf2ff", battery: "#a2ff9a", trail: "#a2ff9a", unlock: "streak", label: "3 day streak" },
  { id: "sunset", name: "Sunset Dash", frame: "#ff6d4a", battery: "#ffe45e", trail: "#ffb703", unlock: "score", label: "5k score" },
  { id: "spark", name: "Base Spark", frame: "#0052ff", battery: "#fbe764", trail: "#7cf2ff", unlock: "supporter", label: "ETH support" },
  { id: "carbon", name: "Carbon Pro", frame: "#f7fbff", battery: "#c4b5fd", trail: "#c4b5fd", unlock: "pro", label: "Cycle Pass" },
  { id: "forest", name: "Forest Cruiser", frame: "#9ff28a", battery: "#fbe764", trail: "#9ff28a", unlock: "base", label: "State Park" },
  { id: "neon", name: "Glow Track", frame: "#ff7adf", battery: "#7cf2ff", trail: "#ff7adf", unlock: "pro", label: "E-Bike Land" },
  { id: "aero", name: "Aero Skyline", frame: "#7cf2ff", battery: "#fbe764", trail: "#c4b5fd", unlock: "pro", label: "Skyline" },
];

const RANGER_STATS = [
  { label: "Sale price", value: "$799", detail: "Listed sale signal. Verify at checkout." },
  { label: "Coupon", value: "$50 off", detail: `Try code ${KINGBULL_COUPON_CODE} at checkout.` },
  { label: "Top speed", value: "Up to 28 mph", detail: "Class 3 capable, check local rules." },
  { label: "Range", value: "Up to 80 miles", detail: "Ideal conditions, rider/load dependent." },
  { label: "Motor", value: "750W hub", detail: "1300W peak, 80 Nm listed torque." },
  { label: "Battery", value: "48V 18Ah", detail: "864Wh lithium pack." },
];

const RANGER_FUN_FACTS = [
  "Moped-style frame, fat tires, and long bench seat make it feel closer to a mini moto than a lightweight commuter.",
  "The 864Wh battery is the range story, but speed, hills, weight, wind, tire pressure, and throttle use all matter.",
  "Hydraulic brakes and local Class 3 rules are the two things to inspect before treating it like a fast street ride.",
];

const RANGER_VIDEOS = [
  {
    id: "KIY9w0HD4_M",
    title: "Kingbull Ranger feature video",
    channel: "YouTube",
  },
  {
    id: "8q_OuQEwmhM",
    title: "Kingbull Ranger ride/review video",
    channel: "YouTube",
  },
  {
    id: "_rFuAleokbA",
    title: "Kingbull Ranger owner video",
    channel: "YouTube",
  },
];

const RANGER_SHORTS = [
  {
    id: "BLgRulKFLDs",
    title: "Ranger short clip",
  },
  {
    id: "s9wduz319OI",
    title: "Ranger quick look",
  },
];

function rangerGuideAnswer(input: string) {
  const text = input.toLowerCase();
  if (text.includes("price") || text.includes("deal") || text.includes("buy") || text.includes("sale") || text.includes("coupon")) {
    return `The current fan-page deal callout is $799, plus a $50 off coupon code: ${KINGBULL_COUPON_CODE}. Use Buy Ranger or Deals for the affiliate promo link, and verify final price at checkout.`;
  }
  if (text.includes("range") || text.includes("battery") || text.includes("mile")) {
    return "Ranger is listed with a 48V 18Ah battery, 864Wh total capacity, and up to 80 miles under ideal conditions. Real range changes with speed, rider weight, hills, tire pressure, wind, cargo, and throttle use.";
  }
  if (text.includes("speed") || text.includes("class") || text.includes("legal") || text.includes("law")) {
    return "The Ranger is listed up to 28 mph, which is Class 3 territory in many US areas. E-bike laws vary by state, city, trail, and path, so check local rules before riding fast or using throttle.";
  }
  if (text.includes("motor") || text.includes("torque") || text.includes("hill")) {
    return "The listed motor is a 750W brushless rear hub with 1300W peak and 80 Nm torque. That is a strong setup for a moped-style fat tire e-bike, but steep hills and heavy payloads still reduce speed and range.";
  }
  if (text.includes("weight") || text.includes("carry") || text.includes("payload") || text.includes("two")) {
    return "Ranger is listed around 88 lb with a 350 lb max payload and an extended bench seat. It is more moped-style than lightweight bicycle, so plan storage, stairs, racks, and transport carefully.";
  }
  if (text.includes("brake") || text.includes("safety") || text.includes("helmet")) {
    return "The listed brakes are dual hydraulic discs with 180mm rotors and motor cut-off levers. Wear a helmet, test brakes before rides, and treat 20x4 fat tires plus moped weight with respect.";
  }
  if (text.includes("tire") || text.includes("suspension") || text.includes("comfort")) {
    return "Ranger is listed with CST 20 x 4.0 fat tires, a dual-crown front fork, and a rear spring shock. That points toward comfort and mixed-surface stability, not nimble lightweight handling.";
  }
  if (text.includes("video") || text.includes("review") || text.includes("youtube") || text.includes("short")) {
    return "Scroll the Quest tab for long videos and Shorts. If an embed is blocked by an in-app browser, use the Open button to launch YouTube directly.";
  }
  if (text.includes("affiliate") || text.includes("official") || text.includes("fan")) {
    return "This is an unaffiliated CasterCycle fan page. Promo buttons may be affiliate links. Specs and availability can change, so verify important details with Kingbull before buying.";
  }
  return "Ask about range, speed, motor, battery, brakes, payload, laws, videos, or deals. I will keep it practical and remind you what to verify before buying or riding.";
}

const DAILY_MISSIONS: DailyMission[] = [
  { kind: "combo", title: "Flow Thread", goal: "Reach a 10x combo", target: 10, reward: 700 },
  { kind: "clean", title: "Clean Line", goal: "Finish with 1 hit or less", target: 1, reward: 750 },
  { kind: "boosts", title: "Ramp Chain", goal: "Hit 6 boost gates", target: 6, reward: 650 },
  { kind: "battery", title: "Range Saver", goal: "Finish above 62% battery", target: 62, reward: 725 },
  { kind: "bolts", title: "Charge Hunt", goal: "Collect 16 bolts", target: 16, reward: 625 },
];

const DAILY_PARK_EVENTS = [
  { title: "Pump Track Jam", spot: "Pump Track", terrain: "Pump", bonus: 720, color: "#ff8b4a", detail: "Find Pump Track for bonus score." },
  { title: "Boardwalk Sprint", spot: "Boardwalk", terrain: "Boardwalk", bonus: 620, color: "#c59a5d", detail: "Ride boards for smoother points." },
  { title: "Garden Hunt", spot: "Garden Loop", terrain: "Grass", bonus: 680, color: "#ff9ec7", detail: "Discover Garden Loop today." },
  { title: "Lookout Climb", spot: "Lookout", terrain: "Path", bonus: 760, color: "#a2ff9a", detail: "Reach Lookout before time runs." },
  { title: "Stream Skills", spot: "Stream Trail", terrain: "Stream", bonus: 840, color: "#5fcbea", detail: "Thread the stream edge cleanly." },
] as const;

const PREMIUM_PASSPORT_MISSIONS = {
  bikeLand: [
    { title: "Charge Plaza Stamp", goal: "Find Charge Plaza", reward: 900 },
    { title: "Jump Yard Chain", goal: "Clear 3 jump lines", reward: 1040 },
    { title: "Neon Tunnel Run", goal: "Hold tunnel flow", reward: 960 },
  ],
  skyline: [
    { title: "Beacon Stamp", goal: "Reach Beacon Tower", reward: 1120 },
    { title: "Metro Drop Thread", goal: "Ride Metro Drop", reward: 1180 },
    { title: "Glass Bridge Line", goal: "Cross Glass Bridge", reward: 1100 },
  ],
} as const;

type FreeRideSpot = {
  name: string;
  short: string;
  x: number;
  y: number;
  color: string;
  areas?: readonly RideArea[];
};

const FREE_RIDE_SPOTS: readonly FreeRideSpot[] = [
  { name: "Skate Bowl", short: "Skate", x: -720, y: -520, color: "#c9d4d7" },
  { name: "Courts", short: "Courts", x: 620, y: -500, color: "#d46a43" },
  { name: "Tennis Row", short: "Tennis", x: 285, y: -540, color: "#3da06f" },
  { name: "Soccer Fields", short: "Soccer", x: 760, y: 360, color: "#4a9b44" },
  { name: "Stream Trail", short: "Stream", x: -520, y: 420, color: "#5fcbea" },
  { name: "Bike Cafe", short: "Cafe", x: -1080, y: -120, color: "#f6b65b", areas: ["park"] },
  { name: "Dog Park", short: "Dog Run", x: 1040, y: -80, color: "#9ff28a", areas: ["park"] },
  { name: "Amphitheater", short: "Stage", x: -920, y: 760, color: "#c4b5fd", areas: ["park"] },
  { name: "Food Trucks", short: "Trucks", x: 420, y: 1120, color: "#ffcc66", areas: ["park"] },
  { name: "River Market", short: "Market", x: -1660, y: 1460, color: "#f6b65b", areas: ["park"] },
  { name: "Sunset Hill", short: "Sunset", x: 1680, y: 1480, color: "#ff9b6a", areas: ["park", "statePark"] },
  { name: "Pine Loop", short: "Pines", x: 80, y: -980, color: "#2e714d" },
  { name: "North Meadow", short: "Meadow", x: -1180, y: -1320, color: "#b7ef66" },
  { name: "Boardwalk", short: "Boards", x: -1280, y: 1040, color: "#c59a5d" },
  { name: "Pump Track", short: "Pump", x: 1280, y: 880, color: "#ff8b4a" },
  { name: "Lookout", short: "Lookout", x: 1150, y: -1360, color: "#a2ff9a" },
  { name: "Garden Loop", short: "Garden", x: -250, y: 1360, color: "#ff9ec7" },
  { name: "Ranger Station", short: "Ranger", x: -1440, y: -540, color: "#d7b171", areas: ["statePark"] },
  { name: "Cedar Bridge", short: "Bridge", x: 360, y: 250, color: "#c59a5d", areas: ["statePark"] },
  { name: "Lake Pier", short: "Pier", x: 1380, y: 20, color: "#7cf2ff", areas: ["statePark"] },
  { name: "Ridge Camp", short: "Camp", x: 780, y: -1220, color: "#fbe764", areas: ["statePark"] },
  { name: "Fern Falls", short: "Falls", x: -1720, y: 260, color: "#7cf2ff", areas: ["statePark"] },
  { name: "Switchback", short: "Switch", x: 1640, y: -1640, color: "#a2ff9a", areas: ["statePark"] },
  { name: "E-Bike Land", short: "Glow", x: 1010, y: -890, color: "#ff7adf", areas: ["bikeLand"] },
  { name: "Neon Tunnel", short: "Tunnel", x: -960, y: -760, color: "#7cf2ff", areas: ["bikeLand"] },
  { name: "Jump Yard", short: "Jumps", x: 1260, y: 1180, color: "#ff8b4a", areas: ["bikeLand"] },
  { name: "Charge Plaza", short: "Charge", x: -1180, y: 1180, color: "#fbe764", areas: ["bikeLand"] },
  { name: "Club Garage", short: "Garage", x: 1460, y: -320, color: "#c4b5fd", areas: ["bikeLand"] },
  { name: "Volt Bowl", short: "Volt", x: -1680, y: -1520, color: "#35f6c8", areas: ["bikeLand"] },
  { name: "Laser Pier", short: "Laser", x: 1720, y: 430, color: "#ff7adf", areas: ["bikeLand"] },
  { name: "Skyline Ramp", short: "Skyline", x: 220, y: 1660, color: "#fbe764", areas: ["bikeLand"] },
  { name: "Skyline Circuit", short: "Circuit", x: -1180, y: -980, color: "#7cf2ff", areas: ["skyline"] },
  { name: "Rooftop Loop", short: "Rooftop", x: 740, y: -1180, color: "#fbe764", areas: ["skyline"] },
  { name: "Glass Bridge", short: "Glass", x: 1320, y: 240, color: "#a2ff9a", areas: ["skyline"] },
  { name: "Metro Drop", short: "Metro", x: -1340, y: 520, color: "#ff8b4a", areas: ["skyline"] },
  { name: "Drone Park", short: "Drone", x: 420, y: 1540, color: "#c4b5fd", areas: ["skyline"] },
  { name: "Beacon Tower", short: "Beacon", x: 1680, y: -760, color: "#ff7adf", areas: ["skyline"] },
  { name: "Sky Garden", short: "Garden", x: -180, y: 880, color: "#35f6c8", areas: ["skyline"] },
  { name: "Trailhead", short: "Start", x: 0, y: 0, color: "#fbe764" },
] as const;

const FREE_RIDE_PATHS = [
  [[-1500, -1240], [-1040, -760], [-600, -520], [-180, -360], [260, -80], [880, 120], [1350, 780]],
  [[-1460, 1040], [-980, 120], [-500, 10], [-60, 40], [480, -160], [1060, -580], [1320, -1320]],
  [[-1160, 1320], [-880, 820], [-340, 520], [140, 520], [760, 760], [1320, 980]],
  [[0, -1560], [0, -1180], [0, -620], [0, -60], [0, 700], [0, 1120], [-250, 1480]],
  [[-1540, -220], [-940, -180], [-420, -720], [120, -980], [680, -900], [1180, -1340]],
  [[-1320, 1060], [-760, 840], [-260, 1200], [360, 1160], [1040, 620], [1510, 220]],
  [[-1820, 1480], [-1280, 1040], [-640, 980], [120, 1320], [880, 1540], [1740, 1460]],
  [[-1760, 260], [-1180, -120], [-820, -680], [-420, -1280], [220, -1660], [900, -1540], [1680, -1640]],
  [[-1680, -1520], [-960, -760], [-120, -560], [620, -240], [1460, -320], [1720, 430], [1260, 1180], [220, 1660]],
  [[-1180, -980], [-420, -1240], [740, -1180], [1680, -760], [1320, 240], [420, 1540], [-180, 880], [-1340, 520]],
  [[-1660, -180], [-1120, -520], [-620, -140], [120, 260], [820, 120], [1460, 620], [1720, 1160]],
] as const;

const STREAM_PATH = [
  [-1660, 980],
  [-1260, 520],
  [-760, 270],
  [-560, 650],
  [-160, 390],
  [260, 116],
  [530, 340],
  [1180, 120],
  [1580, -320],
] as const;

const FREE_RIDE_WORLD_LIMIT = 2100;

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

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "dark" || value === "light" || value === "custom";
}

function readSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveThemeMode(mode: ThemeMode, systemTheme: "dark" | "light") {
  if (mode === "custom") return "custom";
  return mode === "system" ? systemTheme : mode;
}

function appThemeVars(theme: ReturnType<typeof resolveThemeMode>): CSSProperties {
  if (theme === "light") {
    return {
      "--cc-shell-bg": "#eaf5f1",
      "--cc-panel-bg": "rgba(248, 252, 250, 0.9)",
      "--cc-panel-border": "rgba(7, 16, 24, 0.14)",
      "--cc-panel-text": "#071018",
      "--cc-panel-muted": "rgba(7, 16, 24, 0.58)",
      "--cc-nav-surface": "rgba(248, 252, 250, 0.92)",
      "--cc-nav-border": "rgba(7, 16, 24, 0.16)",
      "--cc-nav-shadow": "0 -18px 52px rgba(23, 55, 68, 0.2)",
      "--cc-nav-selected-bg": "#071018",
      "--cc-nav-selected-text": "#ffffff",
      "--cc-nav-text": "rgba(7, 16, 24, 0.62)",
      "--cc-nav-icon": "rgba(7, 16, 24, 0.58)",
      "--cc-popover-bg": "rgba(245, 252, 249, 0.96)",
      "--cc-popover-text": "#071018",
      "--cc-popover-muted": "rgba(7, 16, 24, 0.54)",
    } as CSSProperties;
  }

  if (theme === "custom") {
    return {
      "--cc-shell-bg": "#110f24",
      "--cc-panel-bg": "rgba(17, 15, 36, 0.9)",
      "--cc-panel-border": "rgba(255, 122, 223, 0.26)",
      "--cc-panel-text": "#ffffff",
      "--cc-panel-muted": "rgba(255, 255, 255, 0.62)",
      "--cc-nav-surface": "rgba(19, 16, 40, 0.9)",
      "--cc-nav-border": "rgba(255, 122, 223, 0.36)",
      "--cc-nav-shadow": "0 -18px 58px rgba(255, 122, 223, 0.12)",
      "--cc-nav-selected-bg": "linear-gradient(135deg, rgba(255,122,223,0.95), rgba(124,242,255,0.88))",
      "--cc-nav-selected-text": "#071018",
      "--cc-nav-text": "rgba(255, 255, 255, 0.62)",
      "--cc-nav-icon": "rgba(255, 255, 255, 0.56)",
      "--cc-popover-bg": "rgba(17, 15, 36, 0.96)",
      "--cc-popover-text": "#ffffff",
      "--cc-popover-muted": "rgba(255, 255, 255, 0.58)",
    } as CSSProperties;
  }

  return {
    "--cc-shell-bg": "#101b26",
    "--cc-panel-bg": "rgba(7, 16, 24, 0.9)",
    "--cc-panel-border": "rgba(255, 255, 255, 0.12)",
    "--cc-panel-text": "#ffffff",
    "--cc-panel-muted": "rgba(255, 255, 255, 0.62)",
    "--cc-nav-surface": "rgba(7, 16, 24, 0.84)",
    "--cc-nav-border": "rgba(255, 255, 255, 0.16)",
    "--cc-nav-shadow": "0 -18px 52px rgba(0, 0, 0, 0.36)",
    "--cc-nav-selected-bg": "rgba(248, 251, 255, 0.92)",
    "--cc-nav-selected-text": "#071018",
    "--cc-nav-text": "rgba(255, 255, 255, 0.58)",
    "--cc-nav-icon": "rgba(255, 255, 255, 0.54)",
    "--cc-popover-bg": "rgba(7, 16, 24, 0.96)",
    "--cc-popover-text": "#ffffff",
    "--cc-popover-muted": "rgba(255, 255, 255, 0.56)",
  } as CSSProperties;
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function buildEntities(seed: number, area: RideArea) {
  const random = mulberry32(seed + (area === "statePark" ? 991 : area === "bikeLand" ? 1777 : area === "skyline" ? 2441 : 0));
  const entities: Entity[] = [];
  let at = 360;
  let id = 1;

  while (at < COURSE_LENGTH - 220) {
    const lateCourse = at > COURSE_LENGTH * 0.56;
    at += area === "skyline"
      ? (lateCourse ? 86 : 102) + random() * 78
      : area === "bikeLand"
      ? (lateCourse ? 92 : 108) + random() * 86
      : area === "statePark"
        ? (lateCourse ? 116 : 132) + random() * 104
        : (lateCourse ? 102 : 118) + random() * 108;
    const lane = ([-1, 0, 1] as Lane[])[Math.floor(random() * 3)];
    const roll = random();

    if (roll < (area === "park" ? 0.34 : 0.28)) {
      entities.push({ id: id++, kind: "bolt", lane, at });
      if (random() > 0.62) entities.push({ id: id++, kind: "bolt", lane, at: at + 72 });
    } else if (roll < (area === "statePark" ? 0.4 : 0.43)) {
      entities.push({ id: id++, kind: random() > 0.64 ? "battery" : "ring", lane, at });
    } else if (lateCourse && roll < 0.5) {
      entities.push({ id: id++, kind: random() > 0.55 ? "gate" : "ramp", lane, at });
    } else if (roll < 0.56) {
      entities.push({ id: id++, kind: "cone", lane, at });
    } else if (roll < (area === "statePark" ? 0.72 : 0.66)) {
      entities.push({ id: id++, kind: "pothole", lane, at });
    } else if (roll < 0.78) {
      entities.push({ id: id++, kind: "barrier", lane, at });
    } else if (roll < (area === "skyline" ? 0.95 : area === "bikeLand" ? 0.93 : 0.9)) {
      entities.push({ id: id++, kind: "ramp", lane, at });
    } else {
      entities.push({ id: id++, kind: "gate", lane, at });
    }

    if (Math.floor(at) % 1450 < 150) {
      const patternLane = ([-1, 0, 1] as Lane[])[Math.floor(random() * 3)];
      const sideLane = (patternLane === 0 ? (random() > 0.5 ? -1 : 1) : 0) as Lane;
      entities.push({ id: id++, kind: area === "statePark" ? "battery" : "ring", lane: patternLane, at: at + 58 });
      entities.push({ id: id++, kind: area === "bikeLand" || area === "skyline" ? "gate" : "bolt", lane: sideLane, at: at + 128 });
      if (area !== "statePark") entities.push({ id: id++, kind: "ramp", lane: patternLane, at: at + 210 });
    }
  }

  return entities;
}

function dailyMission(seed: number) {
  return DAILY_MISSIONS[Math.floor((seed / ROUTES.length) % DAILY_MISSIONS.length)];
}

function dailyParkEvent(key = localDateKey()) {
  const seed = dateSeed(key);
  return DAILY_PARK_EVENTS[seed % DAILY_PARK_EVENTS.length];
}

function dailyPaidMissions(key = localDateKey()) {
  const seed = dateSeed(key);
  const bikeLand = PREMIUM_PASSPORT_MISSIONS.bikeLand[seed % PREMIUM_PASSPORT_MISSIONS.bikeLand.length];
  const skyline = PREMIUM_PASSPORT_MISSIONS.skyline[Math.floor(seed / 5) % PREMIUM_PASSPORT_MISSIONS.skyline.length];
  return [
    { ...bikeLand, area: "bikeLand" as RideArea, world: "E-Bike Land", accent: "#ff7adf" },
    { ...skyline, area: "skyline" as RideArea, world: "Skyline", accent: "#7cf2ff" },
  ];
}

function routeForArea(area: RideArea) {
  return ROUTES.find((route) => route.area === area) ?? ROUTES[0];
}

function isPremiumArea(area: RideArea) {
  return area === "bikeLand" || area === "skyline";
}

function raceChapter(game: GameModel) {
  const progress = clamp(game.distance / COURSE_LENGTH, 0, 1);
  const index = Math.min(3, Math.floor(progress * 4));
  const common = [
    { name: "Trailhead", skyTop: game.route.skyTop, skyBottom: game.route.skyBottom, groundTop: "rgba(139,203,82,0.36)", groundMid: "rgba(73,151,78,0.66)", groundBottom: "rgba(24,65,50,0.92)" },
    { name: "Court Row", skyTop: "#63b7e8", skyBottom: "#b4dd72", groundTop: "rgba(106,190,91,0.4)", groundMid: "rgba(68,143,82,0.7)", groundBottom: "rgba(24,71,56,0.94)" },
    { name: "Stream Sprint", skyTop: "#4c9fd3", skyBottom: "#8bd8b2", groundTop: "rgba(95,202,234,0.28)", groundMid: "rgba(54,142,108,0.72)", groundBottom: "rgba(20,68,62,0.96)" },
    { name: "Festival Finish", skyTop: "#355d9d", skyBottom: "#ffba67", groundTop: "rgba(251,231,100,0.24)", groundMid: "rgba(62,120,98,0.74)", groundBottom: "rgba(18,52,61,0.98)" },
  ];
  const state = [
    { name: "Pine Rise", skyTop: "#5f95be", skyBottom: "#98d99f", groundTop: "rgba(92,156,84,0.36)", groundMid: "rgba(50,112,74,0.72)", groundBottom: "rgba(24,65,50,0.92)" },
    { name: "Bridge Run", skyTop: "#4e89ad", skyBottom: "#c5e6a2", groundTop: "rgba(124,242,255,0.22)", groundMid: "rgba(54,118,82,0.75)", groundBottom: "rgba(25,72,55,0.96)" },
    { name: "Ridge Descent", skyTop: "#315f8d", skyBottom: "#e3d27b", groundTop: "rgba(151,187,87,0.34)", groundMid: "rgba(63,105,67,0.74)", groundBottom: "rgba(31,59,45,0.98)" },
    { name: "Lake Finish", skyTop: "#253f7a", skyBottom: "#f3b36b", groundTop: "rgba(124,242,255,0.24)", groundMid: "rgba(43,102,84,0.72)", groundBottom: "rgba(18,50,60,0.98)" },
  ];
  const glow = [
    { name: "Glow Grid", skyTop: "#372064", skyBottom: "#35c6b7", groundTop: "rgba(67,54,130,0.38)", groundMid: "rgba(38,120,122,0.72)", groundBottom: "rgba(28,35,75,0.92)" },
    { name: "Pump Alley", skyTop: "#28266d", skyBottom: "#44d6a7", groundTop: "rgba(255,122,223,0.22)", groundMid: "rgba(45,118,132,0.76)", groundBottom: "rgba(26,31,75,0.96)" },
    { name: "Volt Tunnel", skyTop: "#151a50", skyBottom: "#7cf2ff", groundTop: "rgba(124,242,255,0.18)", groundMid: "rgba(52,92,140,0.72)", groundBottom: "rgba(18,23,64,0.98)" },
    { name: "Club Sprint", skyTop: "#21154c", skyBottom: "#ff7adf", groundTop: "rgba(251,231,100,0.18)", groundMid: "rgba(88,64,139,0.78)", groundBottom: "rgba(22,18,58,0.98)" },
  ];
  const skyline = [
    { name: "Roof Start", skyTop: "#15183f", skyBottom: "#647cff", groundTop: "rgba(124,242,255,0.18)", groundMid: "rgba(36,47,93,0.78)", groundBottom: "rgba(16,22,51,0.96)" },
    { name: "Glass Bridge", skyTop: "#101642", skyBottom: "#7cf2ff", groundTop: "rgba(162,255,154,0.16)", groundMid: "rgba(41,64,118,0.78)", groundBottom: "rgba(13,18,46,0.98)" },
    { name: "Metro Drop", skyTop: "#181246", skyBottom: "#ff8b4a", groundTop: "rgba(255,139,74,0.18)", groundMid: "rgba(51,45,96,0.8)", groundBottom: "rgba(16,14,42,0.98)" },
    { name: "Beacon Finish", skyTop: "#1c144d", skyBottom: "#ff7adf", groundTop: "rgba(251,231,100,0.16)", groundMid: "rgba(67,56,120,0.82)", groundBottom: "rgba(13,16,46,0.98)" },
  ];
  const chapters = game.route.area === "skyline" ? skyline : game.route.area === "bikeLand" ? glow : game.route.area === "statePark" ? state : common;
  return { ...chapters[index], index, progress, localProgress: progress * 4 - index };
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
    chapterNotified: 0,
    comboVoiceNotified: false,
    nearMissVoiceNotified: false,
    hitVoiceNotified: false,
    finalStretchNotified: false,
    entities: buildEntities(seed, area),
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

function freeRideSpots(area: RideArea) {
  if (isPremiumArea(area)) {
    return FREE_RIDE_SPOTS.filter((spot) => spot.name === "Trailhead" || spot.areas?.includes(area));
  }
  return FREE_RIDE_SPOTS.filter((spot) => !spot.areas || spot.areas.includes(area));
}

function freeRideZoneForArea(x: number, y: number, area: RideArea) {
  const spots = freeRideSpots(area);
  let best = spots[0] ?? FREE_RIDE_SPOTS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of spots) {
    const distance = Math.hypot(x - spot.x, y - spot.y);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best.name;
}

function nextFreeRideSpot(free: FreeRideModel) {
  if (free.targetSpot && !free.visitedZones.includes(free.targetSpot)) {
    const target = freeRideSpots(free.area).find((spot) => spot.name === free.targetSpot);
    if (target) return { ...target, distance: Math.hypot(free.x - target.x, free.y - target.y) };
  }
  const available = freeRideSpots(free.area);
  const candidates = available.filter((spot) => spot.name !== "Trailhead" && !free.visitedZones.includes(spot.name));
  const pool = candidates.length > 0 ? candidates : available.filter((spot) => spot.name !== "Trailhead");
  return pool
    .map((spot) => ({ ...spot, distance: Math.hypot(free.x - spot.x, free.y - spot.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function skinRideStats(skin: Skin) {
  if (skin.id === "carbon") return { label: "Fast", speed: 1.1, boost: 1.1, grass: 1, turn: 1.04 };
  if (skin.id === "forest") return { label: "Trail", speed: 1.02, boost: 1, grass: 0.74, turn: 1.08 };
  if (skin.id === "neon") return { label: "Boost", speed: 1.06, boost: 1.18, grass: 1.06, turn: 1 };
  if (skin.id === "mint") return { label: "Agile", speed: 1.02, boost: 1.04, grass: 0.94, turn: 1.16 };
  if (skin.id === "sunset") return { label: "Sprint", speed: 1.07, boost: 1.08, grass: 1.02, turn: 0.98 };
  if (skin.id === "spark") return { label: "Base", speed: 1.04, boost: 1.12, grass: 1, turn: 1.02 };
  return { label: "Balanced", speed: 1, boost: 1, grass: 1, turn: 1 };
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPath(x: number, y: number, path: readonly (readonly [number, number])[]) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const [ax, ay] = path[index - 1];
    const [bx, by] = path[index];
    best = Math.min(best, pointSegmentDistance(x, y, ax, ay, bx, by));
  }
  return best;
}

function freeRideTerrain(x: number, y: number, area: RideArea) {
  const streamDistance = distanceToPath(x, y, STREAM_PATH);
  const pathDistance = Math.min(...FREE_RIDE_PATHS.map((path) => distanceToPath(x, y, path)));
  const pumpDistance = Math.hypot(x - 1280, y - 880);
  const boardwalkDistance = Math.hypot(x + 1280, y - 1040);
  const lakeDistance = Math.hypot(x - 1380, y - 20);
  const bridgeDistance = Math.hypot(x - 360, y - 250);
  const tunnelDistance = Math.hypot(x + 960, y + 760);
  const chargeDistance = Math.hypot(x + 1180, y - 1180);
  const jumpDistance = Math.hypot(x - 1260, y - 1180);
  const voltDistance = Math.hypot(x + 1680, y + 1520);
  const skylineDistance = Math.hypot(x - 220, y - 1660);
  const rooftopDistance = Math.hypot(x - 740, y + 1180);
  const circuitDistance = Math.hypot(x + 1180, y + 980);
  const glassDistance = Math.hypot(x - 1320, y - 240);
  const metroDistance = Math.hypot(x + 1340, y - 520);
  const beaconDistance = Math.hypot(x - 1680, y + 760);
  const droneDistance = Math.hypot(x - 420, y - 1540);
  const fallsDistance = Math.hypot(x + 1720, y - 260);
  const switchbackDistance = Math.hypot(x - 1640, y + 1640);
  if (streamDistance < 54) return { label: "Stream", short: "water", drag: 54, score: 0.08, warning: true };
  if (area === "statePark" && fallsDistance < 210) return { label: "Falls Mist", short: "falls", drag: 18, score: 0.19, warning: false };
  if (area === "statePark" && switchbackDistance < 230) return { label: "Switchback", short: "turns", drag: 10, score: 0.22, warning: false };
  if (area === "statePark" && lakeDistance < 190) return { label: "Lake Edge", short: "lake", drag: 28, score: 0.12, warning: false };
  if (area === "statePark" && bridgeDistance < 175) return { label: "Bridge", short: "bridge", drag: 5, score: 0.2, warning: false };
  if (area === "bikeLand" && voltDistance < 250) return { label: "Volt Bowl", short: "volt", drag: -16, score: 0.28, warning: false };
  if (area === "bikeLand" && skylineDistance < 240) return { label: "Skyline", short: "ramp", drag: -15, score: 0.3, warning: false };
  if (area === "bikeLand" && tunnelDistance < 230) return { label: "Neon", short: "neon", drag: -10, score: 0.24, warning: false };
  if (area === "bikeLand" && chargeDistance < 210) return { label: "Charge", short: "charge", drag: -7, score: 0.22, warning: false };
  if (area === "bikeLand" && jumpDistance < 230) return { label: "Jumps", short: "jumps", drag: -12, score: 0.25, warning: false };
  if (area === "skyline" && circuitDistance < 260) return { label: "Circuit", short: "circuit", drag: -14, score: 0.28, warning: false };
  if (area === "skyline" && rooftopDistance < 250) return { label: "Rooftop", short: "roof", drag: -12, score: 0.27, warning: false };
  if (area === "skyline" && glassDistance < 230) return { label: "Glass", short: "glass", drag: -8, score: 0.28, warning: false };
  if (area === "skyline" && metroDistance < 240) return { label: "Metro", short: "metro", drag: -18, score: 0.3, warning: false };
  if (area === "skyline" && beaconDistance < 230) return { label: "Beacon", short: "beacon", drag: -10, score: 0.26, warning: false };
  if (area === "skyline" && droneDistance < 230) return { label: "Drone", short: "drone", drag: -14, score: 0.26, warning: false };
  if (pumpDistance < 170) return { label: "Pump", short: "pump", drag: -14, score: 0.22, warning: false };
  if (boardwalkDistance < 190) return { label: "Boardwalk", short: "boards", drag: 8, score: 0.18, warning: false };
  if (area === "statePark" && y < -680 && pathDistance < 92) return { label: "Downhill", short: "hill", drag: -10, score: 0.18, warning: false };
  if (pathDistance < 46) return { label: "Path", short: "path", drag: 12, score: 0.16, warning: false };
  return { label: "Grass", short: "grass", drag: 36, score: 0.09, warning: false };
}

function freeRideObjectives(free: FreeRideModel): ParkObjective[] {
  const premium = isPremiumArea(free.area);
  const zoneTarget = free.area === "skyline" ? 7 : free.area === "bikeLand" ? 8 : free.area === "statePark" ? 9 : 8;
  const distanceTarget = free.area === "skyline" ? 3000 : free.area === "bikeLand" ? 2800 : free.area === "statePark" ? 2300 : 1900;
  const comboTarget = premium ? 12 : free.area === "statePark" ? 9 : 8;
  const event = dailyParkEvent();
  const eventDone = free.visitedZones.includes(event.spot);
  const paidMission = free.area === "skyline"
    ? dateSeed(localDateKey()) % 2 === 0
      ? {
          id: "paid-beacon",
          label: "Paid",
          value: free.visitedZones.includes("Beacon Tower") ? "beacon" : "Beacon",
          progress: free.visitedZones.includes("Beacon Tower") ? 1 : 0,
          done: free.visitedZones.includes("Beacon Tower"),
        }
      : {
          id: "paid-metro",
          label: "Paid",
          value: free.visitedZones.includes("Metro Drop") ? "drop" : "Metro",
          progress: free.visitedZones.includes("Metro Drop") ? 1 : 0,
          done: free.visitedZones.includes("Metro Drop"),
        }
    : dateSeed(localDateKey()) % 2 === 0
    ? {
        id: "paid-charge",
        label: "Paid",
        value: free.visitedZones.includes("Charge Plaza") ? "charge" : "Charge",
        progress: free.visitedZones.includes("Charge Plaza") ? 1 : 0,
        done: free.visitedZones.includes("Charge Plaza"),
      }
    : {
        id: "paid-jumps",
        label: "Paid",
        value: `${Math.min(free.jumpLines, 3)}/3 jumps`,
        progress: clamp(free.jumpLines / 3, 0, 1),
        done: free.jumpLines >= 3,
      };
  return [
    {
      id: "zones",
      label: "Explore",
      value: `${Math.min(free.visitedZones.length, zoneTarget)}/${zoneTarget}`,
      progress: clamp(free.visitedZones.length / zoneTarget, 0, 1),
      done: free.visitedZones.length >= zoneTarget,
    },
    {
      id: "distance",
      label: "Cruise",
      value: `${Math.min(Math.round(free.distance), distanceTarget)}m`,
      progress: clamp(free.distance / distanceTarget, 0, 1),
      done: free.distance >= distanceTarget,
    },
    {
      id: "combo",
      label: "Flow",
      value: `${Math.min(free.combo, comboTarget)}x`,
      progress: clamp(free.combo / comboTarget, 0, 1),
      done: free.combo >= comboTarget,
    },
    {
      id: premium ? paidMission.id : "event",
      label: premium ? paidMission.label : "Daily",
      value: premium ? paidMission.value : eventDone ? "hit" : event.spot.split(" ")[0],
      progress: premium ? paidMission.progress : eventDone ? 1 : 0,
      done: premium ? paidMission.done : eventDone,
    },
  ];
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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameModel>(makeGame());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const lastHudRef = useRef(0);
  const coursePointerRef = useRef<{ x: number; y: number } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const motorAudioRef = useRef<MotorAudio | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const ghostPreviewRef = useRef(false);
  const walletAutoConnectRef = useRef(false);
  const keyboardActionsRef = useRef({
    boostOrHop: () => {},
    changeLane: (() => {}) as (direction: -1 | 1) => void,
    exitDashToMenu: () => {},
    freeRideActive: false,
    startRide: () => {},
    stopFreeRide: (() => {}) as (showShop?: boolean) => void,
  });
  const freeRideRef = useRef<FreeRideModel>({
    area: "park",
    x: 0,
    y: 0,
    heading: -Math.PI / 2,
    targetHeading: -Math.PI / 2,
    targetSpot: null,
    speed: 0,
    pedalPower: 0,
    distance: 0,
    remaining: FREE_ROAM_SECONDS,
    parkScore: 0,
    combo: 0,
    pickupCooldown: 0,
    lastBoostSpot: null,
    jumpLines: 0,
    lastJumpLineDistance: -999,
    terrainFlow: 0,
    lastFlowTerrain: "",
    voiceCooldown: 0,
    submitted: false,
    terrain: "Grass",
    message: "",
    messageT: 0,
    zone: "Trailhead",
    warned: false,
    visitedZones: ["Trailhead"],
  });
  const [hud, setHud] = useState<Hud>(() => emptyHud(gameRef.current));
  const [freeRideActive, setFreeRideActive] = useState(false);
  const [ghostPreviewActive, setGhostPreviewActive] = useState(false);
  const [freeRideHud, setFreeRideHud] = useState<FreeRideHud>({
    active: false,
    speed: 0,
    distance: 0,
    remaining: FREE_ROAM_SECONDS,
    score: 0,
    combo: 0,
    message: "",
    objectives: freeRideObjectives({
      area: "park",
      x: 0,
      y: 0,
      heading: -Math.PI / 2,
      targetHeading: -Math.PI / 2,
      targetSpot: null,
      speed: 0,
      pedalPower: 0,
      distance: 0,
      remaining: FREE_ROAM_SECONDS,
      parkScore: 0,
      combo: 0,
      pickupCooldown: 0,
      lastBoostSpot: null,
      jumpLines: 0,
      lastJumpLineDistance: -999,
      terrainFlow: 0,
      lastFlowTerrain: "",
      voiceCooldown: 0,
      submitted: false,
      terrain: "Grass",
      message: "",
      messageT: 0,
      zone: "Trailhead",
      warned: false,
      visitedZones: ["Trailhead"],
    }),
    terrain: "grass",
    unlimited: false,
    zone: "Trailhead",
  });
  const [stats, setStats] = useState<PersistedStats>({ bestToday: 0, bestAll: 0, streak: 0, lastRideDate: null });
  const [selectedSkin, setSelectedSkin] = useState("signal");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>("daily");
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>("dash");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("ride");
  const [rideArea, setRideArea] = useState<RideArea>("park");
  const [ethSupporter, setEthSupporter] = useState(false);
  const [dayUntil, setDayUntil] = useState(0);
  const [annualUntil, setAnnualUntil] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const [upgradeIntent, setUpgradeIntent] = useState(false);
  const [claimedBadge, setClaimedBadge] = useState(false);
  const [passReceipts, setPassReceipts] = useState<PassReceipt[]>([]);
  const [lastRecap, setLastRecap] = useState<RideRecap | null>(null);
  const [destinationSpot, setDestinationSpot] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">("dark");
  const [toast, setToast] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const game = gameRef.current;
  const skin = SKINS.find((item) => item.id === selectedSkin) ?? SKINS[0];
  const skinStats = skinRideStats(skin);
  const displayName = user?.username ? `@${user.username}` : isStandalone ? "browser rider" : "farcaster rider";
  const progress = clamp(hud.distance / COURSE_LENGTH, 0, 1);
  const mission = missionStatus(game);
  const rideChapter = raceChapter(game);
  const parkEvent = dailyParkEvent(game.dateKey);
  const dayActive = dayUntil > Math.floor(Date.now() / 1000);
  const annualActive = annualUntil > Math.floor(Date.now() / 1000);
  const effectivePro = dayActive || annualActive;
  const passUntil = Math.max(dayUntil, annualUntil);
  const passDisplayUntil = passUntil;
  const accessLabel = effectivePro ? formatPassExpiry(passUntil) : "30s free roam";
  const resolvedTheme = resolveThemeMode(themeMode, systemTheme);
  const appThemeStyle = appThemeVars(resolvedTheme);

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
      setClaimedBadge(localStorage.getItem(`${STORAGE_PREFIX}:badge:${dateKey}`) === "1");
      try {
        const receipts = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:passReceipts`) || "[]") as PassReceipt[];
        setPassReceipts(Array.isArray(receipts) ? receipts.slice(0, 5) : []);
      } catch {
        setPassReceipts([]);
      }
      const savedDayUntil = Math.max(
        Number(localStorage.getItem(`${STORAGE_PREFIX}:dayUntil`) || "0"),
        Number(localStorage.getItem(`${STORAGE_PREFIX}:weeklyUntil`) || "0"),
      );
      const savedAnnualUntil = Number(localStorage.getItem(`${STORAGE_PREFIX}:annualUntil`) || "0");
      const savedPassActive = Math.max(savedDayUntil, savedAnnualUntil) > Math.floor(Date.now() / 1000);
      setDayUntil(savedDayUntil);
      setAnnualUntil(savedAnnualUntil);
      setAudioEnabled(localStorage.getItem(`${STORAGE_PREFIX}:audio`) === "1");
      setVoiceEnabled(localStorage.getItem(`${STORAGE_PREFIX}:voice`) === "1");
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeMode(savedTheme)) setThemeMode(savedTheme);
      const savedArea = localStorage.getItem(`${STORAGE_PREFIX}:rideArea`);
      if (savedArea === "park" || savedArea === "statePark" || ((savedArea === "bikeLand" || savedArea === "skyline") && savedPassActive)) {
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
  const syncFreeRideHud = useCallback(() => {
    const free = freeRideRef.current;
    setFreeRideHud({
      active: freeRideActive,
      speed: free.speed,
      distance: free.distance,
      remaining: free.remaining,
      score: free.parkScore,
      combo: free.combo,
      message: free.messageT > 0 ? free.message : "",
      objectives: freeRideObjectives(free),
      terrain: freeRideTerrain(free.x, free.y, free.area).short,
      unlimited: effectivePro && !ghostPreviewRef.current,
      zone: free.zone,
    });
  }, [effectivePro, freeRideActive]);

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

  const loadLeaderboard = useCallback(async (
    scope: LeaderboardScope = leaderboardScope,
    period: LeaderboardPeriod = leaderboardPeriod,
    mode: LeaderboardMode = leaderboardMode,
  ) => {
    const current = gameRef.current;
    try {
      const url = `/api/scores?dateKey=${encodeURIComponent(current.dateKey)}&scope=${scope}&period=${period}&mode=${mode}&fid=${user?.fid ?? 0}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.rows)) setLeaderboard(data.rows);
    } catch {}
  }, [leaderboardMode, leaderboardPeriod, leaderboardScope, user?.fid]);

  const submitScore = useCallback(async (finishedGame: GameModel) => {
    if (finishedGame.submitted) return;
    finishedGame.submitted = true;
    const body = {
      dateKey: finishedGame.dateKey,
      routeName: finishedGame.route.name,
      mode: "dash" as const,
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
      setToast("Farcaster identity needed for live leaderboard");
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

  const submitFreestyleScore = useCallback(async (free: FreeRideModel) => {
    if (free.submitted || free.distance < 20) return;
    free.submitted = true;
    const dateKey = gameRef.current.dateKey;
    const body = {
      dateKey,
      routeName: "Freestyle Park",
      mode: "freestyle" as const,
      score: Math.round(free.parkScore),
      distance: Math.round(free.distance),
      battery: 100,
      pickups: Math.min(100, free.visitedZones.length),
      hits: free.terrain === "Stream" ? 1 : 0,
      boosts: Math.min(100, free.combo),
      nearMisses: 0,
      skin: selectedSkin,
      fid: user?.fid ?? 0,
      username: user?.username ?? "",
      displayName: user?.displayName ?? "",
      pfpUrl: user?.pfpUrl ?? "",
      address: address ?? "",
    };

    try {
      const bestKey = `${STORAGE_PREFIX}:freestyleBest:${dateKey}`;
      const best = Math.max(Number(localStorage.getItem(bestKey) || "0"), body.score);
      localStorage.setItem(bestKey, String(best));
    } catch {}

    if (!user?.fid) return;
    try {
      await sdk.quickAuth.fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setToast("Freestyle saved locally");
    } finally {
      loadLeaderboard(leaderboardScope, leaderboardPeriod, leaderboardMode);
    }
  }, [address, leaderboardMode, leaderboardPeriod, leaderboardScope, loadLeaderboard, selectedSkin, user]);

  const finishRide = useCallback((reason: "course" | "battery" = "course") => {
    const current = gameRef.current;
    if (current.phase !== "riding") return;
    current.phase = "finished";
    current.score = finalScore(current) - (reason === "battery" ? 300 : 0);
    setLastRecap({
      mode: "dash",
      title: reason === "battery" ? "Battery tapped" : "Daily Dash complete",
      score: current.score,
      distance: Math.round(current.distance),
      combo: current.bestCombo,
      routeName: current.route.name,
      eventLabel: missionStatus(current).done ? current.mission.title : raceChapter(current).name,
      eventBonus: missionStatus(current).done ? current.mission.reward : undefined,
    });
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
    setLastRecap(null);
    gameRef.current = makeGame(rideArea);
    loadStats(gameRef.current.dateKey);
    syncHud();
    haptic("selection");
  }, [loadStats, rideArea, syncHud]);

  const exitDashToMenu = useCallback(() => {
    if (gameRef.current.phase !== "riding") return;
    setLastRecap(null);
    gameRef.current = makeGame(rideArea);
    syncHud();
    stopMotor();
    setDashboardTab("ride");
    setToast("Back to Play");
    haptic("selection");
  }, [rideArea, stopMotor, syncHud]);

  const startRide = useCallback(() => {
    if (gameRef.current.phase === "finished") {
      resetRide();
      requestAnimationFrame(() => startRide());
      return;
    }
    if (gameRef.current.phase === "ready") {
      void primeAudio();
      setLastRecap(null);
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

  const stopFreeRide = useCallback((showShop = false) => {
    const free = freeRideRef.current;
    const wasPreview = ghostPreviewRef.current;
    const event = dailyParkEvent(gameRef.current.dateKey);
    const premiumObjective = freeRideObjectives(free)[3];
    if (!wasPreview && free.distance >= 20) {
      setLastRecap({
        mode: "freestyle",
        title: "Freeworld recap",
        score: Math.round(free.parkScore),
        distance: Math.round(free.distance),
        zones: free.visitedZones.length,
        combo: free.combo,
        routeName: routeForArea(free.area).name,
        eventLabel: isPremiumArea(free.area) ? `${premiumObjective.label}: ${premiumObjective.value}` : free.visitedZones.includes(event.spot) ? event.title : `Find ${event.spot}`,
        eventBonus: !isPremiumArea(free.area) && free.visitedZones.includes(event.spot) ? event.bonus : undefined,
      });
    }
    if (!wasPreview) submitFreestyleScore(freeRideRef.current);
    setFreeRideActive(false);
    ghostPreviewRef.current = false;
    setGhostPreviewActive(false);
    stopMotor();
    if (showShop) {
      setDashboardTab("shop");
      setUpgradeIntent(true);
      setToast(wasPreview ? "Preview ended" : "Keep riding with Cycle Pass");
      haptic("warning");
      playVoice("paywall");
    }
  }, [playVoice, stopMotor, submitFreestyleScore]);

  const startFreeRide = useCallback((options?: { area?: RideArea; preview?: boolean }) => {
    const free = freeRideRef.current;
    const selectedArea = options?.area ?? rideArea;
    const preview = options?.preview === true;
    setLastRecap(null);
    free.area = selectedArea;
    free.x = selectedArea === "skyline" ? -1180 : selectedArea === "bikeLand" ? 1010 : selectedArea === "statePark" ? 80 : 0;
    free.y = selectedArea === "skyline" ? -980 : selectedArea === "bikeLand" ? -890 : selectedArea === "statePark" ? -980 : 0;
    free.heading = -Math.PI / 2;
    free.targetHeading = free.heading;
    free.targetSpot = preview ? selectedArea === "skyline" ? "Beacon Tower" : "Charge Plaza" : destinationSpot;
    free.speed = selectedArea === "skyline" ? 168 : selectedArea === "bikeLand" ? 155 : selectedArea === "statePark" ? 145 : 132;
    free.pedalPower = 0.35;
    free.distance = 0;
    free.remaining = preview ? 10 : FREE_ROAM_SECONDS;
    free.parkScore = 0;
    free.combo = 0;
    free.pickupCooldown = 0;
    free.lastBoostSpot = null;
    free.jumpLines = 0;
    free.lastJumpLineDistance = -999;
    free.terrainFlow = 0;
    free.lastFlowTerrain = "";
    free.voiceCooldown = 0;
    free.submitted = false;
    free.terrain = selectedArea === "skyline" ? "Rooftop" : selectedArea === "bikeLand" ? "Neon" : selectedArea === "statePark" ? "Downhill" : "Grass";
    free.message = preview ? `10s ${routeForArea(selectedArea).name} preview` : "";
    free.messageT = preview ? 1.8 : 0;
    free.zone = selectedArea === "skyline" ? "Skyline Circuit" : selectedArea === "bikeLand" ? "E-Bike Land" : selectedArea === "statePark" ? "Pine Loop" : "Trailhead";
    free.warned = false;
    free.visitedZones = [free.zone];
    gameRef.current.phase = "ready";
    ghostPreviewRef.current = preview;
    setGhostPreviewActive(preview);
    setFreeRideActive(true);
    setUpgradeIntent(false);
    setShowIntro(false);
    setShowWelcomeBack(false);
    setDashboardTab("ride");
    setToast(preview ? `10 second ${routeForArea(selectedArea).name} preview` : selectedArea === "statePark" ? "State Park roam" : selectedArea === "skyline" ? "Skyline Circuit" : effectivePro ? "Unlimited freestyle" : "30 seconds free");
    haptic("success");
    playSfx("start");
    if (voiceEnabled) playVoice("ready", { route: preview ? `${routeForArea(selectedArea).name} preview` : routeForArea(selectedArea).name });
  }, [destinationSpot, effectivePro, playSfx, playVoice, rideArea, voiceEnabled]);

  const goHome = useCallback(() => {
    setProfileOpen(false);
    setShowIntro(false);
    setShowWelcomeBack(false);
    setUpgradeIntent(false);
    setDashboardTab("ride");
    if (freeRideActive) {
      stopFreeRide(false);
    } else if (gameRef.current.phase === "riding") {
      exitDashToMenu();
    } else if (gameRef.current.phase === "finished") {
      resetRide();
    }
    haptic("selection");
  }, [exitDashToMenu, freeRideActive, resetRide, stopFreeRide]);

  const changeLane = useCallback((direction: -1 | 1) => {
    if (freeRideActive) {
      const free = freeRideRef.current;
      free.targetHeading += direction * 0.34 * skinStats.turn;
      free.pedalPower = clamp(free.pedalPower + 0.08, 0, 1.25);
      syncFreeRideHud();
      haptic("light");
      playSfx("lane");
      return;
    }
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
  }, [freeRideActive, playSfx, skinStats.turn, startRide, syncFreeRideHud, syncHud]);

  const boostOrHop = useCallback(() => {
    if (freeRideActive) {
      const free = freeRideRef.current;
      free.pedalPower = clamp(free.pedalPower + 0.42 * skinStats.boost, 0, 1.45);
      free.speed = clamp(free.speed + 18 * skinStats.boost, 42, (effectivePro ? free.area === "skyline" ? 390 : free.area === "bikeLand" ? 370 : 335 : 305) * skinStats.speed);
      syncFreeRideHud();
      haptic("medium");
      playSfx("boost");
      return;
    }
    const current = gameRef.current;
    if (current.phase === "ready") {
      startRide();
      return;
    }
    if (current.phase !== "riding") return;
    if (current.airborne <= 0 && current.battery > 8) {
      current.airborne = 1;
      current.boost = Math.max(current.boost, 0.62);
      current.speed = clamp(current.speed + 34 * skinStats.boost, 90, 390 * skinStats.speed);
      current.battery = clamp(current.battery - 1.8, 0, 100);
      syncHud();
      haptic("medium");
      playSfx("boost");
    }
  }, [effectivePro, freeRideActive, playSfx, skinStats.boost, skinStats.speed, startRide, syncFreeRideHud, syncHud]);

  const steerFreeRideToPoint = useCallback((rect: DOMRect, x: number, y: number, impulse: number) => {
    const free = freeRideRef.current;
    const centerX = rect.width / 2;
    const centerY = rect.height * 0.56;
    const targetAngle = Math.atan2(y - centerY, x - centerX);
    const distance = Math.hypot(x - centerX, y - centerY);
    free.targetHeading = targetAngle;
    free.pedalPower = clamp(free.pedalPower + clamp(distance / 260, 0.08, 0.6) * impulse * 0.004, 0, 1.2);
    free.speed = clamp(free.speed + clamp(distance / 280, 0.08, 0.5) * impulse * 0.12, 42, (effectivePro ? free.area === "skyline" ? 380 : free.area === "bikeLand" ? 360 : 330 : 300) * skinStats.speed);
    syncFreeRideHud();
  }, [effectivePro, skinStats.speed, syncFreeRideHud]);

  const handleCoursePointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    coursePointerRef.current = { x: event.clientX, y: event.clientY };
    if (freeRideActive) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      steerFreeRideToPoint(rect, event.clientX - rect.left, event.clientY - rect.top, 8);
      haptic("selection");
    }
  }, [freeRideActive, steerFreeRideToPoint]);

  const handleCoursePointerMove = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (!freeRideActive || !coursePointerRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    steerFreeRideToPoint(rect, event.clientX - rect.left, event.clientY - rect.top, 2);
  }, [freeRideActive, steerFreeRideToPoint]);

  const handleCoursePointerUp = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const start = coursePointerRef.current;
    coursePointerRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = start ? event.clientX - start.x : 0;
    const dy = start ? event.clientY - start.y : 0;

    if (freeRideActive) {
      steerFreeRideToPoint(rect, x, y, Math.abs(dx) + Math.abs(dy) > 18 ? 14 : 7);
      haptic("selection");
      return;
    }

    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      changeLane(dx > 0 ? 1 : -1);
      return;
    }

    if (x < rect.width * 0.34) changeLane(-1);
    else if (x > rect.width * 0.66) changeLane(1);
    else boostOrHop();
  }, [boostOrHop, changeLane, freeRideActive, steerFreeRideToPoint]);

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
    const castText = `I'm riding ${current.route.name} in CasterCycle.\n\nFree park rides, daily scores, friend leaderboards, and simple Farcaster passes:\n${SHARE_URL}`;
    setSharing(true);
    try {
      await shareCast(castText, [`${APP_URL}/api/share-image?mode=invite&route=${encodeURIComponent(current.route.name)}&user=${encodeURIComponent(displayName)}`, SHARE_URL], "Invite copied");
    } finally {
      setSharing(false);
    }
  }, [displayName, shareCast]);

  const shareRide = useCallback(async () => {
    const current = gameRef.current;
    const mission = missionStatus(current);
    const missionText = mission.done ? `\nDaily mission cleared: ${current.mission.title}.` : "";
    const shareImageUrl = `${APP_URL}/api/share-image?mode=dash&score=${current.score}&route=${encodeURIComponent(current.route.name)}&user=${encodeURIComponent(displayName)}&skin=${encodeURIComponent(skin.name)}&date=${current.dateKey}&mission=${encodeURIComponent(mission.done ? `${current.mission.title} cleared` : current.mission.goal)}`;
    const castText = `I scored ${current.score.toLocaleString()} in CasterCycle's ${current.route.name}.${missionText}\n\n${current.pickups} charge bolts, ${current.boosts} boosts, ${Math.round(current.battery)}% battery left. Beat my park ride:\n${SHARE_URL}`;
    setSharing(true);
    try {
      await shareCast(castText, [shareImageUrl, SHARE_URL], "Ride copied");
    } finally {
      setSharing(false);
    }
  }, [displayName, shareCast, skin.name]);

  const shareRecap = useCallback(async (recap: RideRecap) => {
    const modeLabel = recap.mode === "freestyle" ? "Freeworld" : "Daily Dash";
    const castText = `I scored ${recap.score.toLocaleString()} in CasterCycle ${modeLabel}.\n\n${recap.eventLabel || "Ride the daily route"} and chase me:\n${SHARE_URL}`;
    const shareImageUrl = `${APP_URL}/api/share-image?mode=${recap.mode === "freestyle" ? "freestyle" : "dash"}&score=${encodeURIComponent(String(recap.score))}&route=${encodeURIComponent(recap.routeName)}&user=${encodeURIComponent(displayName)}&mission=${encodeURIComponent(recap.eventLabel || modeLabel)}`;
    setSharing(true);
    try {
      await shareCast(castText, [shareImageUrl, SHARE_URL], "Recap copied");
    } finally {
      setSharing(false);
    }
  }, [displayName, shareCast]);

  const claimDailyBadge = useCallback(() => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:badge:${gameRef.current.dateKey}`, "1");
    } catch {}
    setClaimedBadge(true);
    setToast("Daily badge claimed");
    haptic("success");
  }, []);

  const shareChallenge = useCallback(async (row: LeaderboardRow) => {
    const name = row.username ? `@${row.username}` : row.displayName || "this rider";
    const scoreValue = (leaderboardMode === "freestyle" ? row.score : row.dailyScore || row.score).toLocaleString();
    const modeLabel = leaderboardMode === "freestyle" ? "Freestyle Park" : "Daily Dash";
    const text = `I'm chasing ${name}'s ${scoreValue} in CasterCycle ${modeLabel}.\n\nRide with me:\n${SHARE_URL}`;
    await shareCast(text, [`${APP_URL}/api/share-image?mode=${leaderboardMode === "freestyle" ? "freestyle" : "dash"}&score=${encodeURIComponent(scoreValue)}&route=${encodeURIComponent(modeLabel)}&user=${encodeURIComponent(displayName)}&mission=${encodeURIComponent(`Chasing ${name}`)}`, SHARE_URL], "Challenge copied");
  }, [displayName, leaderboardMode, shareCast]);

  const connectWallet = useCallback(() => {
    const connector = connectors.find((item) => item.id.toLowerCase().includes("farcaster")) ?? connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);

  useEffect(() => {
    if (isStandalone || isConnected || connecting || walletAutoConnectRef.current || connectors.length === 0) return;
    walletAutoConnectRef.current = true;
    connectWallet();
  }, [connectWallet, connecting, connectors.length, isConnected, isStandalone]);

  const openExternal = useCallback(async (url: string) => {
    try {
      await sdk.actions.openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const unlockEthSupporter = useCallback(() => {
    setEthSupporter(true);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:ethSupporter`, "1");
      localStorage.setItem(`${STORAGE_PREFIX}:skin`, "spark");
    } catch {}
    setSelectedSkin("spark");
  }, []);

  const unlockPass = useCallback((plan: PassPlan) => {
    const key = plan === "day" ? "dayUntil" : "annualUntil";
    const seconds = plan === "day" ? DAY_SECONDS : LIFETIME_SECONDS;
    const until = Math.floor(Date.now() / 1000) + seconds;
    if (plan === "day") setDayUntil(until);
    else setAnnualUntil(until);
    const receipt: PassReceipt = {
      plan,
      txLabel: plan === "day" ? "$1 USDC day pass" : "$7 USDC lifetime",
      purchasedAt: Math.floor(Date.now() / 1000),
      validUntil: until,
    };
    const nextReceipts = [receipt, ...passReceipts].slice(0, 5);
    setPassReceipts(nextReceipts);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}:${key}`, String(until));
      localStorage.setItem(`${STORAGE_PREFIX}:skin`, "neon");
      localStorage.setItem(`${STORAGE_PREFIX}:rideArea`, "bikeLand");
      localStorage.setItem(`${STORAGE_PREFIX}:passReceipts`, JSON.stringify(nextReceipts));
    } catch {}
    setSelectedSkin("neon");
    const unlockedArea = "bikeLand";
    setRideArea(unlockedArea);
    gameRef.current = makeGame(unlockedArea);
    syncHud();
    setToast(plan === "day" ? "Glow Track unlocked for today" : "Glow Track lifetime unlocked");
    setUpgradeIntent(false);
    haptic("success");
  }, [passReceipts, syncHud]);

  const chooseRideArea = useCallback((area: RideArea) => {
    if (isPremiumArea(area) && !effectivePro) {
      startFreeRide({ area, preview: true });
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
  }, [effectivePro, startFreeRide, syncHud]);

  useEffect(() => {
    loadStats(gameRef.current.dateKey);
    loadLeaderboard("global", "daily");
  }, [loadLeaderboard, loadStats]);

  useEffect(() => {
    farcasterHapticsEnabled = hapticsEnabled;
  }, [hapticsEnabled]);

  useEffect(() => {
    setSystemTheme(readSystemTheme());
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncTheme = () => setSystemTheme(media.matches ? "light" : "dark");
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {}
  }, [themeMode]);

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
    keyboardActionsRef.current = {
      boostOrHop,
      changeLane,
      exitDashToMenu,
      freeRideActive,
      startRide,
      stopFreeRide,
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const actions = keyboardActionsRef.current;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        event.preventDefault();
        actions.changeLane(-1);
      }
      if (event.code === "ArrowRight" || event.code === "KeyD") {
        event.preventDefault();
        actions.changeLane(1);
      }
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        actions.boostOrHop();
      }
      if ((event.code === "Escape" || event.code === "KeyP") && actions.freeRideActive) {
        event.preventDefault();
        actions.stopFreeRide(false);
      } else if ((event.code === "Escape" || event.code === "KeyP") && gameRef.current.phase === "riding") {
        event.preventDefault();
        actions.exitDashToMenu();
      }
      if (event.code === "Enter" && gameRef.current.phase !== "riding") {
        event.preventDefault();
        actions.startRide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (miniAppAdded) setShowWelcomeBack(false);
  }, [miniAppAdded]);

  useEffect(() => {
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [dashboardTab]);

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

      if (freeRideActive) {
        const free = freeRideRef.current;
        const wasRemaining = free.remaining;
        const preview = ghostPreviewRef.current;
        if (free.messageT > 0) free.messageT = Math.max(0, free.messageT - dt);
        if (free.pickupCooldown > 0) free.pickupCooldown = Math.max(0, free.pickupCooldown - dt);
        const terrain = freeRideTerrain(free.x, free.y, free.area);
        free.pedalPower = Math.max(0, free.pedalPower - dt * (terrain.label === "Downhill" ? 0.28 : 0.62));
        const parkEvent = dailyParkEvent(current.dateKey);
        free.terrain = terrain.label;
        if (terrain.label === free.lastFlowTerrain) {
          free.terrainFlow += dt;
        } else {
          free.lastFlowTerrain = terrain.label;
          free.terrainFlow = 0;
        }
        const turnDelta = angleDelta(free.heading, free.targetHeading);
        free.heading += turnDelta * Math.min(1, dt * (8.8 + clamp(free.speed / 260, 0, 1.4)));
        const terrainDrag = terrain.label === "Grass" ? terrain.drag * skinStats.grass : terrain.drag;
        const terrainCruise =
          terrain.label === "Path" ? 112 :
          terrain.label === "Downhill" ? 176 :
          terrain.label === "Pump" ? 126 :
          terrain.label === "Boardwalk" ? 122 :
          terrain.label === "Bridge" ? 130 :
          terrain.label === "Volt Bowl" || terrain.label === "Skyline" ? 164 :
          terrain.label === "Neon" || terrain.label === "Charge" || terrain.label === "Jumps" ? 142 :
          terrain.label === "Rooftop" || terrain.label === "Glass" || terrain.label === "Beacon" || terrain.label === "Drone" ? 156 :
          terrain.label === "Circuit" ? 162 :
          terrain.label === "Metro" ? 178 :
          terrain.label === "Switchback" ? 138 :
          terrain.label === "Falls Mist" ? 124 :
          terrain.label === "Lake Edge" ? 72 :
          terrain.label === "Stream" ? 50 :
          78;
        const pedalDrive =
          terrain.label === "Path" ? 188 :
          terrain.label === "Downhill" ? 144 :
          terrain.label === "Pump" ? 220 :
          terrain.label === "Boardwalk" ? 196 :
          terrain.label === "Bridge" ? 198 :
          terrain.label === "Volt Bowl" || terrain.label === "Skyline" ? 260 :
          terrain.label === "Neon" || terrain.label === "Charge" || terrain.label === "Jumps" ? 230 :
          terrain.label === "Rooftop" || terrain.label === "Glass" || terrain.label === "Beacon" || terrain.label === "Drone" ? 248 :
          terrain.label === "Circuit" ? 258 :
          terrain.label === "Metro" ? 282 :
          terrain.label === "Switchback" ? 214 :
          terrain.label === "Falls Mist" ? 190 :
          terrain.label === "Lake Edge" ? 118 :
          terrain.label === "Stream" ? 76 :
          142;
        const turnDrag = Math.min(42, Math.abs(turnDelta) * 18);
        const freeSpeedCap = (effectivePro ? (free.area === "skyline" ? 390 : free.area === "bikeLand" ? 370 : 335) : 305) * skinStats.speed;
        free.speed = clamp(
          free.speed + ((terrainCruise + free.pedalPower * pedalDrive) * skinStats.speed - free.speed) * dt * 0.82 - dt * (terrainDrag + turnDrag),
          42,
          freeSpeedCap,
        );
        const move = free.speed * dt;
        const nextX = free.x + Math.cos(free.heading) * move;
        const nextY = free.y + Math.sin(free.heading) * move;
        const clampedX = clamp(nextX, -FREE_RIDE_WORLD_LIMIT, FREE_RIDE_WORLD_LIMIT);
        const clampedY = clamp(nextY, -FREE_RIDE_WORLD_LIMIT, FREE_RIDE_WORLD_LIMIT);
        if (clampedX !== nextX || clampedY !== nextY) {
          free.targetHeading = free.heading + Math.PI * 0.72;
          free.speed = Math.max(90, free.speed * 0.58);
          if (free.messageT <= 0.1) {
            free.message = "Park edge - turn back";
            free.messageT = 0.9;
            haptic("warning");
          }
        }
        free.x = clampedX;
        free.y = clampedY;
        free.distance += move;
        free.parkScore += move * terrain.score * (terrain.label === parkEvent.terrain ? 1.8 : 1);
        if (
          free.terrainFlow > (isPremiumArea(free.area) ? 1.75 : 2.25) &&
          ["Path", "Pump", "Boardwalk", "Bridge", "Downhill", "Falls Mist", "Switchback", "Neon", "Charge", "Jumps", "Volt Bowl", "Skyline", "Circuit", "Rooftop", "Glass", "Metro", "Beacon", "Drone"].includes(terrain.label)
        ) {
          free.terrainFlow = 0;
          free.combo += 1;
          const flowBonus = isPremiumArea(free.area) ? 220 + free.combo * 32 : 115 + free.combo * 18;
          free.parkScore += flowBonus;
          free.pedalPower = clamp(free.pedalPower + 0.16 * skinStats.boost, 0, 1.45);
          free.message = `${terrain.short} flow +${flowBonus}`;
          free.messageT = 0.95;
          haptic(isPremiumArea(free.area) ? "medium" : "light");
          if (free.combo % 4 === 0) playSfx("combo");
        }
        if (isPremiumArea(free.area) && (terrain.label === "Jumps" || terrain.label === "Metro" || terrain.label === "Rooftop") && free.distance - free.lastJumpLineDistance > 120) {
          free.lastJumpLineDistance = free.distance;
          free.jumpLines += 1;
          free.combo += 1;
          free.parkScore += 180 + free.jumpLines * 60;
          free.message = free.area === "skyline" ? `Sky line ${Math.min(free.jumpLines, 3)}/3` : `Jump line ${Math.min(free.jumpLines, 3)}/3`;
          free.messageT = 1.05;
          haptic("medium");
          playSfx("boost");
        }
        if (terrain.warning && free.messageT <= 0.1) {
          free.message = "Stream edge slows you";
          free.messageT = 0.7;
        }
        const nextZone = freeRideZoneForArea(free.x, free.y, free.area);
        if (nextZone !== free.zone) {
          free.zone = nextZone;
          if (!free.visitedZones.includes(nextZone)) {
            free.visitedZones.push(nextZone);
            free.combo += 1;
            const eventBonus = nextZone === parkEvent.spot ? parkEvent.bonus : 0;
            const discoveryBonus = free.visitedZones.length >= 10 ? 900 : free.visitedZones.length >= 7 ? 560 : free.visitedZones.length >= 4 ? 320 : 0;
            free.parkScore += 260 + free.visitedZones.length * 45 + discoveryBonus + eventBonus;
            free.pedalPower = clamp(free.pedalPower + 0.18 * skinStats.boost, 0, 1.45);
            free.speed = clamp(free.speed + 22 * skinStats.boost, 42, freeSpeedCap);
            free.message = eventBonus > 0 ? `${parkEvent.title} +${eventBonus}` : discoveryBonus > 0 ? `Discovery chain +${discoveryBonus}` : `New zone: ${nextZone}`;
            free.messageT = 1.6;
            haptic(eventBonus > 0 || discoveryBonus > 0 ? "success" : "light");
            playSfx(eventBonus > 0 ? "finish" : discoveryBonus > 0 ? "clear" : "combo");
            if (free.voiceCooldown <= 0 && free.visitedZones.length <= 3) {
              free.voiceCooldown = 6;
              playVoice("parkZone", { route: nextZone });
            }
          }
        }
        const boostSpot = freeRideSpots(free.area).find((spot) => spot.name !== "Trailhead" && Math.hypot(free.x - spot.x, free.y - spot.y) < 116);
        if (!boostSpot) free.lastBoostSpot = null;
        if (boostSpot && free.pickupCooldown <= 0 && free.lastBoostSpot !== boostSpot.name) {
          free.pickupCooldown = 1.15;
          free.lastBoostSpot = boostSpot.name;
          free.combo += 1;
          free.parkScore += 190 + free.combo * 28;
          free.pedalPower = clamp(free.pedalPower + 0.34 * skinStats.boost, 0, 1.45);
          free.speed = clamp(free.speed + 44 * skinStats.boost, 42, freeSpeedCap);
          if (boostSpot.name === "Charge Plaza" && !effectivePro && !preview) {
            free.remaining = Math.min(FREE_ROAM_SECONDS, free.remaining + 7);
          }
          free.message = boostSpot.name === "Charge Plaza" && !effectivePro && !preview ? `${boostSpot.short} +time` : `${boostSpot.short} boost +${190 + free.combo * 28}`;
          free.messageT = 1.25;
          haptic("medium");
          playSfx("boost");
          if (free.voiceCooldown <= 0 && free.combo >= 3) {
            free.voiceCooldown = 6;
            playVoice("parkBoost", { route: boostSpot.short });
          }
        }
        if (!effectivePro || preview) free.remaining = Math.max(0, free.remaining - dt);
        if (free.voiceCooldown > 0) free.voiceCooldown = Math.max(0, free.voiceCooldown - dt);
        if ((!effectivePro || preview) && !free.warned && free.remaining <= 5 && free.remaining > 0) {
          free.warned = true;
          setToast(preview ? "Preview ending" : "5 seconds left");
          haptic("warning");
          playSfx("warning");
        }
        updateMotor({
          ...current,
          phase: "riding",
          speed: free.speed,
          boost: clamp(free.speed / 430, 0, 1),
          combo: free.combo,
        });
        if ((!effectivePro || preview) && wasRemaining > 0 && free.remaining <= 0) {
          stopFreeRide(true);
          playSfx("finish");
        }
        drawFreeRideScene(ctx, width, height, free, skin, effectivePro && !preview, now);
      } else if (current.phase === "riding") {
        const targetOffset = current.targetLane;
        current.laneOffset += (targetOffset - current.laneOffset) * Math.min(1, dt * 10);
        if (Math.abs(current.targetLane - current.laneOffset) < 0.03) {
          current.lane = current.targetLane;
          current.laneOffset = current.targetLane;
        }

        if (current.airborne > 0) current.airborne = Math.max(0, current.airborne - dt * 2.65);
        if (current.boost > 0) current.boost = Math.max(0, current.boost - dt * 0.85);

        current.speed = clamp((330 + current.boost * 198 * skinStats.boost + current.distance * 0.008) * skinStats.speed, 320, 452 * skinStats.speed);
        current.distance += current.speed * dt;
        current.battery = clamp(current.battery - dt * (0.72 + current.boost * 1.18), 0, 100);
        updateMotor(current);
        const chapter = raceChapter(current);

        if (chapter.index > current.chapterNotified) {
          current.chapterNotified = chapter.index;
          current.score += 320 + chapter.index * 90 + current.combo * 18;
          current.boost = Math.max(current.boost, 0.34 + chapter.index * 0.08);
          rideSignal(current, chapter.name.toUpperCase(), current.route.roadEdge, 0.1);
          haptic("success");
          playSfx("clear");
        }

        if (!current.batteryNotified && current.battery <= 25) {
          current.batteryNotified = true;
          rideSignal(current, "LOW CHARGE", current.route.hazard, 0.18);
          haptic("warning");
          playSfx("warning");
          playVoice("lowBattery");
        }

        if (!current.checkpointNotified && current.distance >= COURSE_LENGTH * 0.5) {
          current.checkpointNotified = true;
          current.score += 620 + current.combo * 26;
          rideSignal(current, "MID RIDE BONUS", current.route.bolt, 0.08);
          haptic("success");
          playSfx("clear");
          playVoice("checkpoint");
        }

        if (!current.finalStretchNotified && current.distance >= COURSE_LENGTH * 0.78) {
          current.finalStretchNotified = true;
          current.score += 720 + current.combo * 30;
          current.boost = Math.max(current.boost, 0.64);
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
          } else if (entity.kind === "battery" && !entity.collected && laneMatch && rel < 36) {
            entity.collected = true;
            current.pickups += 1;
            current.combo += 1;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.battery = clamp(current.battery + 16, 0, 100);
            current.score += 260 + current.combo * 24;
            current.boost = Math.max(current.boost, 0.24);
            rideSignal(current, "FULL CELL", current.route.bolt, 0.05);
            haptic("success");
            playSfx("clear");
          } else if (entity.kind === "ring" && !entity.hit && laneMatch && rel < 40) {
            entity.hit = true;
            current.boosts += 1;
            current.combo += 2;
            current.bestCombo = Math.max(current.bestCombo, current.combo);
            current.boost = Math.max(current.boost, isPremiumArea(current.route.area) ? 0.95 : 0.68);
            current.score += 390 + current.combo * 32;
            rideSignal(current, current.route.area === "statePark" ? "TRAIL FLOW" : current.route.area === "skyline" ? "SKY FLOW" : "FLOW RING", current.route.roadEdge, 0.09);
            haptic("medium");
            playSfx("boost");
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
          } else if (entity.kind !== "bolt" && entity.kind !== "battery" && entity.kind !== "ring" && entity.kind !== "ramp" && entity.kind !== "gate" && !entity.hit && rel < 22) {
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
        drawScene(ctx, width, height, current, skin, now);
      } else {
        updateMotor(current);
        drawScene(ctx, width, height, current, skin, now);
      }

      if (now - lastHudRef.current > 90) {
        lastHudRef.current = now;
        syncHud();
        syncFreeRideHud();
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [effectivePro, finishRide, freeRideActive, playSfx, playVoice, skin, skinStats.boost, skinStats.grass, skinStats.speed, stopFreeRide, syncFreeRideHud, syncHud, updateMotor]);

  const showingIntroPanel = hud.phase === "ready" && showIntro;
  const showingWelcomePanel = hud.phase === "ready" && showWelcomeBack && !miniAppAdded;
  const showFooterNav = !freeRideActive && hud.phase !== "riding" && !showingIntroPanel && !showingWelcomePanel;

  return (
    <main
      ref={shellRef}
      className="cc-app-shell relative mx-auto h-dvh w-full max-w-[520px] overflow-hidden text-white"
      data-theme-mode={themeMode}
      data-theme-resolved={resolvedTheme}
      style={{ ...appThemeStyle, paddingTop: safeAreaInsets.top, paddingBottom: safeAreaInsets.bottom }}
    >
      <canvas
        ref={canvasRef}
        aria-label="CasterCycle forward-scrolling e-bike game"
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={handleCoursePointerDown}
        onPointerMove={handleCoursePointerMove}
        onPointerCancel={() => {
          coursePointerRef.current = null;
        }}
        onPointerUp={handleCoursePointerUp}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,17,27,0.08),transparent_24%,transparent_70%,rgba(7,17,27,0.48))]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 px-3 pt-3 cc-top-hud-wrap">
        <div className="cc-topbar rounded-md border border-white/12 bg-[#071018]/72 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            <button
              aria-label="Go to Play home"
              className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md pr-1 text-left transition active:scale-[0.98]"
              onClick={goHome}
            >
              <Image src="/media/castercycle.png" alt="" width={34} height={34} className="cc-brand-icon h-[34px] w-[34px] rounded-md border border-white/12 object-cover" />
              <div className="min-w-0">
                <div className="cc-brand-title flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#fbe764]">
                  CasterCycle
                  <Home size={12} className="text-white/38" />
                </div>
                <div className="cc-brand-subtitle truncate text-[10px] font-semibold text-white/70">
                  {freeRideActive ? freeRideHud.zone : game.route.name}
                </div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold">
              <span className="cc-hud-pill flex min-w-[58px] items-center justify-center gap-1 rounded-md border border-white/10 bg-white/8 px-2 py-1.5">
                <Trophy size={13} className="text-[#fbe764]" />
                {freeRideActive ? Math.round(freeRideHud.score).toLocaleString() : hud.score.toLocaleString()}
              </span>
              <span className="cc-hud-pill flex min-w-[48px] items-center justify-center gap-1 rounded-md border border-white/10 bg-white/8 px-2 py-1.5">
                <BatteryCharging size={13} className="text-[#a2ff9a]" />
                {freeRideActive ? (freeRideHud.unlimited ? "all" : `${Math.ceil(freeRideHud.remaining)}s`) : `${Math.round(hud.battery)}%`}
              </span>
              <button
                aria-label="Open rider profile settings"
                aria-expanded={profileOpen}
                className={`pointer-events-auto relative inline-flex h-9 w-9 items-center justify-center rounded-md border transition active:scale-[0.98] ${
                  profileOpen ? "border-[#7cf2ff]/70 bg-[#7cf2ff]/16" : "border-white/12 bg-white/8"
                }`}
                onClick={() => {
                  haptic("selection");
                  setProfileOpen((open) => !open);
                }}
              >
                <ProfileAvatar src={user?.pfpUrl} username={user?.username} displayName={user?.displayName} className="h-7 w-7 rounded" />
                <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${effectivePro ? "bg-[#fbe764] shadow-[0_0_10px_rgba(251,231,100,0.95)]" : "bg-white/24"}`} />
              </button>
            </div>
          </div>
        </div>
        {profileOpen && (
          <ProfileSettingsPopover
            user={user}
            displayName={displayName}
            score={freeRideActive ? Math.round(freeRideHud.score) : hud.score}
            bestAll={stats.bestAll}
            streak={stats.streak}
            accessLabel={accessLabel}
            proActive={effectivePro}
            dayActive={dayActive}
            annualActive={annualActive}
            audioEnabled={audioEnabled}
            voiceEnabled={voiceEnabled}
            hapticsEnabled={hapticsEnabled}
            address={address}
            selectedSkin={skin}
            receipts={passReceipts}
            themeMode={themeMode}
            resolvedTheme={resolvedTheme}
            onClose={() => setProfileOpen(false)}
            onThemeMode={(mode) => {
              setThemeMode(mode);
              haptic("selection");
            }}
            onToggleAudio={toggleAudio}
            onToggleVoice={toggleVoice}
            onToggleHaptics={() => {
              setToast(hapticsEnabled ? "Haptics ready" : "Haptics unavailable here");
              haptic("selection");
            }}
            onConnect={connectWallet}
            onGarage={() => {
              setProfileOpen(false);
              setDashboardTab("garage");
            }}
            onPassport={() => {
              setProfileOpen(false);
              setDashboardTab("shop");
            }}
            onHome={goHome}
          />
        )}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25 shadow-[0_8px_24px_rgba(0,0,0,0.24)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7cf2ff] via-[#fbe764] to-[#a2ff9a]"
            style={{ width: `${freeRideActive && !freeRideHud.unlimited ? Math.round((freeRideHud.remaining / (ghostPreviewActive ? 10 : FREE_ROAM_SECONDS)) * 100) : Math.round(progress * 100)}%` }}
          />
        </div>
        <StatusRibbon
          accent={ghostPreviewActive ? "#ff7adf" : freeRideActive ? parkEvent.color : game.route.roadEdge}
          label={ghostPreviewActive ? `${routeForArea(freeRideRef.current.area).name} Preview` : freeRideActive ? parkEvent.title : rideChapter.name}
          value={ghostPreviewActive ? "10 seconds, then pass prompt" : freeRideActive ? `${parkEvent.spot} +${parkEvent.bonus}` : `${Math.round(progress * 100)}% - ${mission.label}`}
        />
      </div>

      {freeRideActive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
          <ObjectiveStrip objectives={freeRideHud.objectives} />
          <div className="pointer-events-auto grid grid-cols-[1fr_1.35fr_1fr_0.8fr] gap-2">
            <button aria-label="Turn left" className="inline-flex min-h-14 items-center justify-center rounded-md border border-white/18 bg-black/36 px-1 text-white/88 shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md active:scale-[0.98]" onClick={() => changeLane(-1)}>
              <ChevronLeft size={30} />
            </button>
            <button aria-label="Pedal faster" className="inline-flex min-h-14 items-center justify-center gap-1 rounded-md border border-[#fbe764]/55 bg-[#fbe764]/20 px-2 text-[11px] font-black uppercase tracking-[0.04em] text-[#fbe764] shadow-[0_14px_34px_rgba(251,231,100,0.12)] backdrop-blur-md active:scale-[0.98]" onClick={boostOrHop}>
              <Zap size={20} />
              Pedal
            </button>
            <button aria-label="Turn right" className="inline-flex min-h-14 items-center justify-center rounded-md border border-white/18 bg-black/36 px-1 text-white/88 shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md active:scale-[0.98]" onClick={() => changeLane(1)}>
              <ChevronRight size={30} />
            </button>
            <button aria-label="Exit to park menu" className="inline-flex min-h-14 items-center justify-center rounded-md border border-[#ff5d73]/45 bg-[#ff5d73]/18 px-1 text-white shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-md active:scale-[0.98]" onClick={() => stopFreeRide(false)}>
              <Map size={19} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Metric icon={<Gauge size={14} />} label="mph" value={String(Math.round(freeRideHud.speed / 11))} />
            <Metric icon={<Trophy size={14} />} label="score" value={Math.round(freeRideHud.score).toLocaleString()} />
            <Metric icon={<Flame size={14} />} label="combo" value={`${freeRideHud.combo}x`} />
            <Metric icon={<Map size={14} />} label="surface" value={freeRideHud.terrain} />
          </div>
        </div>
      )}

      {!freeRideActive && hud.phase === "riding" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
          <div className="pointer-events-auto grid grid-cols-[1fr_1.25fr_1fr_0.8fr] gap-2">
            <button
              aria-label="Move left"
              aria-pressed={hud.targetLane === -1}
              className={`inline-flex min-h-14 select-none items-center justify-center rounded-md border shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md touch-manipulation active:scale-[0.98] ${
                hud.targetLane === -1 ? "border-[#7cf2ff]/65 bg-[#7cf2ff]/20 text-[#7cf2ff]" : "border-white/18 bg-black/36 text-white/88"
              }`}
              onClick={() => changeLane(-1)}
            >
              <ChevronLeft size={30} />
            </button>
            <button
              aria-label="Boost hop"
              className="inline-flex min-h-14 select-none items-center justify-center rounded-md border border-[#fbe764]/55 bg-[#fbe764]/20 text-[#fbe764] shadow-[0_14px_34px_rgba(251,231,100,0.12)] backdrop-blur-md touch-manipulation active:scale-[0.98]"
              onClick={boostOrHop}
            >
              <Zap size={24} />
            </button>
            <button
              aria-label="Move right"
              aria-pressed={hud.targetLane === 1}
              className={`inline-flex min-h-14 select-none items-center justify-center rounded-md border shadow-[0_14px_34px_rgba(0,0,0,0.24)] backdrop-blur-md touch-manipulation active:scale-[0.98] ${
                hud.targetLane === 1 ? "border-[#7cf2ff]/65 bg-[#7cf2ff]/20 text-[#7cf2ff]" : "border-white/18 bg-black/36 text-white/88"
              }`}
              onClick={() => changeLane(1)}
            >
              <ChevronRight size={30} />
            </button>
            <button
              aria-label="Exit to Play menu"
              className="inline-flex min-h-14 select-none items-center justify-center rounded-md border border-[#ff5d73]/45 bg-[#ff5d73]/18 px-1 text-white shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-md touch-manipulation active:scale-[0.98]"
              onClick={exitDashToMenu}
            >
              <Map size={19} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <Metric icon={<Gauge size={14} />} label="mph" value={String(Math.round(hud.speed / 8))} />
            <Metric icon={<Zap size={14} />} label="bolts" value={String(hud.pickups)} />
            <Metric icon={<Flame size={14} />} label="combo" value={`${hud.combo}x`} />
            <Metric icon={<Bike size={14} />} label="lane" value={hud.targetLane === -1 ? "left" : hud.targetLane === 1 ? "right" : "mid"} />
          </div>
        </div>
      )}

      {!freeRideActive && hud.phase !== "riding" && (
        <section className={`pointer-events-auto absolute inset-x-0 z-20 px-3 ${showFooterNav ? "bottom-[86px] pb-2" : "bottom-0 pb-3"}`}>
          <div ref={sheetRef} className={`cc-bottom-sheet no-scrollbar overflow-y-auto overscroll-contain rounded-md border border-white/12 bg-[#071018]/94 p-4 shadow-[0_-26px_80px_rgba(0,0,0,0.46)] backdrop-blur-2xl ${showFooterNav ? "cc-bottom-sheet-with-nav" : ""}`}>
            {showingIntroPanel ? (
              <OnboardingPanel
                step={introStep}
                routeName={game.route.name}
                miniAppAdded={miniAppAdded}
                onStep={setIntroStep}
                onAdd={addMiniApp}
                onSkip={() => closeIntro(false)}
                onStart={() => closeIntro(true)}
                onRoam={() => {
                  closeIntro(false);
                  requestAnimationFrame(() => startFreeRide());
                }}
              />
            ) : showingWelcomePanel ? (
              <WelcomeBackPanel
                displayName={displayName}
                routeName={game.route.name}
                onAdd={addMiniApp}
                onShare={shareApp}
                onStart={startRide}
                onRoam={startFreeRide}
              />
            ) : (
              <>
                <DashboardHeader
                  tab={dashboardTab}
                  routeName={game.route.name}
                  score={hud.score}
                  finished={hud.phase === "finished"}
                />

                {dashboardTab === "ride" && (
                  <>
                    <WorldHub
                      phase={hud.phase}
                      score={hud.score}
                      bestToday={Math.max(stats.bestToday, hud.score)}
                      bestAll={Math.max(stats.bestAll, hud.score)}
                      streak={stats.streak}
                      proActive={effectivePro}
                      accessLabel={accessLabel}
                      sharing={sharing}
                      onStart={startRide}
                      onFreeRide={startFreeRide}
                      onShop={() => setDashboardTab("shop")}
                      onShare={hud.phase === "finished" ? shareRide : shareApp}
                    />

                    <PremiumWorldTeaser
                      proActive={effectivePro}
                      onShop={() => setDashboardTab("shop")}
                      onPreview={() => startFreeRide({ area: effectivePro ? "skyline" : "bikeLand", preview: !effectivePro })}
                    />

                    {lastRecap && (
                      <RideRecapPanel
                        recap={lastRecap}
                        bestToday={Math.max(stats.bestToday, hud.score, lastRecap.score)}
                        onShare={() => shareRecap(lastRecap)}
                        onRideAgain={lastRecap.mode === "dash" ? startRide : startFreeRide}
                      />
                    )}

                    {hud.phase === "finished" && (
                      <DailyRewardPanel
                        claimed={claimedBadge}
                        onClaim={claimDailyBadge}
                        onShare={shareRide}
                        onShop={() => setDashboardTab("shop")}
                      />
                    )}

                    <MissionPanel mission={game.mission} status={mission} />

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <SignalChip icon={<Users size={13} />} label="rider" value={displayName} />
                      <SignalChip icon={<Radio size={13} />} label="daily" value={game.dateKey.slice(5)} />
                      <SignalChip icon={<Bike size={13} />} label={skinStats.label} value={skinShortName(skin.name)} />
                    </div>
                  </>
                )}

                {dashboardTab === "shop" && (
                  <>
                    <FarcasterWalletPanel
                      connected={isConnected || !isStandalone}
                      connecting={connecting}
                      address={address}
                      accessLabel={accessLabel}
                    />
                    <PremiumPassportPanel
                      proActive={effectivePro}
                      dateKey={game.dateKey}
                      selectedSkin={skin}
                      onGarage={() => {
                        haptic("selection");
                        setDashboardTab("garage");
                      }}
                      onRide={(area) => startFreeRide({ area, preview: !effectivePro })}
                    />
                    <UpgradePanel
                      isPro={effectivePro}
                      dayActive={dayActive}
                      annualActive={annualActive}
                      urgent={upgradeIntent}
                      onConnect={connectWallet}
                      onEthSupport={unlockEthSupporter}
                      onPassPurchased={unlockPass}
                      onVoiceInfo={() => playVoice("legal", {}, true)}
                    />
                    <PassHistoryPanel receipts={passReceipts} dayActive={dayActive} annualActive={annualActive} passUntil={passDisplayUntil} />
                    <LegalDisclosurePanel onOpenTerms={() => openExternal(TERMS_URL)} />
                  </>
                )}

                {dashboardTab === "garage" && (
                  <>
                    <AreaPicker selected={rideArea} proActive={effectivePro} lifetimeActive={annualActive} onSelect={chooseRideArea} />
                    <DestinationPicker area={rideArea} selected={destinationSpot} onSelect={setDestinationSpot} />
                    <SkinPicker skins={SKINS} selected={selectedSkin} isUnlocked={skinUnlocked} onSelect={setSelectedSkin} />
                  </>
                )}

                {dashboardTab === "club" && (
                  <LoungePanel proActive={effectivePro} user={user ?? undefined} />
                )}

                {dashboardTab === "quest" && (
                  <RangerFanQuest onOpen={openExternal} onShare={shareApp} />
                )}

                {dashboardTab === "leaders" && (
                  <Leaderboard
                    rows={leaderboard}
                    scope={leaderboardScope}
                    period={leaderboardPeriod}
                    mode={leaderboardMode}
                    onProfile={(fid) => sdk.actions.viewProfile({ fid }).catch(() => setToast("Profile opens in Farcaster"))}
                    onChallenge={shareChallenge}
                    onScope={(scope) => {
                      setLeaderboardScope(scope);
                      loadLeaderboard(scope, leaderboardPeriod, leaderboardMode);
                    }}
                    onPeriod={(period) => {
                      setLeaderboardPeriod(period);
                      loadLeaderboard(leaderboardScope, period, leaderboardMode);
                    }}
                    onMode={(mode) => {
                      setLeaderboardMode(mode);
                      loadLeaderboard(leaderboardScope, leaderboardPeriod, mode);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </section>
      )}

      {showFooterNav && (
        <DashboardNav
          active={dashboardTab}
          onSelect={(tab) => {
            haptic("selection");
            setDashboardTab(tab);
          }}
        />
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

function ProfileSettingsPopover({
  user,
  displayName,
  score,
  bestAll,
  streak,
  accessLabel,
  proActive,
  dayActive,
  annualActive,
  audioEnabled,
  voiceEnabled,
  hapticsEnabled,
  address,
  selectedSkin,
  receipts,
  themeMode,
  resolvedTheme,
  onClose,
  onThemeMode,
  onToggleAudio,
  onToggleVoice,
  onToggleHaptics,
  onConnect,
  onGarage,
  onPassport,
  onHome,
}: {
  user?: { fid?: number; username?: string; displayName?: string; pfpUrl?: string } | null;
  displayName: string;
  score: number;
  bestAll: number;
  streak: number;
  accessLabel: string;
  proActive: boolean;
  dayActive: boolean;
  annualActive: boolean;
  audioEnabled: boolean;
  voiceEnabled: boolean;
  hapticsEnabled: boolean;
  address?: `0x${string}`;
  selectedSkin: Skin;
  receipts: PassReceipt[];
  themeMode: ThemeMode;
  resolvedTheme: ReturnType<typeof resolveThemeMode>;
  onClose: () => void;
  onThemeMode: (mode: ThemeMode) => void;
  onToggleAudio: () => void;
  onToggleVoice: () => void;
  onToggleHaptics: () => void;
  onConnect: () => void;
  onGarage: () => void;
  onPassport: () => void;
  onHome: () => void;
}) {
  const passTitle = annualActive ? "Lifetime pass" : dayActive ? "Day pass" : proActive ? "Premium pass" : "Free rider";
  const tokenStatus = address ? shortAddress(address) : "Wallet off";
  const lastReceipt = receipts[0];

  return (
    <div className="cc-themed-popover no-scrollbar pointer-events-auto absolute right-3 top-[4.25rem] z-50 max-h-[calc(100dvh-5.25rem)] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-md border backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar src={user?.pfpUrl} username={user?.username} displayName={user?.displayName} className="h-12 w-12 rounded-md" />
          <div className="min-w-0">
            <div className="truncate text-base font-black leading-tight text-white">{user?.displayName || displayName}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-white/48">
              <UserRound size={12} />
              <span className="truncate">{user?.username ? `@${user.username}` : user?.fid ? `fid:${user.fid}` : "local rider"}</span>
            </div>
          </div>
        </div>
        <button
          aria-label="Close profile settings"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/12 bg-white/8 text-white/64 active:scale-[0.98]"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-3 gap-1.5">
          <ProfileStat label="score" value={score.toLocaleString()} accent="#fbe764" />
          <ProfileStat label="best" value={bestAll.toLocaleString()} accent="#7cf2ff" />
          <ProfileStat label="streak" value={`${Math.min(7, Math.max(0, streak))}/7`} accent="#a2ff9a" />
        </div>

        <div className="mt-2 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#fbe764]">
                <Crown size={13} />
                {passTitle}
              </div>
              <div className="mt-1 truncate text-sm font-black text-white">{accessLabel}</div>
            </div>
            <button className="min-h-9 shrink-0 rounded-md bg-[#fbe764] px-3 text-[10px] font-black uppercase text-[#071018] active:scale-[0.98]" onClick={onPassport}>
              Passport
            </button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <TokenInfo label="token" value="USDC" />
            <TokenInfo label="network" value="Base" />
            <TokenInfo label="wallet" value={tokenStatus} />
          </div>
          {lastReceipt && (
            <div className="mt-2 truncate rounded-md border border-white/10 bg-black/18 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white/48">
              Last {lastReceipt.txLabel}
            </div>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <ProfileToggle icon={audioEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />} label="Sound" enabled={audioEnabled} onClick={onToggleAudio} />
          <ProfileToggle icon={<Radio size={15} />} label="Voice" enabled={voiceEnabled} onClick={onToggleVoice} />
          <ProfileToggle icon={<Settings size={15} />} label="Haptics" enabled={hapticsEnabled} onClick={onToggleHaptics} />
          <button className="min-h-11 rounded-md border border-white/12 bg-white/8 px-3 text-left active:scale-[0.98]" onClick={onGarage}>
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#a2ff9a]">
              <Bike size={15} />
              Bike
            </span>
            <span className="mt-1 block truncate text-xs font-black text-white">{selectedSkin.name}</span>
          </button>
        </div>

        <ThemeModePicker selected={themeMode} resolved={resolvedTheme} onSelect={onThemeMode} />

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/35 bg-[#7cf2ff]/13 px-3 text-xs font-black text-white active:scale-[0.98]" onClick={onConnect}>
            <Wallet size={15} />
            {address ? "Wallet" : "Connect"}
          </button>
          <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black text-white active:scale-[0.98]" onClick={onHome}>
            <Home size={15} />
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/8 px-2 py-2">
      <div className="text-[8px] font-black uppercase tracking-[0.1em] text-white/38">{label}</div>
      <div className="mt-1 truncate text-sm font-black leading-tight" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function TokenInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/18 px-2 py-1.5">
      <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/36">{label}</div>
      <div className="mt-0.5 truncate text-[10px] font-black text-white">{value}</div>
    </div>
  );
}

function ThemeModePicker({ selected, resolved, onSelect }: { selected: ThemeMode; resolved: ReturnType<typeof resolveThemeMode>; onSelect: (mode: ThemeMode) => void }) {
  const modes: Array<{ id: ThemeMode; label: string; tone: string }> = [
    { id: "system", label: "System", tone: resolved === "light" ? "#071018" : "#f8fbff" },
    { id: "light", label: "Light", tone: "#f8fbff" },
    { id: "dark", label: "Dark", tone: "#071018" },
    { id: "custom", label: "Custom", tone: "linear-gradient(135deg,#ff7adf,#7cf2ff)" },
  ];

  return (
    <div className="mt-2 rounded-md border border-white/12 bg-white/8 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/46">
          <Settings size={13} />
          Theme
        </div>
        <div className="text-[9px] font-black uppercase tracking-[0.1em] text-white/38">{resolved}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {modes.map((mode) => {
          const active = selected === mode.id;
          return (
            <button
              key={mode.id}
              aria-pressed={active}
              className={`min-h-12 rounded-md border px-1.5 py-1 text-center active:scale-[0.98] ${
                active ? "border-[#fbe764]/70 bg-[#fbe764]/14" : "border-white/10 bg-black/14"
              }`}
              onClick={() => onSelect(mode.id)}
            >
              <span className="mx-auto block h-4 w-4 rounded-full border border-white/18" style={{ background: mode.tone }} />
              <span className="mt-1 block truncate text-[9px] font-black uppercase tracking-normal text-white/70">{mode.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileToggle({ icon, label, enabled, onClick }: { icon: React.ReactNode; label: string; enabled: boolean; onClick: () => void }) {
  return (
    <button
      className={`flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-left active:scale-[0.98] ${
        enabled ? "border-[#7cf2ff]/50 bg-[#7cf2ff]/14" : "border-white/12 bg-white/8"
      }`}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={enabled ? "text-[#7cf2ff]" : "text-white/48"}>{icon}</span>
        <span className="truncate text-xs font-black text-white">{label}</span>
      </span>
      <span className={`h-5 w-9 rounded-full p-0.5 transition ${enabled ? "bg-[#7cf2ff]" : "bg-white/16"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${enabled ? "translate-x-4" : ""}`} />
      </span>
    </button>
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
  onRoam,
}: {
  step: number;
  routeName: string;
  miniAppAdded: boolean;
  onStep: (step: number) => void;
  onAdd: () => void;
  onSkip: () => void;
  onStart: () => void;
  onRoam: () => void;
}) {
  const slides = [
    {
      icon: <Map size={18} />,
      kicker: "Roam",
      title: "30s free park",
      body: "Any direction. Paths are fast.",
      accent: "#fbe764",
    },
    {
      icon: <Trophy size={18} />,
      kicker: "Dash",
      title: "Daily score run",
      body: `${routeName}. Beat friends.`,
      accent: "#7cf2ff",
    },
    {
      icon: <Wallet size={18} />,
      kicker: "Pass",
      title: "$1 day / $7 life",
      body: "Unlimited parks, bikes, lounge.",
      accent: "#a2ff9a",
    },
  ];
  const safeStep = Math.min(step, slides.length - 1);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7cf2ff]">Welcome</div>
          <h1 className="cc-intro-title mt-1 text-3xl font-black leading-none tracking-normal text-white">Ride CasterCycle</h1>
          <p className="cc-intro-copy mt-2 text-sm font-semibold leading-5 text-white/64">Pick a ride. Cast the score. Come back tomorrow.</p>
        </div>
        <Image
          src="/media/castercycle.png"
          alt=""
          width={58}
          height={58}
          className="cc-intro-image h-[58px] w-[58px] shrink-0 rounded-md border border-white/15 object-cover shadow-lg"
        />
      </div>

      <div className="cc-intro-slides mt-5 grid grid-cols-3 gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.kicker}
            className={`cc-intro-slide min-h-[86px] rounded-md border p-2 text-left transition active:scale-[0.98] ${safeStep === index ? "bg-white/12" : "bg-white/7"}`}
            style={{ borderColor: safeStep === index ? slide.accent : "rgba(255,255,255,0.12)" }}
            onClick={() => {
              haptic("selection");
              onStep(index);
            }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md text-[#071018]" style={{ background: slide.accent }}>
              {slide.icon}
            </span>
            <span className="mt-2 block text-[11px] font-black leading-tight text-white">{slide.title}</span>
            <span className="mt-1 block text-[9px] font-bold leading-tight text-white/48">{slide.body}</span>
          </button>
        ))}
      </div>

      <div className="cc-primary-actions mt-5 grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#a2ff9a] px-4 text-sm font-black text-[#071018] transition active:scale-[0.98]"
          onClick={() => {
            haptic("medium");
            onRoam();
          }}
        >
          <Bike size={18} />
          Roam Free
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-4 text-sm font-black text-[#071018] transition active:scale-[0.98]"
          onClick={() => {
            haptic("medium");
            onStart();
          }}
        >
          <Play size={18} />
          Dash
        </button>
      </div>

      <div className={`mt-3 grid gap-2 ${!miniAppAdded ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-white/15 bg-white/8 px-4 text-xs font-black uppercase tracking-[0.08em] text-white/64 transition active:scale-[0.98]"
          onClick={() => {
            haptic("selection");
            onSkip();
          }}
        >
          Skip
        </button>
        {!miniAppAdded && (
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/14 px-3 text-xs font-black uppercase tracking-[0.08em] text-white transition active:scale-[0.98]"
            onClick={onAdd}
          >
            <Sparkles size={16} />
            Add
          </button>
        )}
      </div>
    </div>
  );
}

function WelcomeBackPanel({
  displayName,
  routeName,
  onAdd,
  onShare,
  onStart,
  onRoam,
}: {
  displayName: string;
  routeName: string;
  onAdd: () => void;
  onShare: () => void;
  onStart: () => void;
  onRoam: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7cf2ff]">Welcome back</div>
          <h1 className="cc-intro-title mt-1 text-3xl font-black leading-none tracking-normal text-white">Today&apos;s Ride</h1>
          <p className="cc-intro-copy mt-2 truncate text-sm font-semibold leading-5 text-white/68">{displayName} - {routeName}</p>
        </div>
        <Image
          src="/media/castercycle.png"
          alt=""
          width={58}
          height={58}
          className="cc-intro-image h-[58px] w-[58px] shrink-0 rounded-md border border-white/15 object-cover shadow-lg"
        />
      </div>

      <div className="cc-primary-actions mt-4 grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#a2ff9a] px-3 text-sm font-black text-[#071018] transition active:scale-[0.98]"
          onClick={() => {
            haptic("medium");
            onRoam();
          }}
        >
          <Bike size={17} />
          Roam
        </button>
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#fbe764] px-3 text-sm font-black text-[#071018] transition active:scale-[0.98]"
          onClick={() => {
            haptic("medium");
            onStart();
          }}
        >
          <Play size={17} />
          Dash
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <FeatureChip icon={<Zap size={13} />} label="daily" />
        <FeatureChip icon={<Trophy size={13} />} label="rank" />
        <FeatureChip icon={<Wallet size={13} />} label="wallet" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-2 text-xs font-black text-white transition active:scale-[0.98]"
          onClick={onShare}
        >
          <Share2 size={17} />
          Invite
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-[#fbe764]/45 bg-[#fbe764]/14 px-2 text-xs font-black text-white transition active:scale-[0.98]"
          onClick={onAdd}
        >
          <Sparkles size={17} />
          Add app
        </button>
      </div>
    </div>
  );
}

function dashboardMeta(tab: DashboardTab) {
  if (tab === "shop") return { title: "Passport", kicker: "premium access", detail: "Stamps, missions, pass, and receipts.", accent: "#35f6c8", icon: <Wallet size={18} /> };
  if (tab === "garage") return { title: "World", kicker: "map + bike", detail: "Choose the park, target spot, and skin.", accent: "#a2ff9a", icon: <Map size={18} /> };
  if (tab === "club") return { title: "Club", kicker: "rider lounge", detail: "Clean chat for pass riders.", accent: "#c4b5fd", icon: <Users size={18} /> };
  if (tab === "quest") return { title: "Fan", kicker: "Ranger guide", detail: "Organized fan info, links, and videos.", accent: "#ff9ec7", icon: <Sparkles size={18} /> };
  if (tab === "leaders") return { title: "Rank", kicker: "leaderboard", detail: "Daily and weekly Farcaster challenges.", accent: "#fbe764", icon: <Trophy size={18} /> };
  return { title: "Play", kicker: "ride now", detail: "Daily Dash, free roam, and premium worlds.", accent: "#7cf2ff", icon: <Play size={18} /> };
}

function DashboardHeader({
  tab,
  routeName,
  score,
  finished,
}: {
  tab: DashboardTab;
  routeName: string;
  score: number;
  finished: boolean;
}) {
  const meta = dashboardMeta(tab);

  return (
    <div className="cc-dashboard-header rounded-md border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: meta.accent }}>
            {meta.icon}
            {meta.kicker}
          </div>
          <h1 className="cc-dashboard-title mt-1 truncate text-2xl font-black leading-none tracking-normal text-white">{meta.title}</h1>
          {finished && (
            <p className="cc-dashboard-detail mt-1 truncate text-sm font-semibold leading-5 text-white/62">
              {score.toLocaleString()} on {routeName}
            </p>
          )}
        </div>
        <Image
          src="/media/castercycle.png"
          alt=""
          width={56}
          height={56}
          className="cc-dashboard-image h-14 w-14 shrink-0 rounded-md border border-white/15 object-cover shadow-lg"
        />
      </div>
    </div>
  );
}

function DashboardNav({ active, onSelect }: { active: DashboardTab; onSelect: (tab: DashboardTab) => void }) {
  const tabs = [
    { id: "ride" as DashboardTab, label: "Play", icon: <Play size={17} /> },
    { id: "garage" as DashboardTab, label: "World", icon: <Map size={17} /> },
    { id: "shop" as DashboardTab, label: "Access", icon: <Wallet size={17} /> },
    { id: "club" as DashboardTab, label: "Club", icon: <Users size={17} /> },
    { id: "quest" as DashboardTab, label: "Fan", icon: <Sparkles size={17} /> },
    { id: "leaders" as DashboardTab, label: "Rank", icon: <Trophy size={17} /> },
  ];

  return (
    <nav className="cc-footer-nav pointer-events-auto absolute inset-x-0 bottom-0 z-30 px-3 pb-3" aria-label="App navigation">
      <div className="cc-footer-surface rounded-md border p-1.5 backdrop-blur-2xl">
        <div className="grid grid-cols-6 gap-1">
        {tabs.map((item) => {
          const selected = active === item.id;
          const meta = dashboardMeta(item.id);
          return (
            <button
              key={item.id}
              aria-current={selected ? "page" : undefined}
              data-active={selected ? "true" : "false"}
              className="cc-nav-button flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-md px-1 text-center transition active:scale-[0.98]"
              onClick={() => onSelect(item.id)}
            >
              <span className="cc-nav-icon" style={{ color: selected ? meta.accent : undefined }}>{item.icon}</span>
              <span className="cc-nav-label block max-w-full truncate text-[9px] font-black leading-none tracking-normal">{item.label}</span>
            </button>
          );
        })}
        </div>
      </div>
    </nav>
  );
}

function WorldHub({
  phase,
  score,
  bestToday,
  bestAll,
  streak,
  proActive,
  accessLabel,
  sharing,
  onStart,
  onFreeRide,
  onShop,
  onShare,
}: {
  phase: RidePhase;
  score: number;
  bestToday: number;
  bestAll: number;
  streak: number;
  proActive: boolean;
  accessLabel: string;
  sharing: boolean;
  onStart: () => void;
  onFreeRide: () => void;
  onShop: () => void;
  onShare: () => void;
}) {
  const event = dailyParkEvent();
  const activeRun = phase === "riding" || phase === "finished";

  return (
    <div className="cc-world-hub mt-3">
      <div className="cc-today-card overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,rgba(124,242,255,0.14),rgba(162,255,154,0.10)_55%,rgba(251,231,100,0.08))] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#7cf2ff] text-[#071018] shadow-[0_12px_30px_rgba(124,242,255,0.18)]">
              <Target size={22} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-black leading-tight text-white">{event.title}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: event.color }} />
                <span className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-white/58">{event.spot}</span>
              </div>
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-[#fbe764]/30 bg-[#fbe764]/12 px-2 py-1 text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#fbe764]">score</div>
            <div className="text-sm font-black text-white">{score.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="cc-ride-actions mt-3 grid grid-cols-2 gap-2">
        <button
          aria-label="Start free roam"
          className="cc-ride-card group relative min-h-[132px] overflow-hidden rounded-md border border-[#a2ff9a]/35 bg-[#a2ff9a]/12 p-3 text-left shadow-[0_18px_40px_rgba(162,255,154,0.08)] active:scale-[0.98]"
          onClick={onFreeRide}
        >
          <span className="absolute -right-7 -top-7 h-24 w-24 rounded-full border border-[#a2ff9a]/25 bg-[#a2ff9a]/10" />
          <span className="relative flex h-12 w-12 items-center justify-center rounded-md bg-[#a2ff9a] text-[#071018] shadow-[0_10px_24px_rgba(162,255,154,0.18)]">
            <Bike size={23} />
          </span>
          <span className="cc-ride-title relative mt-4 block text-2xl font-black leading-none text-white">Roam</span>
          <span className="relative mt-3 flex gap-1.5">
            {["park", "flow", "30s"].map((label) => (
              <span key={label} className="rounded border border-white/10 bg-black/18 px-1.5 py-1 text-[9px] font-black uppercase tracking-[0.06em] text-white/54">
                {label}
              </span>
            ))}
          </span>
        </button>
        <button
          aria-label="Start Daily Dash"
          className="cc-ride-card group relative min-h-[132px] overflow-hidden rounded-md border border-[#7cf2ff]/35 bg-[#7cf2ff]/12 p-3 text-left shadow-[0_18px_40px_rgba(124,242,255,0.08)] active:scale-[0.98]"
          onClick={onStart}
        >
          <span className="absolute -right-7 -top-7 h-24 w-24 rounded-full border border-[#7cf2ff]/25 bg-[#7cf2ff]/10" />
          <span className="relative flex h-12 w-12 items-center justify-center rounded-md bg-[#7cf2ff] text-[#071018] shadow-[0_10px_24px_rgba(124,242,255,0.18)]">
            <Play size={23} fill="currentColor" />
          </span>
          <span className="cc-ride-title relative mt-4 block text-2xl font-black leading-none text-white">Dash</span>
          <span className="relative mt-3 flex gap-1.5">
            {["lane", "boost", "rank"].map((label) => (
              <span key={label} className="rounded border border-white/10 bg-black/18 px-1.5 py-1 text-[9px] font-black uppercase tracking-[0.06em] text-white/54">
                {label}
              </span>
            ))}
          </span>
        </button>
      </div>

      <div className="cc-score-strip mt-2 grid grid-cols-3 gap-1.5">
        <ResultStat label="best" value={bestAll.toLocaleString()} />
        <ResultStat label="today" value={bestToday.toLocaleString()} />
        <ResultStat label="streak" value={`${Math.min(7, Math.max(0, streak))}/7`} />
      </div>

      <div className="cc-access-row mt-2 flex min-h-10 items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{accessLabel}</div>
        </div>
        <button
          aria-label="Open pass"
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border border-white/12 bg-white/8 px-2 text-white"
          onClick={onShop}
        >
          <Crown size={13} />
        </button>
      </div>

      {!proActive && (
        <button
          aria-label="Open Cycle Pass"
          className="mt-2 flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-[#fbe764]/35 bg-[#fbe764]/12 px-3 text-left active:scale-[0.99]"
          onClick={onShop}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-white">Cycle Pass</span>
          </span>
          <Crown size={17} className="shrink-0 text-[#fbe764]" />
        </button>
      )}

      <div className="mt-3">
        <button
          className="cc-share-button inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/14 px-4 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-70"
          disabled={sharing}
          onClick={onShare}
        >
          <Share2 size={18} />
          {sharing ? "Opening" : activeRun ? "Share" : "Invite"}
        </button>
      </div>
    </div>
  );
}

function PremiumWorldTeaser({
  proActive,
  onShop,
  onPreview,
}: {
  proActive: boolean;
  onShop: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-[#ff7adf]/30 bg-[linear-gradient(135deg,rgba(255,122,223,0.16),rgba(124,242,255,0.10)_48%,rgba(251,231,100,0.10))]">
      <button className="block w-full p-3 text-left active:scale-[0.99]" onClick={proActive ? onPreview : onShop}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#ff7adf] text-[#071018] shadow-[0_10px_24px_rgba(255,122,223,0.18)]">
              <Crown size={13} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-lg font-black leading-tight text-white">Premium Worlds</div>
              <div className="mt-1 flex gap-1.5">
                {["Glow", "Skyline"].map((label) => (
                  <span key={label} className="rounded border border-white/10 bg-black/18 px-1.5 py-1 text-[9px] font-black uppercase tracking-[0.06em] text-white/58">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-[#fbe764]/30 bg-[#fbe764]/14 px-2 py-1 text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#fbe764]">{proActive ? "ready" : "pass"}</div>
            <div className="text-sm font-black text-white">{proActive ? "Ride" : "$1/$7"}</div>
          </div>
        </div>
      </button>
      {!proActive && (
        <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-2">
          <button className="min-h-9 rounded-md bg-[#fbe764] px-3 text-[10px] font-black uppercase text-[#071018] active:scale-[0.98]" onClick={onShop}>
            Unlock
          </button>
          <button className="min-h-9 rounded-md border border-white/12 bg-white/8 px-3 text-[10px] font-black uppercase text-white/72 active:scale-[0.98]" onClick={onPreview}>
            Preview
          </button>
        </div>
      )}
    </div>
  );
}

function PremiumPassportPanel({
  proActive,
  dateKey,
  selectedSkin,
  onGarage,
  onRide,
}: {
  proActive: boolean;
  dateKey: string;
  selectedSkin: Skin;
  onGarage: () => void;
  onRide: (area: RideArea) => void;
}) {
  const passSkin = selectedSkin.unlock === "pro" ? selectedSkin : SKINS.find((item) => item.id === "neon") ?? selectedSkin;
  const missions = dailyPaidMissions(dateKey);
  const stamps = [
    { area: "bikeLand" as RideArea, label: "E-Bike Land", code: "EBL", accent: "#ff7adf", icon: <Zap size={15} /> },
    { area: "skyline" as RideArea, label: "Skyline", code: "SKY", accent: "#7cf2ff", icon: <Radio size={15} /> },
  ];

  return (
    <div className="cc-passport mt-4 overflow-hidden rounded-md border border-white/45 bg-[#f8fbff] p-3 text-[#071018] shadow-[0_20px_48px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#6f7785]">
            <Crown size={13} />
            premium passport
          </div>
          <div className="mt-1 text-xl font-black leading-tight tracking-normal">Premium Passport</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-[#5a6370]">{dateKey.slice(5)} daily stamps</div>
        </div>
        <div className={`shrink-0 rounded-md px-2 py-1 text-right ${proActive ? "bg-[#071018] text-white" : "bg-[#dfe7ef] text-[#44505c]"}`}>
          <div className="text-[9px] font-black uppercase tracking-[0.08em] opacity-70">{proActive ? "active" : "locked"}</div>
          <div className="text-sm font-black">{proActive ? "Ready" : "$1/$7"}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {stamps.map((stamp) => (
          <button
            key={stamp.area}
            className="min-h-[92px] rounded-md border border-[#cbd7e2] bg-white px-2 py-2 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.75)] active:scale-[0.98]"
            onClick={() => onRide(stamp.area)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md text-white" style={{ backgroundColor: stamp.accent }}>
                {stamp.icon}
              </span>
              <span className="rounded border border-dashed border-[#9aa8b7] px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#4f5965]">
                {proActive ? "Stamped" : "Locked"}
              </span>
            </span>
            <span className="mt-2 block text-sm font-black leading-tight">{stamp.label}</span>
            <span className="mt-0.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[#7d8794]">{stamp.code} passport mark</span>
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-[#d3dee9] bg-[#eef4f8] p-2">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#687584]">
          <Target size={12} />
          paid missions
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {missions.map((mission) => (
            <div key={mission.area} className="rounded-md border border-white bg-white/78 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[9px] font-black uppercase tracking-[0.08em]" style={{ color: mission.accent }}>
                  {mission.world}
                </span>
                <span className="shrink-0 text-[9px] font-black text-[#5d6876]">+{mission.reward}</span>
              </div>
              <div className="mt-1 truncate text-xs font-black text-[#071018]">{mission.title}</div>
              <div className="mt-0.5 truncate text-[10px] font-semibold text-[#697482]">{mission.goal}</div>
            </div>
          ))}
        </div>
      </div>

      <button
        className="mt-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-[#cbd7e2] bg-white px-3 text-left active:scale-[0.99]"
        onClick={onGarage}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: passSkin.frame }}>
            <Bike size={17} className="text-[#071018]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[9px] font-black uppercase tracking-[0.12em] text-[#6f7785]">selected pass skin</span>
            <span className="block truncate text-sm font-black text-[#071018]">{passSkin.name}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {[passSkin.frame, passSkin.battery, passSkin.trail].map((color, index) => (
            <span key={`${color}-${index}`} className="h-4 w-4 rounded border border-[#071018]/10" style={{ background: color }} />
          ))}
        </span>
      </button>
    </div>
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
      label: "Community",
      meta: "Free ride",
      icon: <Bike size={15} />,
      locked: false,
    },
    {
      id: "statePark" as RideArea,
      label: "State Park",
      meta: "Open ride",
      icon: <Sparkles size={15} />,
      locked: false,
    },
    {
      id: "bikeLand" as RideArea,
      label: "E-Bike Land",
      meta: lifetimeActive ? "Lifetime" : proActive ? "Unlocked" : "10s preview",
      icon: proActive ? <Zap size={15} /> : <Lock size={15} />,
      locked: !proActive,
    },
    {
      id: "skyline" as RideArea,
      label: "Skyline",
      meta: lifetimeActive ? "Lifetime" : proActive ? "Unlocked" : "10s preview",
      icon: proActive ? <Radio size={15} /> : <Lock size={15} />,
      locked: !proActive,
    },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
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

function DestinationPicker({ area, selected, onSelect }: { area: RideArea; selected: string | null; onSelect: (spot: string | null) => void }) {
  const event = dailyParkEvent();
  const spots = freeRideSpots(area)
    .filter((spot) => spot.name !== "Trailhead")
    .sort((a, b) => (a.name === event.spot ? -1 : b.name === event.spot ? 1 : 0));
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-white/[0.04] p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/42">
          <Map size={12} />
          map target
        </div>
        <button className="text-[10px] font-black uppercase text-[#fbe764]" onClick={() => onSelect(event.spot)}>
          today
        </button>
        <button className="text-[10px] font-black uppercase text-white/45" onClick={() => onSelect(null)}>
          auto
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {spots.map((spot) => (
          <button
            key={spot.name}
            className={`min-h-10 rounded-md border px-1.5 text-left transition active:scale-[0.98] ${
              selected === spot.name ? "border-[#fbe764]/70 bg-[#fbe764]/14" : "border-white/10 bg-black/18"
            }`}
            onClick={() => onSelect(spot.name)}
          >
            <span className="mb-0.5 flex items-center justify-between gap-1">
              <span className="block h-1.5 w-5 rounded-full" style={{ backgroundColor: spot.color }} />
              {spot.name === event.spot && <span className="text-[7px] font-black uppercase text-[#fbe764]">day</span>}
            </span>
            <span className="block truncate text-[9px] font-black text-white">{spot.short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RideRecapPanel({ recap, bestToday, onShare, onRideAgain }: { recap: RideRecap; bestToday: number; onShare: () => void; onRideAgain: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-[#a2ff9a]/28 bg-[#a2ff9a]/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#a2ff9a]">
            <Trophy size={13} />
            today&apos;s recap
          </div>
          <div className="mt-1 text-lg font-black leading-tight text-white">{recap.title}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-white/58">{recap.routeName}</div>
        </div>
        <div className="shrink-0 rounded-md border border-[#fbe764]/35 bg-[#fbe764]/12 px-2 py-1 text-right">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#fbe764]">score</div>
          <div className="text-sm font-black text-white">{recap.score.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <ResultStat label="dist" value={`${Math.round(recap.distance)}m`} />
        <ResultStat label="flow" value={`${recap.combo}x`} />
        <ResultStat label={recap.mode === "freestyle" ? "zones" : "today"} value={recap.mode === "freestyle" ? String(recap.zones ?? 0) : bestToday.toLocaleString()} />
        <ResultStat label="bonus" value={recap.eventBonus ? `+${recap.eventBonus}` : "-"} />
      </div>
      <div className="mt-2 truncate rounded-md border border-white/10 bg-black/18 px-3 py-2 text-[11px] font-bold text-white/64">
        {recap.eventLabel || "Share the run and come back tomorrow."}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="min-h-10 rounded-md bg-[#fbe764] px-3 text-xs font-black uppercase text-[#071018]" onClick={onShare}>
          Share
        </button>
        <button className="min-h-10 rounded-md border border-white/14 bg-white/8 px-3 text-xs font-black uppercase text-white" onClick={onRideAgain}>
          Ride again
        </button>
      </div>
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

function StatusRibbon({ accent, label, value }: { accent: string; label: string; value: string }) {
  return (
    <div className="mt-2 flex min-h-9 items-center justify-between gap-2 rounded-md border border-white/10 bg-[#071018]/58 px-3 py-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_12px_currentColor]" style={{ backgroundColor: accent, color: accent }} />
        <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-white">{label}</span>
      </div>
      <div className="truncate text-right text-[10px] font-bold text-white/56">{value}</div>
    </div>
  );
}

function ObjectiveStrip({ objectives }: { objectives: ParkObjective[] }) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1.5">
      {objectives.map((objective) => (
        <div
          key={objective.id}
          className={`min-w-0 rounded-md border px-2 py-1.5 backdrop-blur-md ${
            objective.done ? "border-[#a2ff9a]/55 bg-[#a2ff9a]/16" : "border-white/12 bg-black/24"
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[8px] font-black uppercase tracking-[0.08em] text-white/48">{objective.label}</span>
            {objective.done && <CheckCircle2 size={10} className="shrink-0 text-[#a2ff9a]" />}
          </div>
          <div className="mt-1 truncate text-[10px] font-black leading-none text-white">{objective.value}</div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/12">
            <div className="h-full rounded-full bg-[#fbe764]" style={{ width: `${Math.round(objective.progress * 100)}%` }} />
          </div>
        </div>
      ))}
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
    <div className="cc-feature-chip flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-black/18 px-2 text-[10px] font-black uppercase tracking-[0.08em] text-white/72">
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

function DailyRewardPanel({
  claimed,
  onClaim,
  onShare,
  onShop,
}: {
  claimed: boolean;
  onClaim: () => void;
  onShare: () => void;
  onShop: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#fbe764]">
            <Sparkles size={13} />
            Daily reward
          </div>
          <div className="mt-1 text-sm font-black text-white">{claimed ? "Badge claimed" : "Claim today's badge"}</div>
          <div className="mt-0.5 text-xs font-semibold text-white/58">Share for a bonus badge. Come back tomorrow.</div>
        </div>
        {claimed && <CheckCircle2 size={22} className="shrink-0 text-[#a2ff9a]" />}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="min-h-10 rounded-md bg-[#fbe764] px-2 text-[10px] font-black uppercase tracking-[0.04em] text-[#071018] disabled:opacity-55" disabled={claimed} onClick={onClaim}>
          Badge
        </button>
        <button className="min-h-10 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/14 px-2 text-[10px] font-black uppercase tracking-[0.04em] text-white" onClick={onShare}>
          Share badge
        </button>
        <button className="min-h-10 rounded-md border border-white/12 bg-white/8 px-2 text-[10px] font-black uppercase tracking-[0.04em] text-white/76" onClick={onShop}>
          Claim
        </button>
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

function profileInitial(username?: string, displayName?: string) {
  return (username || displayName || "R").trim().slice(0, 1).toUpperCase() || "R";
}

function ProfileAvatar({ src, username, displayName, className = "h-8 w-8" }: { src?: string; username?: string; displayName?: string; className?: string }) {
  const label = username ? `@${username}` : displayName || "rider";
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-md border border-white/14 bg-[#101923] ${className}`}>
      <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-[#7cf2ff]">
        {profileInitial(username, displayName)}
      </div>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function shortAddress(value?: `0x${string}`) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Farcaster wallet";
}

function FarcasterWalletPanel({
  connected,
  connecting,
  address,
  accessLabel,
}: {
  connected: boolean;
  connecting: boolean;
  address?: `0x${string}`;
  accessLabel: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-[#7cf2ff]/24 bg-[#7cf2ff]/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7cf2ff]">
            <Wallet size={13} />
            Farcaster wallet
          </div>
          <div className="mt-1 truncate text-sm font-black text-white">
            {address ? shortAddress(address) : "Mini App wallet"}
          </div>
          <div className="mt-0.5 text-xs font-semibold leading-5 text-white/58">
            {address ? "Passes and receipts use this Mini App wallet." : "Wallet approval opens only when you tap buy."}
          </div>
        </div>
        <div className={`shrink-0 rounded-md border px-2 py-1 text-right ${connected ? "border-[#a2ff9a]/45 bg-[#a2ff9a]/14" : "border-white/12 bg-white/8"}`}>
          <div className={`text-[9px] font-black uppercase tracking-[0.1em] ${connected ? "text-[#a2ff9a]" : "text-white/42"}`}>{connected ? "ready" : "status"}</div>
          <div className="max-w-[92px] truncate text-sm font-black text-white">{connected ? accessLabel : connecting ? "..." : "Ready"}</div>
        </div>
      </div>
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
              <span className="block text-[9px] font-bold leading-tight text-white/45">{skinRideStats(skin).label}</span>
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
  mode,
  onProfile,
  onChallenge,
  onScope,
  onPeriod,
  onMode,
}: {
  rows: LeaderboardRow[];
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
  mode: LeaderboardMode;
  onProfile: (fid: number) => void;
  onChallenge: (row: LeaderboardRow) => void;
  onScope: (scope: LeaderboardScope) => void;
  onPeriod: (period: LeaderboardPeriod) => void;
  onMode: (mode: LeaderboardMode) => void;
}) {
  const rowsLabel = mode === "freestyle" ? "Park flow" : "Daily Dash";

  return (
    <div className="mt-4">
      <div className="mb-2 rounded-md border border-[#fbe764]/24 bg-[#fbe764]/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">
              <Trophy size={13} />
              rank board
            </div>
            <div className="mt-1 truncate text-lg font-black text-white">{rowsLabel}</div>
          </div>
          <div className="shrink-0 rounded-md border border-white/12 bg-black/18 px-2 py-1 text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-white/42">{period}</div>
            <div className="text-sm font-black text-white">{scope}</div>
          </div>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
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
        <div className="flex rounded-md bg-white/8 p-0.5">
          {(["daily", "weekly"] as LeaderboardPeriod[]).map((item) => (
            <button
              key={item}
              className="rounded px-2 py-1 text-[10px] font-black uppercase text-white"
              style={{ background: period === item ? "rgba(251,231,100,0.22)" : "transparent" }}
              onClick={() => {
                haptic("selection");
                onPeriod(item);
              }}
            >
              {item === "daily" ? "today" : "week"}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        {(["dash", "freestyle"] as LeaderboardMode[]).map((item) => (
          <button
            key={item}
            className="min-h-9 rounded-md border px-2 text-[10px] font-black uppercase tracking-[0.08em] text-white"
            style={{
              borderColor: mode === item ? "rgba(162,255,154,0.72)" : "rgba(255,255,255,0.12)",
              background: mode === item ? "rgba(162,255,154,0.14)" : "rgba(255,255,255,0.06)",
            }}
            onClick={() => {
              haptic("selection");
              onMode(item);
            }}
          >
            {item === "dash" ? "Dash" : "Park"}
          </button>
        ))}
      </div>
      <div className="max-h-56 overflow-hidden rounded-md border border-white/12 bg-white/7">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-xs font-semibold leading-5 text-white/50">No server scores yet. Finish a ride to seed this board.</div>
        ) : (
          rows.slice(0, 5).map((row, index) => (
            <div
              key={`${row.fid}-${row.username}-${index}`}
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center gap-2 border-b border-white/8 px-3 py-2 text-left transition hover:bg-white/5 last:border-b-0"
              onClick={() => {
                haptic("selection");
                onChallenge(row);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  haptic("selection");
                  onChallenge(row);
                }
              }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#fbe764]/14 text-xs font-black text-[#fbe764]">{index + 1}</div>
              <button
                aria-label={`Open ${row.username || row.displayName || "rider"} profile`}
                className="shrink-0 rounded-md active:scale-[0.96]"
                onClick={(event) => {
                  event.stopPropagation();
                  haptic("selection");
                  if (row.fid > 0) onProfile(row.fid);
                }}
              >
                <ProfileAvatar src={row.pfpUrl} username={row.username} displayName={row.displayName} className="h-8 w-8" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-white">{row.username ? `@${row.username}` : row.displayName || `fid:${row.fid}`}</div>
                <div className="truncate text-[10px] font-bold text-white/45">{period === "weekly" && row.bestDateKey ? `best ${row.bestDateKey.slice(5)} - ` : ""}{row.routeName}</div>
              </div>
              <div className="min-w-[72px] text-right">
                <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/38">{period === "daily" ? "today" : "week"}</div>
                <div className="text-sm font-black text-white">{(period === "daily" ? row.dailyScore : row.weeklyScore).toLocaleString()}</div>
              </div>
            </div>
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
      setStatus("Farcaster identity needed");
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
        <p className="mt-1 text-xs font-semibold leading-5 text-white/58">Short clean chat, garage talk, and paid rider perks live here.</p>
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
              <ProfileAvatar src={message.pfpUrl} username={message.username} displayName={message.displayName} className="h-7 w-7" />
              <div className="min-w-0">
                <div className="truncate text-[10px] font-black text-[#fbe764]">{message.username ? `@${message.username}` : message.displayName || `fid:${message.fid}`}</div>
                <div className="break-words text-xs font-semibold leading-4 text-white/78">{message.text}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {emojis.slice(0, 4).map((_, index) => {
          const prompts = ["Ride today?", "Best line?", "Garage check", "Boost tip"];
          const prompt = prompts[index];
          return (
          <button
            key={prompt}
            className="min-h-8 rounded-md border border-white/12 bg-white/7 px-1.5 text-[9px] font-black uppercase text-white/62"
            onClick={() => setDraft(prompt)}
          >
            {prompt.split(" ")[0]}
          </button>
          );
        })}
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

function RangerFanQuest({ onOpen, onShare }: { onOpen: (url: string) => void; onShare: () => void }) {
  const [guideDraft, setGuideDraft] = useState("");
  const [guideMessages, setGuideMessages] = useState<RangerGuideMessage[]>([
    {
      role: "guide",
      text: "I can help sort Ranger facts: deal, range, speed class, motor, brakes, weight, videos, and what to verify before buying.",
    },
  ]);

  const askGuide = (raw: string) => {
    const question = raw.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!question) return;
    setGuideMessages((messages) => [...messages.slice(-5), { role: "user", text: question }, { role: "guide", text: rangerGuideAnswer(question) }]);
    setGuideDraft("");
  };

  return (
    <div className="mt-4">
      <div className="rounded-md border border-[#fbe764]/28 bg-[linear-gradient(135deg,rgba(251,231,100,0.12),rgba(124,242,255,0.08)_55%,rgba(255,122,223,0.08))] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">
              <Sparkles size={13} />
              fan guide
            </div>
            <div className="mt-1 text-xl font-black leading-tight text-white">Ranger Fan Garage</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-white/62">
              A clean checklist for the Kingbull Ranger: deal, specs, videos, and buyer cautions in one place.
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-[#a2ff9a]/35 bg-[#a2ff9a]/12 px-2 py-1 text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#a2ff9a]">code</div>
            <div className="text-sm font-black text-white">{KINGBULL_COUPON_CODE}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {[
            ["Deal", "$799*"],
            ["Range", "80 mi*"],
            ["Class", "28 mph*"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-white/10 bg-black/16 px-2 py-2">
              <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/38">{label}</div>
              <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button className="min-h-10 rounded-md bg-[#fbe764] px-2 text-[10px] font-black uppercase text-[#071018]" onClick={() => onOpen(KINGBULL_RANGER_URL)}>
            Deal link
          </button>
          <button
            className="min-h-10 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/14 px-2 text-[10px] font-black uppercase text-white"
            onClick={() => {
              navigator.clipboard?.writeText(KINGBULL_COUPON_CODE).catch(() => {});
            }}
          >
            Copy code
          </button>
          <button className="min-h-10 rounded-md border border-white/12 bg-white/8 px-2 text-[10px] font-black uppercase text-white/76" onClick={onShare}>
            Share
          </button>
        </div>
        <div className="mt-2 text-[10px] font-semibold leading-4 text-white/44">
          *Fan page signals only. Verify current price, specs, warranty, taxes, shipping, and local e-bike rules.
        </div>
      </div>

      <div className="mt-3 rounded-md border border-[#7cf2ff]/24 bg-[#7cf2ff]/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#7cf2ff]">
            <Radio size={13} />
            ranger fan chat
          </div>
          <div className="rounded bg-white/10 px-2 py-1 text-[9px] font-black uppercase text-white/50">local guide</div>
        </div>
        <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-white/10 bg-black/18 p-2">
          {guideMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`mb-2 max-w-[92%] rounded-md px-2 py-1.5 text-xs font-semibold leading-4 last:mb-0 ${
                message.role === "guide" ? "bg-white/9 text-white/72" : "ml-auto bg-[#fbe764] text-[#071018]"
              }`}
            >
              {message.text}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {["Range?", "Class 3?", "Best deal?"].map((prompt) => (
            <button
              key={prompt}
              className="min-h-8 rounded-md border border-white/12 bg-white/8 px-2 text-[9px] font-black uppercase text-white/68"
              onClick={() => askGuide(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={guideDraft}
            maxLength={120}
            placeholder="Ask Ranger info..."
            className="min-h-10 min-w-0 flex-1 rounded-md border border-white/12 bg-black/24 px-3 text-sm font-semibold text-white outline-none placeholder:text-white/32"
            onChange={(event) => setGuideDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") askGuide(guideDraft);
            }}
          />
          <button className="rounded-md bg-[#fbe764] px-3 text-xs font-black text-[#071018]" onClick={() => askGuide(guideDraft)}>
            Ask
          </button>
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/38">
          Fan info only. Verify official specs and local laws.
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {RANGER_STATS.map((stat) => (
          <div key={stat.label} className="rounded-md border border-white/10 bg-white/[0.05] p-2">
            <div className="text-[9px] font-black uppercase tracking-[0.12em] text-white/42">{stat.label}</div>
            <div className="mt-1 text-sm font-black text-white">{stat.value}</div>
            <div className="mt-1 text-[10px] font-semibold leading-4 text-white/48">{stat.detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/46">
          <Sparkles size={13} />
          why riders like it
        </div>
        <div className="mt-2 space-y-2">
          {RANGER_FUN_FACTS.map((fact) => (
            <div key={fact} className="rounded-md border border-white/8 bg-black/18 px-3 py-2 text-xs font-semibold leading-5 text-white/66">
              {fact}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-white/10 bg-[#02070c]/42 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/46">
            <Play size={12} />
            watch previews
          </div>
          <button className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-[#7cf2ff]" onClick={() => onOpen("https://www.youtube.com/results?search_query=Kingbull+Ranger+ebike+review")}>
            More <ExternalLink size={11} />
          </button>
        </div>
        <div className="space-y-2">
          {RANGER_VIDEOS.slice(0, 2).map((video) => (
            <div key={video.id} className="overflow-hidden rounded-md border border-white/10 bg-black/24">
              <VideoPreviewButton
                id={video.id}
                title={video.title}
                subtitle={video.channel}
                aspect="video"
                onOpen={() => onOpen(`https://www.youtube.com/watch?v=${video.id}`)}
              />
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-white">{video.title}</div>
                  <div className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/40">{video.channel}</div>
                </div>
                <button className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-white/12 bg-white/8 px-2 text-[9px] font-black uppercase text-white/70" onClick={() => onOpen(`https://www.youtube.com/watch?v=${video.id}`)}>
                  Open <ExternalLink size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-white/10 bg-[#02070c]/42 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/46">
            <Sparkles size={12} />
            shorts
          </div>
          <button className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-[#7cf2ff]" onClick={() => onOpen("https://www.youtube.com/results?search_query=Kingbull+Ranger+shorts")}>
            More <ExternalLink size={11} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {RANGER_SHORTS.map((video) => (
            <div key={video.id} className="overflow-hidden rounded-md border border-white/10 bg-black/24">
              <VideoPreviewButton
                id={video.id}
                title={video.title}
                subtitle="Short"
                aspect="short"
                onOpen={() => onOpen(`https://www.youtube.com/shorts/${video.id}`)}
              />
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <div className="min-w-0 truncate text-[10px] font-black text-white">{video.title}</div>
                <button className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-white/12 bg-white/8 px-2 text-[8px] font-black uppercase text-white/70" onClick={() => onOpen(`https://www.youtube.com/shorts/${video.id}`)}>
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="min-h-11 rounded-md border border-white/12 bg-white/8 px-3 text-left active:scale-[0.98]" onClick={() => onOpen(KINGBULL_RANGER_URL)}>
          <span className="block text-[9px] font-black uppercase tracking-[0.12em] text-[#7cf2ff]">affiliate</span>
          <span className="mt-1 block text-xs font-black text-white">Ranger link</span>
        </button>
        <button className="min-h-11 rounded-md border border-white/12 bg-white/8 px-3 text-left active:scale-[0.98]" onClick={() => onOpen(KINGBULL_REDDIT_SEARCH_URL)}>
          <span className="block text-[9px] font-black uppercase tracking-[0.12em] text-[#fbe764]">community</span>
          <span className="mt-1 block text-xs font-black text-white">Reddit search</span>
        </button>
      </div>

      <div className="mt-3 rounded-md border border-[#ff5d73]/24 bg-[#ff5d73]/10 p-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#ff9aac]">
          <ShieldCheck size={13} />
          fan page terms
        </div>
        <div className="mt-1 text-[11px] font-semibold leading-4 text-white/60">
          CasterCycle is not affiliated with, sponsored by, or endorsed by Kingbull. Specs, prices, promotions, laws, and availability can change. Promo buttons may be affiliate links that compensate us. Verify with Kingbull, inspect the bike, wear proper safety gear, and follow local e-bike rules. No legal, safety, purchase, warranty, or fitness-for-use advice.
        </div>
      </div>
    </div>
  );
}

function VideoPreviewButton({
  id,
  title,
  subtitle,
  aspect,
  onOpen,
}: {
  id: string;
  title: string;
  subtitle: string;
  aspect: "video" | "short";
  onOpen: () => void;
}) {
  return (
    <button
      className={`group relative block w-full overflow-hidden bg-[#071018] text-left active:scale-[0.99] ${aspect === "short" ? "aspect-[9/16]" : "aspect-video"}`}
      style={{
        backgroundImage: `linear-gradient(180deg,rgba(7,16,24,0.04),rgba(7,16,24,0.78)),url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
      onClick={onOpen}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fbe764] text-[#071018] shadow-[0_14px_34px_rgba(0,0,0,0.34)] transition group-active:scale-95">
          <Play size={22} fill="currentColor" />
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 p-2">
        <span className="block truncate text-xs font-black text-white">{title}</span>
        <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/58">{subtitle}</span>
      </span>
    </button>
  );
}

function PassCompareGrid({
  plan,
  dayActive,
  annualActive,
  onPlan,
}: {
  plan: PassPlan;
  dayActive: boolean;
  annualActive: boolean;
  onPlan: (plan: PassPlan) => void;
}) {
  const cards = [
    {
      id: "free",
      title: "Free",
      price: "$0",
      detail: "30s preview",
      perks: ["Community", "State Park", "Dash"],
      active: false,
      select: undefined,
    },
    {
      id: "day",
      title: "Day",
      price: "$1",
      detail: dayActive ? "Active" : "Today",
      perks: ["Unlimited", "E-Bike Land", "Skyline"],
      active: plan === "day",
      select: "day" as PassPlan,
    },
    {
      id: "life",
      title: "Lifetime",
      price: "$7",
      detail: annualActive ? "Active" : "Best value",
      perks: ["All worlds", "Lounge", "Future worlds"],
      active: plan === "lifetime",
      select: "lifetime" as PassPlan,
    },
  ];

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/46">
        <ShieldCheck size={13} />
        compare pass
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {cards.map((card) => (
          <button
            key={card.id}
            className={`min-h-[118px] rounded-md border px-2 py-2 text-left transition active:scale-[0.98] ${
              card.active ? "border-[#fbe764]/80 bg-[#fbe764]/16" : "border-white/10 bg-black/16"
            } ${!card.select ? "opacity-78" : ""}`}
            onClick={() => {
              if (card.select) onPlan(card.select);
            }}
          >
            <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-white/42">{card.title}</span>
            <span className="mt-1 block text-lg font-black leading-none text-white">{card.price}</span>
            <span className="mt-1 block truncate text-[9px] font-black uppercase tracking-[0.06em] text-[#fbe764]">{card.detail}</span>
            <span className="mt-2 block space-y-1">
              {card.perks.map((perk) => (
                <span key={perk} className="block truncate text-[9px] font-bold text-white/58">
                  {perk}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UpgradePanel({
  isPro,
  dayActive,
  annualActive,
  urgent,
  onConnect,
  onEthSupport,
  onPassPurchased,
  onVoiceInfo,
}: {
  isPro: boolean;
  dayActive: boolean;
  annualActive: boolean;
  urgent: boolean;
  onConnect: () => void;
  onEthSupport: () => void;
  onPassPurchased: (plan: PassPlan) => void;
  onVoiceInfo: () => void;
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [plan, setPlan] = useState<PassPlan>("day");
  const [pendingPlan, setPendingPlan] = useState<PassPlan | null>(null);
  const [step, setStep] = useState<"idle" | "buying">("idle");
  const price = BigInt(plan === "day" ? DAY_PRICE : YEARLY_PRICE);
  const priceLabel = plan === "day" ? "$1 day" : "$7 lifetime";

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
  const selectedPlanActive = plan === "day" ? dayActive : annualActive;
  const needsWalletAddress = !address;

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
      args: [TREASURY_ADDRESS, BigInt(plan === "day" ? DAY_PRICE : YEARLY_PRICE)],
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
    <div className="mt-4 rounded-md border border-[#fbe764]/30 bg-[linear-gradient(135deg,rgba(251,231,100,0.14),rgba(124,242,255,0.07)_52%,rgba(162,255,154,0.09))] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">
            <Crown size={13} />
            Cycle Pass
          </div>
          <div className="mt-1 text-xl font-black leading-tight text-white">{urgent ? "Keep the ride going" : "Unlimited park riding"}</div>
          <div className="mt-1 text-xs font-semibold leading-4 text-white/64">
            {urgent ? "Your free session ended. A day pass resumes unlimited Freestyle today." : "30 seconds free. Pass unlocks E-Bike Land, Skyline Circuit, Glow Track, and the lounge."}
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
      <PassCompareGrid plan={plan} dayActive={dayActive} annualActive={annualActive} onPlan={setPlan} />
      <div className="mt-3 rounded-md border border-[#ff7adf]/28 bg-[#ff7adf]/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#ff9ee6]">
              <Zap size={13} />
              Premium worlds
            </div>
            <div className="mt-1 truncate text-sm font-black text-white">Glow park plus rooftop circuit</div>
          </div>
          <div className="shrink-0 rounded bg-black/24 px-2 py-1 text-[10px] font-black uppercase text-[#fbe764]">included</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {[
            ["15", "spots"],
            ["boost", "pads"],
            ["roof", "lines"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-md border border-white/10 bg-black/16 px-2 py-2 text-center">
              <div className="text-sm font-black text-white">{value}</div>
              <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/42">{label}</div>
            </div>
          ))}
        </div>
      </div>
      <button
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#fbe764] px-3 text-sm font-black text-[#071018] shadow-[0_14px_28px_rgba(251,231,100,0.18)] disabled:opacity-60"
        disabled={!needsWalletAddress && (!hasEnough || busy || !treasuryReady || selectedPlanActive)}
        onClick={purchase}
      >
        <Wallet size={15} />
        {needsWalletAddress
          ? "Continue in Farcaster"
            : selectedPlanActive
            ? plan === "day" ? "Day Active" : "Lifetime Active"
            : !treasuryReady
              ? "Set treasury address"
              : chainId !== BASE_CHAIN_ID
                ? "Confirm network"
              : busy
                ? "Confirming"
                : hasEnough
                  ? `Approve ${priceLabel}`
                  : "Need USDC"}
      </button>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded-md border border-white/10 bg-black/14 px-2 py-1.5 text-center">
          <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/36">wallet</div>
          <div className="text-[10px] font-black text-white">Farcaster</div>
        </div>
        <div className="rounded-md border border-white/10 bg-black/14 px-2 py-1.5 text-center">
          <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/36">pay</div>
          <div className="text-[10px] font-black text-white">USDC</div>
        </div>
        <div className="rounded-md border border-white/10 bg-black/14 px-2 py-1.5 text-center">
          <div className="text-[8px] font-black uppercase tracking-[0.08em] text-white/36">unlock</div>
          <div className="text-[10px] font-black text-white">Instant</div>
        </div>
      </div>
      <div className="mt-2 rounded-md border border-[#7cf2ff]/18 bg-[#7cf2ff]/8 px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#7cf2ff]">
          <ShieldCheck size={13} />
          payment trust
        </div>
        <div className="mt-1 text-[11px] font-semibold leading-4 text-white/58">
          Farcaster opens the wallet approval only when you tap buy. Payment goes directly to treasury, and CasterCycle remembers your pass locally.
        </div>
      </div>
      <button
        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#7cf2ff]/45 bg-[#7cf2ff]/15 px-3 text-xs font-black text-white disabled:opacity-60"
        disabled={!needsWalletAddress && (!treasuryReady || busy)}
        onClick={supportWithEth}
      >
        <Sparkles size={15} />
        {needsWalletAddress ? "Continue in Farcaster" : !treasuryReady ? "Set treasury address" : chainId !== BASE_CHAIN_ID ? "Confirm network" : sendingEth || confirmingEth ? "Confirming ETH" : `Support ${ETH_SUPPORT_AMOUNT} ETH`}
      </button>
      <div className="mt-2 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/42">
        Treasury {TREASURY_ADDRESS}
      </div>
    </div>
  );
}

function PassHistoryPanel({
  receipts,
  dayActive,
  annualActive,
  passUntil,
}: {
  receipts: PassReceipt[];
  dayActive: boolean;
  annualActive: boolean;
  passUntil: number;
}) {
  return (
    <div className="mt-3 rounded-md border border-white/12 bg-white/7 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/52">
            <ShieldCheck size={13} />
            Pass receipt
          </div>
          <div className="mt-1 text-sm font-black text-white">
            {annualActive ? "Lifetime unlocked" : dayActive ? `Day pass ${formatPassExpiry(passUntil)}` : "No active pass"}
          </div>
        </div>
        {(dayActive || annualActive) && <CheckCircle2 size={20} className="text-[#a2ff9a]" />}
      </div>
      <div className="mt-2 space-y-1.5">
        {receipts.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-black/16 px-2 py-2 text-xs font-semibold text-white/46">Purchases appear here after wallet confirmation.</div>
        ) : (
          receipts.slice(0, 3).map((receipt) => (
            <div key={`${receipt.plan}-${receipt.purchasedAt}`} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/16 px-2 py-2">
              <div className="truncate text-xs font-black text-white">{receipt.txLabel}</div>
              <div className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-white/44">
                {receipt.plan === "lifetime" ? "lifetime" : formatPassExpiry(receipt.validUntil)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LegalDisclosurePanel({ onOpenTerms }: { onOpenTerms: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-[#ff5d73]/24 bg-[#ff5d73]/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#ff9aac]">
            <ShieldCheck size={13} />
            terms snapshot
          </div>
          <div className="mt-1 text-sm font-black text-white">Ride for fun. You stay in control.</div>
        </div>
        <button
          className="shrink-0 rounded-md border border-white/12 bg-white/8 px-2 py-1 text-[9px] font-black uppercase text-white/64"
          onClick={onOpenTerms}
        >
          Full terms
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[
          ["No advice", "No financial, tax, legal, safety, or purchase advice."],
          ["Passes", "Optional passes unlock play time only."],
          ["Your wallet", "You approve transactions, pay gas, manage taxes, and follow local rules."],
          ["No rewards", "No payout, prize, resale, or redemption promise."],
        ].map(([title, detail]) => (
          <div key={title} className="rounded-md border border-white/10 bg-black/16 px-2 py-2">
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-white/46">{title}</div>
            <div className="mt-0.5 text-[10px] font-semibold leading-4 text-white/58">{detail}</div>
          </div>
        ))}
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

function drawFreeRideScene(ctx: CanvasRenderingContext2D, width: number, height: number, free: FreeRideModel, skin: Skin, unlimited: boolean, now: number) {
  ctx.save();
  const nextSpot = nextFreeRideSpot(free);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, free.area === "skyline" ? "#15183f" : free.area === "bikeLand" ? "#372064" : free.area === "statePark" ? "#5f95be" : "#70b7e7");
  sky.addColorStop(0.38, free.area === "skyline" ? "#405dba" : free.area === "bikeLand" ? "#35c6b7" : free.area === "statePark" ? "#88cfa1" : "#8ed47b");
  sky.addColorStop(1, free.area === "skyline" ? "#101923" : free.area === "bikeLand" ? "#182148" : free.area === "statePark" ? "#245a42" : "#2f744f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height * 0.56);
  ctx.scale(width < 440 ? 0.74 : 0.82, width < 440 ? 0.74 : 0.82);
  ctx.translate(-free.x, -free.y);
  drawFreestyleMap(ctx, now, free);
  if (nextSpot) drawFreeRideTargetTrail(ctx, free, nextSpot, now);
  ctx.restore();

  drawFreeRideMotionFx(ctx, width / 2, height * 0.56, free, skin, now);
  drawFreeRidePlayer(ctx, width / 2, height * 0.56, free.heading, skin, now);

  if (free.messageT > 0 && free.message) {
    ctx.save();
    const alpha = clamp(free.messageT, 0, 1);
    const cardW = Math.min(width - 52, 270);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(7,16,24,0.68)";
    ctx.strokeStyle = skin.trail;
    ctx.lineWidth = 1.5;
    roundRect(ctx, width / 2 - cardW / 2, height * 0.23, cardW, 42, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(free.message.toUpperCase(), width / 2, height * 0.23 + 21);
    ctx.restore();
  }

  const compassX = width - 52;
  const compassY = height * 0.2;
  ctx.save();
  ctx.translate(compassX, compassY);
  ctx.fillStyle = "rgba(7,16,24,0.58)";
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(free.heading + Math.PI / 2);
  ctx.fillStyle = "#fbe764";
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(9, 9);
  ctx.lineTo(0, 4);
  ctx.lineTo(-9, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (nextSpot) {
    const angle = Math.atan2(nextSpot.y - free.y, nextSpot.x - free.x);
    const turn = angle - free.heading;
    ctx.save();
    ctx.translate(compassX, compassY + 50);
    ctx.fillStyle = "rgba(7,16,24,0.58)";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    roundRect(ctx, -58, -23, 116, 48, 9);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(turn);
    ctx.fillStyle = nextSpot.color;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-turn);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${nextSpot.short} ${Math.round(nextSpot.distance)}m`, 0, 16);
    ctx.restore();
  }

  drawFreeRideMiniMap(ctx, width, height, free, unlimited);

  drawVignette(ctx, width, height, { boost: clamp(free.speed / 420, 0, 1) } as GameModel);
  ctx.restore();
}

function drawFreeRideMiniMap(ctx: CanvasRenderingContext2D, width: number, height: number, free: FreeRideModel, unlimited: boolean) {
  const mapW = Math.min(136, width * 0.28);
  const mapH = mapW;
  const x = width - mapW - 14;
  const y = height * 0.31;
  const scale = mapW / (FREE_RIDE_WORLD_LIMIT * 2);

  ctx.save();
  ctx.fillStyle = "rgba(7,16,24,0.62)";
  ctx.strokeStyle = unlimited ? "rgba(162,255,154,0.72)" : "rgba(251,231,100,0.7)";
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, mapW, mapH, 12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  roundRect(ctx, x, y, mapW, mapH, 12);
  ctx.clip();

  ctx.strokeStyle = "rgba(159,242,138,0.42)";
  ctx.lineWidth = 4;
  for (const path of FREE_RIDE_PATHS) {
    ctx.beginPath();
    path.forEach(([px, py], index) => {
      const sx = x + mapW / 2 + px * scale;
      const sy = y + mapH / 2 + py * scale;
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }

  for (const spot of freeRideSpots(free.area)) {
    if (spot.name === "Trailhead") continue;
    ctx.fillStyle = spot.color;
    ctx.beginPath();
    ctx.arc(x + mapW / 2 + spot.x * scale, y + mapH / 2 + spot.y * scale, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#fbe764";
  ctx.strokeStyle = "#101923";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + mapW / 2 + free.x * scale, y + mapH / 2 + free.y * scale, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFreestyleMap(ctx: CanvasRenderingContext2D, now: number, free: FreeRideModel) {
  const bikeLand = free.area === "bikeLand";
  const skyline = free.area === "skyline";
  const premium = bikeLand || skyline;
  ctx.fillStyle = skyline ? "#202a54" : bikeLand ? "#263566" : free.area === "statePark" ? "#4f9b66" : "#69bd68";
  ctx.fillRect(-FREE_RIDE_WORLD_LIMIT, -FREE_RIDE_WORLD_LIMIT, FREE_RIDE_WORLD_LIMIT * 2, FREE_RIDE_WORLD_LIMIT * 2);

  ctx.strokeStyle = premium ? "rgba(124,242,255,0.14)" : "rgba(13,61,50,0.18)";
  ctx.lineWidth = 2;
  for (let x = -FREE_RIDE_WORLD_LIMIT; x <= FREE_RIDE_WORLD_LIMIT; x += 160) {
    ctx.beginPath();
    ctx.moveTo(x, -FREE_RIDE_WORLD_LIMIT);
    ctx.lineTo(x, FREE_RIDE_WORLD_LIMIT);
    ctx.stroke();
  }
  for (let y = -FREE_RIDE_WORLD_LIMIT; y <= FREE_RIDE_WORLD_LIMIT; y += 160) {
    ctx.beginPath();
    ctx.moveTo(-FREE_RIDE_WORLD_LIMIT, y);
    ctx.lineTo(FREE_RIDE_WORLD_LIMIT, y);
    ctx.stroke();
  }

  if (free.area === "statePark") {
    ctx.save();
    ctx.strokeStyle = "rgba(241,255,215,0.18)";
    ctx.lineWidth = 5;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      ctx.ellipse(-620 + i * 210, -1180 + i * 42, 390 + i * 35, 130 + i * 18, -0.18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (free.area === "bikeLand") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,122,223,0.3)";
    ctx.lineWidth = 7;
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-FREE_RIDE_WORLD_LIMIT, i * 420);
      ctx.lineTo(FREE_RIDE_WORLD_LIMIT, i * 420 + 260);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (free.area === "skyline") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(124,242,255,0.22)";
    ctx.lineWidth = 6;
    for (let i = -4; i <= 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-FREE_RIDE_WORLD_LIMIT, i * 380 - 180);
      ctx.lineTo(FREE_RIDE_WORLD_LIMIT, i * 380 + 180);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(251,231,100,0.24)";
    ctx.lineWidth = 4;
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 520, -FREE_RIDE_WORLD_LIMIT);
      ctx.lineTo(i * 520 + 220, FREE_RIDE_WORLD_LIMIT);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.strokeStyle = premium ? "rgba(124,242,255,0.74)" : "#5fcbea";
  ctx.lineWidth = 42;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1660, 980);
  ctx.bezierCurveTo(-1360, 760, -1120, 690, -1260, 520);
  ctx.bezierCurveTo(-760, 270, -560, 650, -160, 390);
  ctx.bezierCurveTo(260, 116, 530, 340, 1180, 120);
  ctx.bezierCurveTo(1390, -20, 1450, -210, 1580, -320);
  ctx.stroke();

  if (free.area === "statePark") {
    ctx.strokeStyle = "rgba(183,138,79,0.9)";
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    for (const [x, y, rot] of [
      [-470, 472, -0.22],
      [350, 245, 0.18],
      [870, 222, -0.16],
    ] as [number, number, number][]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-90, 0);
      ctx.lineTo(90, 0);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-70, -10);
      ctx.lineTo(70, -10);
      ctx.moveTo(-70, 10);
      ctx.lineTo(70, 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.strokeStyle = skyline ? "#151d40" : bikeLand ? "#182148" : "#314f46";
  ctx.lineWidth = premium ? 38 : 34;
  for (const path of FREE_RIDE_PATHS) {
    ctx.beginPath();
    path.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.strokeStyle = skyline ? "#7cf2ff" : bikeLand ? "#ff7adf" : "#fbe764";
  ctx.lineWidth = premium ? 5 : 4;
  ctx.setLineDash(premium ? [20, 22] : [28, 34]);
  for (const path of FREE_RIDE_PATHS) {
    ctx.beginPath();
    path.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (!premium || free.area === "statePark") {
    drawFreestyleCourt(ctx, -760, -530, 300, 190, "#c9d4d7", "SKATE");
    drawFreestyleCourt(ctx, 610, -500, 260, 160, "#d46a43", "HOOPS");
    drawFreestyleCourt(ctx, 285, -540, 260, 150, "#3da06f", "TENNIS");
    drawFreestyleCourt(ctx, 760, 360, 420, 235, "#4a9b44", "SOCCER");
    drawFreestyleCourt(ctx, -560, 420, 260, 160, "#206857", "STREAM");
    drawFreestyleCourt(ctx, -1660, 1460, 340, 170, "#c97845", "MARKET");
    drawFreestyleCourt(ctx, 1680, 1480, 360, 180, "#c77d4b", "SUNSET");
    drawFreestyleCourt(ctx, 110, -980, 280, 190, "#2e714d", "PINES");
    drawFreestyleCourt(ctx, -1180, -1320, 360, 230, "#8bcf5c", "MEADOW");
    drawFreestyleCourt(ctx, -1280, 1040, 360, 150, "#b8844d", "BOARDS");
    drawFreestyleCourt(ctx, 1280, 880, 360, 220, "#ce6847", "PUMP");
    drawFreestyleCourt(ctx, 1150, -1360, 320, 180, "#7ebf8f", "LOOKOUT");
    drawFreestyleCourt(ctx, -250, 1360, 300, 210, "#d9699b", "GARDEN");
  }
  if (free.area === "statePark") {
    drawFreestyleCourt(ctx, -1720, 260, 330, 180, "#3e9fa7", "FALLS");
    drawFreestyleCourt(ctx, 1640, -1640, 340, 190, "#77b96e", "SWITCH");
  }
  if (free.area === "bikeLand") {
    drawFreestyleCourt(ctx, -1680, -1520, 360, 220, "#35f6c8", "VOLT");
    drawFreestyleCourt(ctx, 1720, 430, 330, 170, "#ff7adf", "LASER");
    drawFreestyleCourt(ctx, 220, 1660, 360, 180, "#fbe764", "SKYLINE");
  }
  if (free.area === "skyline") {
    drawFreestyleCourt(ctx, -1180, -980, 380, 190, "#25478d", "CIRCUIT");
    drawFreestyleCourt(ctx, 740, -1180, 340, 170, "#b9a958", "ROOF");
    drawFreestyleCourt(ctx, 1320, 240, 360, 150, "#4fbf9f", "GLASS");
    drawFreestyleCourt(ctx, -1340, 520, 340, 190, "#cf633a", "METRO");
    drawFreestyleCourt(ctx, 420, 1540, 310, 170, "#7768d7", "DRONE");
    drawFreestyleCourt(ctx, 1680, -760, 300, 210, "#b852a7", "BEACON");
    drawFreestyleCourt(ctx, -180, 880, 320, 190, "#35a581", "GARDEN");
  }
  drawAreaLandmarks(ctx, free, now);
  drawFreestyleTerrainDetails(ctx, now, free);

  for (const spot of freeRideSpots(free.area)) {
    if (spot.name === "Trailhead") continue;
    drawFreestyleBoostPad(ctx, spot.x, spot.y, spot.color, free.visitedZones.includes(spot.name), now);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(251,231,100,0.38)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.setLineDash([18, 28]);
  ctx.beginPath();
  ctx.moveTo(-1180, -1040);
  ctx.bezierCurveTo(-760, -850, -340, -1160, 80, -980);
  ctx.bezierCurveTo(420, -830, 770, -1040, 1010, -890);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = skyline ? "#142354" : "#1e6a42";
  for (let i = 0; i < 140; i += 1) {
    const x = ((i * 173) % (FREE_RIDE_WORLD_LIMIT * 2 - 120)) - FREE_RIDE_WORLD_LIMIT + 60;
    const y = ((i * 311) % (FREE_RIDE_WORLD_LIMIT * 2 - 120)) - FREE_RIDE_WORLD_LIMIT + 60;
    if (Math.abs(x) < 95 || Math.abs(y) < 95) continue;
    const r = 10 + ((i * 7) % 16);
    if (skyline) {
      roundRect(ctx, x - r * 0.6, y - r * 1.4, r * 1.2, r * 2.4, 3);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x + Math.sin(now / 900 + i) * 1.8, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = "rgba(255,122,223,0.78)";
  ctx.lineWidth = 12;
  ctx.shadowColor = "#ff7adf";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(1010, -890, 170, 100, -0.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  drawFreestyleLabel(ctx, 1010, -890, "E-BIKE LAND");
}

function drawFreeRideTargetTrail(
  ctx: CanvasRenderingContext2D,
  free: FreeRideModel,
  nextSpot: (typeof FREE_RIDE_SPOTS)[number] & { distance: number },
  now: number,
) {
  const angle = Math.atan2(nextSpot.y - free.y, nextSpot.x - free.x);
  const distance = Math.min(nextSpot.distance, 760);
  const steps = Math.max(3, Math.min(9, Math.floor(distance / 82)));

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 1; index <= steps; index += 1) {
    const t = index / (steps + 1);
    const pulse = 0.55 + Math.sin(now / 180 + index * 0.8) * 0.45;
    const x = free.x + Math.cos(angle) * distance * t;
    const y = free.y + Math.sin(angle) * distance * t;
    ctx.fillStyle = index === steps ? nextSpot.color : `rgba(251,231,100,${0.18 + pulse * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, 10 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = `${nextSpot.color}88`;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 24]);
  ctx.beginPath();
  ctx.moveTo(free.x + Math.cos(angle) * 80, free.y + Math.sin(angle) * 80);
  ctx.lineTo(free.x + Math.cos(angle) * distance, free.y + Math.sin(angle) * distance);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawFreeRideMotionFx(ctx: CanvasRenderingContext2D, x: number, y: number, free: FreeRideModel, skin: Skin, now: number) {
  const speed = clamp(free.speed / 305, 0, 1);
  const pedal = clamp(free.pedalPower, 0, 1);
  const dustColor = free.terrain === "Stream" ? "rgba(124,242,255," : free.terrain === "Path" || free.terrain === "Boardwalk" ? "rgba(251,231,100," : "rgba(214,255,180,";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(free.heading);
  ctx.globalCompositeOperation = "lighter";

  for (let index = 0; index < 9; index += 1) {
    const phase = (now / (150 - speed * 44) + index * 29) % 120;
    const back = 30 + phase * (0.75 + speed * 0.7);
    const side = Math.sin(now / 170 + index * 1.7) * (9 + speed * 12);
    ctx.fillStyle = `${dustColor}${0.08 + speed * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(-back, side, 4 + speed * 9, 2 + speed * 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = skin.trail;
  ctx.globalAlpha = 0.2 + pedal * 0.18;
  ctx.lineWidth = 3 + pedal * 3;
  ctx.lineCap = "round";
  for (let index = 0; index < 3; index += 1) {
    const offset = -13 + index * 13;
    ctx.beginPath();
    ctx.moveTo(-36, offset);
    ctx.quadraticCurveTo(-76 - speed * 44, offset * 1.2, -132 - speed * 70, offset * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAreaLandmarks(ctx: CanvasRenderingContext2D, free: FreeRideModel, now: number) {
  if (free.area === "park") {
    drawFreestyleCourt(ctx, -1080, -120, 250, 150, "#d58f53", "CAFE");
    drawFreestyleCourt(ctx, 1040, -80, 300, 190, "#7cc86a", "DOG RUN");
    drawFreestyleCourt(ctx, -920, 760, 310, 170, "#7a6cc8", "STAGE");
    drawFreestyleCourt(ctx, 420, 1120, 300, 150, "#dcb04c", "TRUCKS");

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(-920, 760, 48 + i * 23, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
    }
    ctx.fillStyle = "#ff5d73";
    for (let i = 0; i < 4; i += 1) {
      roundRect(ctx, 306 + i * 74, 1065, 52, 38, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  if (free.area === "statePark") {
    drawFreestyleCourt(ctx, -1440, -540, 300, 160, "#9b7347", "RANGER");
    drawFreestyleCourt(ctx, 780, -1220, 260, 150, "#8a633a", "CAMP");

    ctx.save();
    ctx.fillStyle = "rgba(95,202,234,0.68)";
    ctx.strokeStyle = "rgba(255,255,255,0.58)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(1380, 20, 280, 160, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawFreestyleLabel(ctx, 1380, 20, "LAKE");

    ctx.strokeStyle = "#c59a5d";
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(225, 224);
    ctx.lineTo(495, 276);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.48)";
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(650 + i * 46, -1288);
      ctx.lineTo(682 + i * 46, -1242);
      ctx.lineTo(618 + i * 46, -1242);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  if (free.area === "bikeLand") {
    drawFreestyleCourt(ctx, -960, -760, 360, 180, "#2158a6", "TUNNEL");
    drawFreestyleCourt(ctx, 1260, 1180, 360, 220, "#ce6847", "JUMPS");
    drawFreestyleCourt(ctx, -1180, 1180, 310, 190, "#d4c644", "CHARGE");
    drawFreestyleCourt(ctx, 1460, -320, 300, 170, "#7562d6", "GARAGE");

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i += 1) {
      ctx.strokeStyle = i % 2 ? "rgba(255,122,223,0.72)" : "rgba(124,242,255,0.72)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-1120 + i * 52, -830);
      ctx.lineTo(-980 + i * 42, -690);
      ctx.stroke();
    }

    ctx.strokeStyle = "#fbe764";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i += 1) {
      const x = 1120 + i * 58;
      const lift = Math.sin(now / 170 + i) * 5;
      ctx.beginPath();
      ctx.moveTo(x - 42, 1180 + lift);
      ctx.quadraticCurveTo(x - 10, 1118 + lift, x + 34, 1180 + lift);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(251,231,100,0.75)";
    ctx.lineWidth = 6;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(-1180, 1180, 58 + i * 28 + Math.sin(now / 240 + i) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (free.area === "skyline") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(124,242,255,0.76)";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(1120, 240);
    ctx.lineTo(1520, 240);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.46)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      ctx.moveTo(1120 + i * 64, 206);
      ctx.lineTo(1120 + i * 64, 274);
      ctx.stroke();
    }

    ctx.strokeStyle = "#fbe764";
    ctx.lineWidth = 7;
    for (let i = 0; i < 5; i += 1) {
      const lift = Math.sin(now / 180 + i) * 5;
      ctx.beginPath();
      ctx.moveTo(608 + i * 58, -1180 + lift);
      ctx.quadraticCurveTo(632 + i * 58, -1240 + lift, 678 + i * 58, -1180 + lift);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,122,223,0.72)";
    ctx.lineWidth = 5;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(1680, -760, 54 + i * 30 + Math.sin(now / 240 + i) * 4, -0.4, Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFreestyleTerrainDetails(ctx: CanvasRenderingContext2D, now: number, free: FreeRideModel) {
  ctx.save();

  ctx.strokeStyle = "rgba(69,43,22,0.52)";
  ctx.lineWidth = 5;
  for (let i = -4; i <= 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-1430 + i * 36, 990);
    ctx.lineTo(-1130 + i * 36, 1090);
    ctx.stroke();
  }

  ctx.strokeStyle = "#fbe764";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  for (let i = 0; i < 5; i += 1) {
    const x = 1160 + i * 60;
    const lift = Math.sin(now / 220 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(x - 46, 880 + lift);
    ctx.quadraticCurveTo(x - 20, 824 + lift, x + 8, 880 + lift);
    ctx.quadraticCurveTo(x + 30, 928 + lift, x + 56, 880 + lift);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  for (let i = 0; i < 28; i += 1) {
    const x = -360 + ((i * 47) % 230);
    const y = 1260 + ((i * 71) % 190);
    ctx.beginPath();
    ctx.arc(x, y, 4 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  if (free.area === "statePark") {
    ctx.strokeStyle = "rgba(255,255,255,0.38)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      ctx.ellipse(1150, -1360, 140 + i * 28, 58 + i * 13, -0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (free.area === "bikeLand") {
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,122,223,0.72)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(1010, -890, 230, 0.2, Math.PI * 1.72);
    ctx.stroke();
  }

  if (free.area === "skyline") {
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(124,242,255,0.7)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(-1180, -980, 240, -0.2, Math.PI * 1.65);
    ctx.stroke();
    ctx.strokeStyle = "rgba(196,181,253,0.62)";
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(340 + i * 34, 1484);
      ctx.lineTo(500 + i * 42, 1592);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawFreestyleBoostPad(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, visited: boolean, now: number) {
  const pulse = 0.5 + Math.sin(now / 180 + x * 0.01) * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = color;
  ctx.fillStyle = visited ? `${color}40` : `${color}24`;
  ctx.lineWidth = visited ? 7 : 5;
  ctx.shadowColor = color;
  ctx.shadowBlur = visited ? 18 : 10;
  ctx.beginPath();
  ctx.ellipse(0, 0, 58 + pulse * 10, 28 + pulse * 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-4, -12);
  ctx.lineTo(-8, -2);
  ctx.lineTo(18, -2);
  ctx.stroke();
  ctx.restore();
}

function drawFreestyleCourt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, label: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 5;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 12);
  ctx.fill();
  ctx.stroke();
  drawFreestyleLabel(ctx, x, y, label);
}

function drawFreestyleLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.fillStyle = "rgba(7,16,24,0.72)";
  roundRect(ctx, x - 64, y - 21, 128, 42, 8);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 1);
}

function drawFreeRidePlayer(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, skin: Skin, now: number) {
  const pulse = 0.5 + Math.sin(now / 130) * 0.5;
  const lean = Math.sin(now / 180) * 0.04;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + lean);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = skin.trail;
  ctx.globalAlpha = 0.28 + pulse * 0.18;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-36, -7);
  ctx.quadraticCurveTo(-78, -15, -126, -6);
  ctx.moveTo(-36, 7);
  ctx.quadraticCurveTo(-78, 15, -126, 6);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 12, 46, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `${skin.battery}44`;
  ctx.beginPath();
  ctx.moveTo(34, 0);
  ctx.lineTo(86, -18);
  ctx.lineTo(86, 18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(-30, 0, 13, 20, 0, 0, Math.PI * 2);
  ctx.ellipse(35, 0, 13, 20, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(7,16,24,0.82)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-30, 0, 6, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(35, 0, 6, 12, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = skin.frame;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-2, -14);
  ctx.lineTo(34, 0);
  ctx.lineTo(-2, 14);
  ctx.closePath();
  ctx.moveTo(18, -15);
  ctx.lineTo(42, -19);
  ctx.moveTo(18, 15);
  ctx.lineTo(42, 19);
  ctx.stroke();

  ctx.fillStyle = skin.battery;
  roundRect(ctx, -12, -10, 29, 20, 6);
  ctx.fill();
  ctx.strokeStyle = "#071018";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(2, 0, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.rotate(now / 95);
  ctx.strokeStyle = "#fbe764";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#071018";
  ctx.globalAlpha = 0.36;
  roundRect(ctx, -5, -5, 14, 10, 4);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#f6d2a8";
  ctx.beginPath();
  ctx.arc(2, -4, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#16212c";
  ctx.beginPath();
  ctx.ellipse(-6, 0, 10, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin.trail;
  ctx.beginPath();
  ctx.ellipse(7, -4, 12 + pulse * 1.5, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fbe764";
  ctx.beginPath();
  ctx.arc(50, 0, 4 + pulse * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, skin: Skin, now: number) {
  ctx.save();
  if (game.shake > 0) {
    const pulse = Math.sin(now * 0.08) * game.shake * 7;
    ctx.translate(pulse, Math.cos(now * 0.07) * game.shake * 4);
  }

  const chapter = raceChapter(game);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, chapter.skyTop);
  sky.addColorStop(0.54, chapter.skyBottom);
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
  const skyline = game.route.area === "skyline";
  const chapter = raceChapter(game);

  const grass = ctx.createLinearGradient(0, horizon, 0, height);
  grass.addColorStop(0, chapter.groundTop);
  grass.addColorStop(0.58, chapter.groundMid);
  grass.addColorStop(1, chapter.groundBottom);
  ctx.fillStyle = grass;
  ctx.fillRect(0, horizon, width, height - horizon);

  if (statePark || bikeLand || skyline) {
    ctx.fillStyle = skyline ? "rgba(25,38,83,0.76)" : "rgba(48,88,82,0.7)";
    ctx.beginPath();
    ctx.moveTo(0, skyline ? horizon + 90 : horizon + 54);
    ctx.lineTo(width * 0.18, skyline ? horizon + 20 : horizon - 8);
    ctx.lineTo(width * 0.32, skyline ? horizon + 74 : horizon + 54);
    ctx.lineTo(width * 0.52, skyline ? horizon - 16 : horizon - 18);
    ctx.lineTo(width * 0.72, skyline ? horizon + 60 : horizon + 40);
    ctx.lineTo(width, skyline ? horizon + 16 : horizon + 58);
    ctx.lineTo(width, horizon + 110);
    ctx.lineTo(0, horizon + 110);
    ctx.closePath();
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = statePark ? 0.72 : 0.62;
  ctx.strokeStyle = skyline ? "rgba(124,242,255,0.72)" : bikeLand ? "rgba(255,122,223,0.68)" : statePark ? "rgba(124,242,255,0.72)" : "rgba(95,202,234,0.66)";
  ctx.lineWidth = skyline ? 10 : bikeLand ? 14 : statePark ? 18 : 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 9; i += 1) {
    const y = horizon + i * ((height - horizon) / 8);
    const x = width * (statePark ? 0.18 : skyline ? 0.48 : 0.82) + Math.sin(i * 1.1 + now / 1600) * width * (skyline ? 0.18 : 0.08);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  const labels = bikeLand
    ? ["PUMP", "VELO", "JUMPS", "SHOP", "CLUB", "GLOW"]
    : skyline
      ? ["ROOF", "GLASS", "METRO", "DRONE", "BEACON", "AERO"]
    : statePark
    ? ["RIVER", "PINES", "LOOKOUT", "MEADOW", "TRAIL"]
    : ["SKATE", "HOOPS", "TENNIS", "SOCCER", "PICNIC", "STREAM"];

  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i += 1) {
      const loop = (i * 190 - (game.distance * (skyline ? 0.86 : statePark ? 0.58 : 0.72)) % 190 + 190) % 190;
      const progress = loop / 190;
      const y = horizon + progress * (height - horizon);
      const scale = 0.28 + progress * 1.08;
      const x = width / 2 + side * (width * (0.24 + progress * 0.38));
      const label = labels[(i + chapter.index + (side > 0 ? 2 : 0)) % labels.length];
      ctx.save();
      ctx.translate(x, y - 58 * scale);
      ctx.rotate(side * (statePark ? -0.06 : skyline ? -0.08 : -0.1));
      ctx.scale(scale, scale);

      if (skyline) {
        drawSkylineFeature(ctx, label, game.route.roadEdge);
      } else if (bikeLand) {
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

  drawLandForeground(ctx, width, height, game, now);
}

function drawLandForeground(ctx: CanvasRenderingContext2D, width: number, height: number, game: GameModel, now: number) {
  const horizon = height * 0.25;
  const statePark = game.route.area === "statePark";
  const bikeLand = game.route.area === "bikeLand";
  const skyline = game.route.area === "skyline";
  const palette = skyline
    ? ["#7cf2ff", "#c4b5fd", "#fbe764"]
    : bikeLand
    ? ["#ff7adf", "#7cf2ff", "#fbe764"]
    : statePark
      ? ["#9ff28a", "#7cf2ff", "#fbe764"]
      : ["#fbe764", "#7cf2ff", "#a2ff9a"];

  ctx.save();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i += 1) {
      const loop = (i * 245 - (game.distance * (skyline ? 1.12 : bikeLand ? 1.02 : 0.82)) % 245 + 245) % 245;
      const p = loop / 245;
      if (p < 0.08) continue;
      const y = horizon + p * (height - horizon + 80);
      const scale = 0.32 + p * 1.55;
      const x = width / 2 + side * (width * (0.3 + p * 0.46));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = clamp(0.25 + p * 0.72, 0.22, 0.95);

      if (skyline) {
        ctx.fillStyle = "rgba(13,20,49,0.86)";
        roundRect(ctx, -24, -48, 48, 76, 5);
        ctx.fill();
        ctx.strokeStyle = palette[i % palette.length];
        ctx.lineWidth = 2;
        for (let w = -12; w <= 12; w += 12) {
          ctx.beginPath();
          ctx.moveTo(w, -38);
          ctx.lineTo(w, 20);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-34, -8);
        ctx.lineTo(34, -8);
        ctx.stroke();
      } else if (bikeLand) {
        ctx.strokeStyle = palette[i % palette.length];
        ctx.lineWidth = 3;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, -16, 22, Math.PI, 0);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(17,25,35,0.82)";
        roundRect(ctx, -28, 2, 56, 20, 6);
        ctx.fill();
      } else if (statePark) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(22,82,52,0.95)" : "rgba(31,106,66,0.86)";
        ctx.beginPath();
        ctx.moveTo(0, -48);
        ctx.lineTo(-22, 8);
        ctx.lineTo(22, 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(92,65,39,0.95)";
        ctx.fillRect(-4, 8, 8, 24);
        if (i % 3 === 0) {
          ctx.strokeStyle = "rgba(183,138,79,0.88)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(side * -24, 22);
          ctx.lineTo(side * 24, 8);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = i % 2 === 0 ? "rgba(36,85,68,0.9)" : "rgba(44,103,83,0.86)";
        roundRect(ctx, -30, 2, 60, 18, 5);
        ctx.fill();
        ctx.strokeStyle = palette[i % palette.length];
        ctx.lineWidth = 2;
        ctx.strokeRect(-22, -24, 44, 26);
        ctx.beginPath();
        ctx.arc(0, -11, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  if (game.phase === "riding") {
    const pulse = 0.5 + Math.sin(now / 220) * 0.5;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 10; i += 1) {
      const p = ((i * 73 + game.distance * 0.08) % 600) / 600;
      const x = width * (0.1 + ((i * 37) % 80) / 100);
      const y = horizon + p * (height - horizon);
      ctx.globalAlpha = 0.08 + pulse * 0.08;
      ctx.fillStyle = palette[i % palette.length];
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + p * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
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

function drawSkylineFeature(ctx: CanvasRenderingContext2D, label: string, accent: string) {
  ctx.fillStyle = "rgba(14,22,52,0.9)";
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, -40, -28, 80, 56, 7);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = label === "GLASS" ? "#a2ff9a" : label === "METRO" ? "#ff8b4a" : "#7cf2ff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (label === "BEACON") {
    ctx.moveTo(0, -24);
    ctx.lineTo(16, 18);
    ctx.lineTo(-16, 18);
    ctx.closePath();
  } else if (label === "DRONE") {
    ctx.arc(-14, -4, 9, 0, Math.PI * 2);
    ctx.moveTo(23, -4);
    ctx.arc(14, -4, 9, 0, Math.PI * 2);
    ctx.moveTo(-4, 8);
    ctx.lineTo(4, 8);
  } else {
    ctx.moveTo(-28, 12);
    ctx.lineTo(-8, -12);
    ctx.lineTo(10, 10);
    ctx.lineTo(30, -14);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, -2);
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
  const chapter = raceChapter(game);
  const road = ctx.createLinearGradient(0, horizon, 0, bottom);
  road.addColorStop(0, chapter.index === 2 ? "#284f55" : game.route.road);
  road.addColorStop(0.72, chapter.index === 3 ? "#26304e" : "#1f3147");
  road.addColorStop(1, chapter.index === 3 ? "#14152f" : "#101923");
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
  const comboGlow = Math.min(1, game.combo / 12);
  const chapter = raceChapter(game);

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

  ctx.globalAlpha = 0.56;
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i += 1) {
    const marker = i / 4;
    if (Math.abs(chapter.progress - marker) < 0.08) {
      const y = horizon + 46 + Math.sin(now / 180) * 2;
      ctx.beginPath();
      ctx.moveTo(width * 0.18, y + i * 7);
      ctx.lineTo(width * 0.82, y + i * 7);
      ctx.stroke();
    }
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
      entity.kind !== "battery" &&
      entity.kind !== "ring" &&
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
  } else if (entity.kind === "battery") {
    ctx.fillStyle = route.bolt;
    ctx.shadowColor = route.bolt;
    ctx.shadowBlur = 16;
    roundRect(ctx, -20, -22, 40, 34, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(17,25,35,0.9)";
    roundRect(ctx, -14, -15, 28, 20, 4);
    ctx.fill();
    ctx.fillStyle = "#a2ff9a";
    ctx.fillRect(-9, -10, 18, 10);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 17px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", 0, -3);
  } else if (entity.kind === "ring") {
    const pulse = 0.5 + Math.sin(now / 120 + entity.id) * 0.5;
    ctx.strokeStyle = route.roadEdge;
    ctx.shadowColor = route.roadEdge;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(0, -8, 34 + pulse * 4, 46 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = route.bolt;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -8, 22, 31, 0, 0, Math.PI * 2);
    ctx.stroke();
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
