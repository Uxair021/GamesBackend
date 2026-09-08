import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";
import { WinTierName, WinTier, getWinTier } from "../../gameTiers";
import {
  calculateWin,
  Symbol,
  WinResult,
  ComboMultipliers,
  NON_COIN_SYMBOLS,
  DEFAULT_BASE_TIERS,
  DEFAULT_COMBO_MULTIPLIERS,
  isGenuineLoss,
  isAny3BarOnly,
  isAny3BarWithSevenBar,
  isAny3Sevens,
} from "./winCalc";

export interface SpinResult {
  reels: [Symbol, Symbol, Symbol];
  winResult: WinResult;
  winAmount: number;
  tier: WinTierName | null;
}

/** The 7 line tiers that resolve to one specific exact-match symbol. The 3 "mixed" tiers
 * (any3BarOnly/any3BarWithSevenBar/any3Sevens) and "loss" instead rejection-sample — see
 * buildLineSymbols. */
const EXACT_TIER_TO_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  whiteBar: "WHITE_BAR",
  sevenBar: "SEVEN_BAR",
  redBar: "RED_BAR",
  purpleBar: "PURPLE_BAR",
  red7: "RED_7",
  purple7: "PURPLE_7",
  blue7: "BLUE_7",
};

const COIN_TIER_TO_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  coin2x: "COIN_2X",
  coin3x: "COIN_3X",
  coin4x: "COIN_4X",
  coin5x: "COIN_5X",
};

function randomNonCoinSymbol(): Symbol {
  return NON_COIN_SYMBOLS[Math.floor(Math.random() * NON_COIN_SYMBOLS.length)];
}

const MAX_SAMPLE_ATTEMPTS = 500;

/** Rejection-samples 3 symbols from the non-coin alphabet until `predicate` holds — used for
 * "loss" and the 3 "mixed" line tiers, whose base symbols aren't a single fixed combo. */
function sampleMatching(predicate: (s1: Symbol, s2: Symbol, s3: Symbol) => boolean): [Symbol, Symbol, Symbol] {
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
    const s1 = randomNonCoinSymbol();
    const s2 = randomNonCoinSymbol();
    const s3 = randomNonCoinSymbol();
    if (predicate(s1, s2, s3)) return [s1, s2, s3];
  }
  // Astronomically unlikely given each category's real acceptance rate — last-resort fallback.
  return [randomNonCoinSymbol(), randomNonCoinSymbol(), randomNonCoinSymbol()];
}

/** Weighted-random pick of one tier by frequencyPercent — same helper shape used everywhere
 * else in this codebase (e.g. Crazy777/engine.ts's rollTier). */
function rollTier(tiers: TierRow[]): TierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Constructs this line tier's base (pre-coin-overlay) 3 symbols. */
function buildLineSymbols(tierKey: TierKey): [Symbol, Symbol, Symbol] {
  const exactSymbol = EXACT_TIER_TO_SYMBOL[tierKey];
  if (exactSymbol) return [exactSymbol, exactSymbol, exactSymbol];

  switch (tierKey) {
    case "any3BarOnly":
      return sampleMatching(isAny3BarOnly);
    case "any3BarWithSevenBar":
      return sampleMatching(isAny3BarWithSevenBar);
    case "any3Sevens":
      return sampleMatching(isAny3Sevens);
    default:
      // "loss" (or any other/unlisted key — shouldn't happen with a valid config).
      return sampleMatching(isGenuineLoss);
  }
}

/** Rolls the coin-overlay table once for a single reel — null means "no coin, keep the line
 * symbol"; a coin Symbol means it replaces that reel's line symbol entirely. */
function rollCoinForReel(coinTiers: TierRow[]): Symbol | null {
  if (coinTiers.length === 0) return null;
  const tier = rollTier(coinTiers);
  return COIN_TIER_TO_SYMBOL[tier.key] ?? null;
}

const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 0,
  bigWinMin: 15,
  megaWinMin: 50,
  jackpotMin: 400,
  zeroRespinMin: 0,
  zeroRespinMax: 0,
};

