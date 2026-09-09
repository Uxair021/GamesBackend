import { DISPLAY_SYMBOLS, Symbol, isAny3SevenFamily, isAny3SingleSevenBarMix, isAny3BarFamilyMix, isGenuineLoss } from "./config";
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
}

/** Every win tier here maps to an exact combo or a structural "mixed"/cherry-count category —
 * same "no collapsed buckets" shape as Buffalo 777. Used as the fallback whenever the admin
 * hasn't set (or saved before this feature existed) a celebration for a given tier. */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  tenX: "JACKPOT",
  threeX: "JACKPOT",
  cherry: "MEGA WIN",
  seven: "BIG WIN",
  sevenBar: "BIG WIN",
  oneCherry: "BIG WIN",
  tripleBar: "BIG WIN",
  any3SevenSevenBar: "BIG WIN",
  doubleBar: null,
  any3BarFamilyMix: null,
  singleBar: null,
  any3SingleBarSevenBar: null,
  twoCherry: null,
};

/** The specific symbol each exact "3 of a kind" tier requires. */
const TIER_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  tenX: "TEN_X",
  threeX: "THREE_X",
  cherry: "CHERRY",
  seven: "SEVEN",
  sevenBar: "SEVEN_BAR",
  tripleBar: "TRIPLE_BAR",
  doubleBar: "DOUBLE_BAR",
  singleBar: "SINGLE_BAR",
};

const SYMBOL_TIER: Partial<Record<Symbol, TierKey>> = Object.fromEntries(
  (Object.entries(TIER_SYMBOL) as [TierKey, Symbol][]).map(([tier, symbol]) => [symbol, tier])
);

const NON_CHERRY_SYMBOLS = DISPLAY_SYMBOLS.filter((s) => s !== "CHERRY");

function getCelebration(tierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[tierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[tierKey] ?? null);
}

function randomSymbol(): Symbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function randomNonCherrySymbol(): Symbol {
  return NON_CHERRY_SYMBOLS[Math.floor(Math.random() * NON_CHERRY_SYMBOLS.length)];
}

const MAX_SAMPLE_ATTEMPTS = 500;

function sampleMatching(predicate: (s1: Symbol, s2: Symbol, s3: Symbol) => boolean): [Symbol, Symbol, Symbol] {
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
    const s1 = randomNonCherrySymbol();
    const s2 = randomNonCherrySymbol();
    const s3 = randomNonCherrySymbol();
    if (predicate(s1, s2, s3)) return [s1, s2, s3];
  }
  // Astronomically unlikely given each category's real acceptance rate — last-resort fallback.
  return [randomNonCherrySymbol(), randomNonCherrySymbol(), randomNonCherrySymbol()];
}

/** Places CHERRY on exactly `count` of the 3 reels (randomly chosen positions), non-cherry
 * symbols on the rest. Safe regardless of what the non-cherry fillers are — no 2-symbol-only
 * category exists that a stray match among them could accidentally trigger. */
function buildCherryCountLine(count: 1 | 2): [Symbol, Symbol, Symbol] {
  const positions = [0, 1, 2];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const cherryPositions = new Set(positions.slice(0, count));
  const line: Symbol[] = [0, 1, 2].map((i) => (cherryPositions.has(i) ? "CHERRY" : randomNonCherrySymbol()));
  return line as [Symbol, Symbol, Symbol];
}

/** A line that genuinely matches nothing (see config.ts's isGenuineLoss) — rejection-sampled,
 * converges quickly. */
function buildLossLine(): [Symbol, Symbol, Symbol] {
  let line: [Symbol, Symbol, Symbol];
  do {
    line = [randomSymbol(), randomSymbol(), randomSymbol()];
  } while (!isGenuineLoss(...line));
  return line;
}

/** Constructs the exact 3-symbol line for a given tier. */
function buildLineForTier(tierKey: TierKey): [Symbol, Symbol, Symbol] {
  const symbol = TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];

  switch (tierKey) {
    case "any3SevenSevenBar":
      return sampleMatching(isAny3SevenFamily);
    case "any3SingleBarSevenBar":
      return sampleMatching(isAny3SingleSevenBarMix);
    case "any3BarFamilyMix":
      return sampleMatching(isAny3BarFamilyMix);
    case "twoCherry":
      return buildCherryCountLine(2);
    case "oneCherry":
      return buildCherryCountLine(1);
    default:
      return buildLossLine();
  }
}

function buildReel(middle: Symbol): ReelResult {
  return { symbols: [randomSymbol(), middle, randomSymbol()] };
}

/** Weighted-random pick of one tier row by frequencyPercent. */
function rollTier(tiers: TierRow[]): TierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

function resolveSpin(betAmount: number, tier: TierRow, paytableConfig: PaytableConfigDTO): SpinResult {
  const lineSymbols = tier.key === "loss" ? buildLossLine() : buildLineForTier(tier.key);
  const multiplier = tier.key === "loss" ? 0 : (tier.payoutMultiplier ?? 0);
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
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
    tier: tier.key === "loss" ? null : getCelebration(tier.key, paytableConfig),
  };
}

/** Runs one authoritative, outcome-first spin: the tier is decided first (from paytableConfig's
 * frequencies), then reel symbols are built to match it exactly. */
export function spin(betAmount: number, paytableConfig: PaytableConfigDTO): SpinResult {
  return resolveSpin(betAmount, rollTier(paytableConfig.tiers), paytableConfig);
}

/** Forced outcomes are exact — directly roll the requested tier instead of retrying. */
export function spinForTier(betAmount: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers
    .map((t) => t.key)
    .find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(betAmount, paytableConfig);
  return resolveSpin(betAmount, tierRow, paytableConfig);
}
