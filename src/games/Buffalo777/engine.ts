import { BAR_SYMBOLS, DISPLAY_SYMBOLS, Symbol } from "./config";
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

/** Every win tier here maps 1:1 to a single symbol/combo — unlike Shamrock Spin/Cash
 * Machine, no tiers are collapsed together, so each stays an exact, distinct payout.
 * Used as the fallback whenever the admin hasn't set (or saved before this feature
 * existed) a celebration for a given tier — see getCelebration(). */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  freeSpin: null,
  simpleWin: null,
  bigWin: null,
  megaWin: null,
  jackpot: null,
  zeroRespin: null,
  ten: null,
  jack: null,
  queen: null,
  king: null,
  ace: null,
  bull: null,
  anyBar: null,
  singleBar: "BIG WIN",
  doubleBar: "BIG WIN",
  tripleBar: "MEGA WIN",
  moneyBag: "MEGA WIN",
  coin: "JACKPOT",
  sevenLow: null,
  sevenMid: null,
  sevenHigh: null,
  anySeven: null,
  anyGlobal: null,
  multiplier2x: null,
  multiplier5x: null,
  multiplier10x: null,
  dollarPlus: null,
  doubleDollarPlus: null,
  respin: null,
  specialEmpty: null,
};

/** The specific symbol each "3 of a kind" tier requires — anyBar has no single symbol
 * (it's a mixed combination, handled separately in buildLineForTier/evaluateLine). */
const TIER_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  ten: "TEN",
  jack: "JACK",
  queen: "QUEEN",
  king: "KING",
  ace: "ACE",
  bull: "BULL",
  singleBar: "SINGLE_BAR",
  doubleBar: "DOUBLE_BAR",
  tripleBar: "TRIPLE_BAR",
  moneyBag: "MONEY_BAG",
  coin: "COIN",
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

function randomBar(): Symbol {
  const bars = [...BAR_SYMBOLS];
  return bars[Math.floor(Math.random() * bars.length)];
}

/** Classifies a 3-symbol line into the tier it satisfies, if any — used only as a
 * rejection-sampling guard for synthesizing a genuine "loss" line (win lines are built
 * directly per tier, see buildLineForTier). */
function evaluateLine(line: [Symbol, Symbol, Symbol]): TierKey | null {
  if (line[0] === line[1] && line[1] === line[2]) {
    return SYMBOL_TIER[line[0]] ?? null;
  }
  if (line.every((s) => BAR_SYMBOLS.has(s))) {
    return "anyBar";
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
  const symbol = TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];

  if (tierKey === "anyBar") {
    let line: [Symbol, Symbol, Symbol];
    do {
      line = [randomBar(), randomBar(), randomBar()];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  return buildLossLine();
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

/** Forced outcomes are exact — directly roll the requested tier instead of retrying.
 * Multiple TierKeys can share a WinTierName (e.g. singleBar/doubleBar both = "BIG WIN");
 * this picks the first match among the tiers actually configured for this game. */
export function spinForTier(betAmount: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers
    .map((t) => t.key)
    .find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(betAmount, paytableConfig);
  return resolveSpin(betAmount, tierRow, paytableConfig);
}