/** Celebration tier is picked by bucketing the *final bet multiplier* (not a raw dollar
 * amount — 5x Rewind's payout is a continuous multiplier, not a discrete named outcome, so
 * there's no per-tier celebrationMap to key off). Reuses the same generic amountThresholds
 * shape as Cash Machine, just interpreted as multiplier cutoffs here. */
function celebrationTier(
  finalMultiplier: number,
  thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>
): WinTierName | null {
  const tiers: WinTier[] = [
    { name: "JACKPOT", minAmount: thresholds.jackpotMin },
    { name: "MEGA WIN", minAmount: thresholds.megaWinMin },
    { name: "BIG WIN", minAmount: thresholds.bigWinMin },
  ];
  return getWinTier(tiers, finalMultiplier);
}

/** Admin-configured exact-match payouts (from each symbol's own line-tier
 * TierRow.payoutMultiplier), falling back to the built-in defaults for any row left unset
 * (e.g. a config saved before this became editable). */
function baseTiersFrom(tiers: TierRow[]): Partial<Record<Symbol, number>> {
  const baseTiers: Partial<Record<Symbol, number>> = { ...DEFAULT_BASE_TIERS };
  for (const tier of tiers) {
    const symbol = EXACT_TIER_TO_SYMBOL[tier.key];
    if (symbol && tier.payoutMultiplier !== null) baseTiers[symbol] = tier.payoutMultiplier;
  }
  return baseTiers;
}

/** Admin-configured "ANY-3 mixed" combo payouts, from the 3 dedicated line-tier rows. */
function comboMultipliersFrom(tiers: TierRow[]): ComboMultipliers {
  const find = (key: TierKey) => tiers.find((t) => t.key === key)?.payoutMultiplier;
  return {
    anyBarOnly: find("any3BarOnly") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarOnly,
    anyBarWithSevenBar: find("any3BarWithSevenBar") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarWithSevenBar,
    anySevens: find("any3Sevens") ?? DEFAULT_COMBO_MULTIPLIERS.anySevens,
  };
}

function resolve(reels: [Symbol, Symbol, Symbol], betAmount: number, paytableConfig: PaytableConfigDTO): SpinResult {
  const winResult = calculateWin(
    reels,
    betAmount,
    baseTiersFrom(paytableConfig.tiers),
    comboMultipliersFrom(paytableConfig.tiers)
  );
  const thresholds = paytableConfig.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = celebrationTier(winResult.finalMultiplier, thresholds);
  return { reels, winResult, winAmount: winResult.payout, tier };
}

/** Rolls the line tier (loss + each named win category, exactly like every other game's
 * `tiers`) to get 3 base symbols, then independently rolls the coin-overlay table for each of
 * the 3 reels — a coin can replace any reel's line symbol regardless of what the line tier
 * rolled, which is what makes the position-sensitive special jackpots (2X|5X|2X etc.) and
 * coin substitution/stacking possible without needing named tiers for every combination. */
export function spin(betAmount: number, paytableConfig: PaytableConfigDTO): SpinResult {
  const lineTier = rollTier(paytableConfig.tiers);
  const lineSymbols = buildLineSymbols(lineTier.key);
  const coinTiers = paytableConfig.specialReelTiers ?? [];
  const reels: [Symbol, Symbol, Symbol] = [
    rollCoinForReel(coinTiers) ?? lineSymbols[0],
    rollCoinForReel(coinTiers) ?? lineSymbols[1],
    rollCoinForReel(coinTiers) ?? lineSymbols[2],
  ];
  return resolve(reels, betAmount, paytableConfig);
}

/** Hardcoded representative reel combos for the admin forced-outcome tool — no data-driven
 * tier lookup makes sense here since payout is a continuous multiplier, not a named roll. */
const FORCED_REELS: Record<WinTierName, [Symbol, Symbol, Symbol]> = {
  JACKPOT: ["COIN_2X", "COIN_5X", "COIN_2X"],
  "MEGA WIN": ["RED_7", "COIN_2X", "COIN_3X"],
  "BIG WIN": ["RED_7", "RED_7", "RED_7"],
};

export function spinForTier(betAmount: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  return resolve(FORCED_REELS[targetTier], betAmount, paytableConfig);
}
