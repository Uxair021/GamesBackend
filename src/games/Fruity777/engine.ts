import { secureRandomInt } from "../../utils/rng";
import { DISPLAY_SYMBOLS, Symbol, MIN_FREE_SPINS, MAX_FREE_SPINS } from "./config";
import { WinTierName } from "./winTiers";
import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";

export interface ReelResult {
  /** Symbols visible on this reel, top -> middle -> bottom. Middle is the payline. */
  symbols: [Symbol, Symbol, Symbol];
}

export interface SpinResult {
  reels: [ReelResult, ReelResult, ReelResult];
  lineSymbols: [Symbol, Symbol, Symbol];
  winTierKey: TierKey | null;
  multiplier: number;
  winAmount: number;
  tier: WinTierName | null;
  /** Free spins newly awarded on this line (3 BONUS on a base spin only — no retrigger). */
  freeSpinsAwarded: number;
}

/** Every win tier here maps 1:1 to a single symbol — same "no collapsed buckets" shape as
 * Buffalo 777. Used as the fallback whenever the admin hasn't set (or saved before this
 * feature existed) a celebration for a given tier — see getCelebration(). */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  freeSpin: null,
  apple: null,
  lemon: null,
  orange: null,
  peach: null,
  pineapple: null,
  grape: null,
  watermelon: "BIG WIN",
  dragonFruit: "BIG WIN",
  seven: "BIG WIN",
  bar: "MEGA WIN",
  star: "JACKPOT",
};

/** The specific symbol each "3 of a kind" tier requires. */
const TIER_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  apple: "APPLE",
  lemon: "LEMON",
  orange: "ORANGE",
  peach: "PEACH",
  pineapple: "PINEAPPLE",
  grape: "GRAPE",
  watermelon: "WATERMELON",
  dragonFruit: "DRAGON_FRUIT",
  seven: "SEVEN",
  bar: "BAR",
  star: "STAR",
};

const SYMBOL_TIER: Partial<Record<Symbol, TierKey>> = Object.fromEntries(
  (Object.entries(TIER_SYMBOL) as [TierKey, Symbol][]).map(([tier, symbol]) => [symbol, tier])
);

/** Admin-configured celebration for this tier, falling back to the default above for any
 * tier the admin hasn't set (including configs saved before this feature existed). */
function getCelebration(tierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[tierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[tierKey] ?? null);
}

function randomSymbol(): Symbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

/** Classifies a 3-symbol line into the tier it satisfies, if any — used only as a
 * rejection-sampling guard for synthesizing a genuine "loss" line (win lines, including the
 * BONUS/free-spin line, are built directly, see buildLineForTier). */
function evaluateLine(line: [Symbol, Symbol, Symbol]): TierKey | "freeSpin" | null {
  if (line[0] === line[1] && line[1] === line[2]) {
    if (line[0] === "BONUS") return "freeSpin";
    return SYMBOL_TIER[line[0]] ?? null;
  }
  return null;
}

/** A line that genuinely matches nothing — rejection-sampled, converges in 1-2 tries. */
function buildLossLine(): [Symbol, Symbol, Symbol] {
  let line: [Symbol, Symbol, Symbol];
  do {
    line = [randomSymbol(), randomSymbol(), randomSymbol()];
  } while (evaluateLine(line) !== null);
  return line;
}

/** Constructs the exact 3-symbol line for a given tier. */
function buildLineForTier(tierKey: TierKey): [Symbol, Symbol, Symbol] {
  if (tierKey === "freeSpin") return ["BONUS", "BONUS", "BONUS"];
  const symbol = TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];
  return buildLossLine();
}

function buildReel(middle: Symbol): ReelResult {
  return { symbols: [randomSymbol(), middle, randomSymbol()] };
}

/** Weighted-random pick of one tier row by frequencyPercent. Optionally excludes "freeSpin"
 * (a bonus-round spin doesn't re-trigger itself — confirmed with user: no retrigger). */
function rollTier(tiers: TierRow[], excludeFreeSpin: boolean): TierRow {
  const pool = excludeFreeSpin ? tiers.filter((t) => t.key !== "freeSpin") : tiers;
  const total = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of pool) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return pool[pool.length - 1];
}

function randomFreeSpinsAwarded(): number {
  return MIN_FREE_SPINS + secureRandomInt(MAX_FREE_SPINS - MIN_FREE_SPINS + 1);
}

function resolveSpin(betAmount: number, tier: TierRow, isFreeSpin: boolean, paytableConfig: PaytableConfigDTO): SpinResult {
  const lineSymbols = tier.key === "loss" ? buildLossLine() : buildLineForTier(tier.key);
  const isFreeSpinTrigger = tier.key === "freeSpin";
  const multiplier =
    tier.key === "loss" || isFreeSpinTrigger ? 0 : ((isFreeSpin ? tier.freeSpinPayoutMultiplier : tier.payoutMultiplier) ?? 0);
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const freeSpinsAwarded = isFreeSpinTrigger ? randomFreeSpinsAwarded() : 0;
  const reels = [buildReel(lineSymbols[0]), buildReel(lineSymbols[1]), buildReel(lineSymbols[2])] as [
    ReelResult,
    ReelResult,
    ReelResult,
  ];

  return {
    reels,
    lineSymbols,
    winTierKey: tier.key === "loss" ? null : tier.key,
    multiplier,
    winAmount,
    tier: tier.key === "loss" || isFreeSpinTrigger ? null : getCelebration(tier.key, paytableConfig),
    freeSpinsAwarded,
  };
}

/** Runs one authoritative, outcome-first spin: the tier is decided first (from paytableConfig's
 * frequencies), then reel symbols are built to match it exactly. betAmount is the total bet
 * (0 during a free spin — see routes.ts). */
export function spin(betAmount: number, isFreeSpin: boolean, paytableConfig: PaytableConfigDTO): SpinResult {
  return resolveSpin(betAmount, rollTier(paytableConfig.tiers, isFreeSpin), isFreeSpin, paytableConfig);
}

/** Forced outcomes are exact — directly roll the requested tier instead of retrying. Force
 * Outcome only offers BIG WIN/MEGA WIN/JACKPOT (see AdminForceOutcomePage), so this can never
 * land on "freeSpin" — same limitation ShamrockSpin already has. */
export function spinForTier(betAmount: number, isFreeSpin: boolean, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers
    .map((t) => t.key)
    .find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(betAmount, isFreeSpin, paytableConfig);
  return resolveSpin(betAmount, tierRow, isFreeSpin, paytableConfig);
}
