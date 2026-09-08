import { REEL_STRIPS, NULL_SYMBOL, ZERO_SYMBOL, Symbol, BetTier } from "./config";
import { WinTierName } from "./winTiers";
import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";

export interface SpinResult {
  /** Only the reels actually in play for this bet tier — length equals betTier.activeReels. */
  symbols: Symbol[];
  /** Indexes (within `symbols`) of reels that got a bonus respin. */
  respunIndexes: number[];
  winAmount: number;
  tier: WinTierName | null;
}

/** Fallback used whenever the admin hasn't set (or saved before this feature existed) a
 * celebration for a given tier — see getCelebration(). */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  freeSpin: null, // unused for this game
  simpleWin: null,
  bigWin: "BIG WIN",
  megaWin: "MEGA WIN",
  jackpot: "JACKPOT",
  zeroRespin: null,
  // Buffalo 777 only
  ten: null,
  jack: null,
  queen: null,
  king: null,
  ace: null,
  bull: null,
  anyBar: null,
  singleBar: null,
  doubleBar: null,
  tripleBar: null,
  moneyBag: null,
  coin: null,
  // Crazy 777 only
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

/** Admin-configured celebration for this tier, falling back to the default above for any
 * tier the admin hasn't set (including configs saved before this feature existed). */
function getCelebration(tierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[tierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[tierKey] ?? null);
}

const MAX_SYNTHESIS_ATTEMPTS = 300;

function randomSymbolForReel(reelIndex: number): Symbol {
  const strip = REEL_STRIPS[reelIndex];
  return strip[Math.floor(Math.random() * strip.length)];
}

/** Same as randomSymbolForReel but never returns ZERO_SYMBOL — used by every tier except
 * "zeroRespin" so the 0-triggers-a-respin visual can only ever fire for that dedicated tier
 * (previously a "loss" spin could randomly draw a lone "0", which itself satisfies a
 * concatenated value of 0, and then look exactly like a near-miss respin worth $0). */
function randomNonZeroSymbolForReel(reelIndex: number): Symbol {
  let symbol = randomSymbolForReel(reelIndex);
  while (symbol === ZERO_SYMBOL) symbol = randomSymbolForReel(reelIndex);
  return symbol;
}

/** Used for the reels the "zeroRespin" tier respins — must reveal an actual value, never blank. */
function randomNonNullSymbolForReel(reelIndex: number): Symbol {
  let symbol = randomSymbolForReel(reelIndex);
  while (symbol === NULL_SYMBOL) symbol = randomSymbolForReel(reelIndex);
  return symbol;
}

function concatenatedValue(symbols: readonly Symbol[]): number {
  const concatenated = symbols.filter((s) => s !== NULL_SYMBOL).join("");
  return concatenated === "" ? 0 : parseInt(concatenated, 10);
}

interface AmountRange {
  min: number;
  max: number; // inclusive; Infinity for open-ended (jackpot)
}

function rangeForTier(
  tierKey: TierKey,
  thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>
): AmountRange {
  switch (tierKey) {
    case "loss":
      return { min: 0, max: 0 };
    case "simpleWin":
      return { min: 1, max: thresholds.simpleWinMax };
    case "bigWin":
      return { min: thresholds.bigWinMin, max: thresholds.megaWinMin - 1 };
    case "megaWin":
      return { min: thresholds.megaWinMin, max: thresholds.jackpotMin - 1 };
    case "jackpot":
      return { min: thresholds.jackpotMin, max: Infinity };
    case "zeroRespin":
      return { min: thresholds.zeroRespinMin, max: thresholds.zeroRespinMax };
    default:
      return { min: 0, max: 0 };
  }
}

const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 99,
  bigWinMin: 100,
  megaWinMin: 1000,
  jackpotMin: 10000,
  zeroRespinMin: 1,
  zeroRespinMax: 20,
};

/**
 * Synthesizes `activeReels` symbols whose concatenation falls within the target tier's
 * amount range — rejection-sampled from the existing weighted digit pool (the space is
 * tiny, converges fast). Never draws ZERO_SYMBOL (see randomNonZeroSymbolForReel) — "0" is
 * reserved for the dedicated "zeroRespin" tier below, so a "loss" (range {0,0}) can only
 * ever be satisfied by an all-blank board, never a lone "0" that would look like a near-miss.
 * If a tier's range is unreachable at this reel count (e.g. "big win" needs >=100 but 1
 * active reel maxes out at "10"), falls back to the closest value seen after
 * MAX_SYNTHESIS_ATTEMPTS tries — the credited payout is the admin-configured multiplier
 * regardless, so this only affects what's cosmetically displayed.
 */
function synthesizeSymbols(activeReels: number, range: AmountRange): Symbol[] {
  let best: Symbol[] | null = null;
  let bestDistance = Infinity;

  for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt++) {
    const candidate = Array.from({ length: activeReels }, (_, i) => randomNonZeroSymbolForReel(i));
    const value = concatenatedValue(candidate);
    if (value >= range.min && value <= range.max) return candidate;

    const distance = value < range.min ? range.min - value : value - (range.max === Infinity ? value : range.max);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best ?? Array.from({ length: activeReels }, () => NULL_SYMBOL);
}

/**
 * The dedicated "zeroRespin" tier: one active reel is fixed to ZERO_SYMBOL, every other
 * active reel starts blank and gets a bonus respin revealing a real digit — exactly the
 * mechanic being fixed here. Unlike every other tier, the credited payout is NOT a flat
 * admin multiplier: it's literally the concatenated value the respin reveals (e.g. "0" +
 * "2" -> 02/20 -> pays 20, scaled by the usual bet ratio), rejection-sampled to land within
 * the admin's configured [min, max] range for this tier.
 */
function synthesizeZeroRespin(activeReels: number, range: AmountRange): { symbols: Symbol[]; respunIndexes: number[] } {
  const zeroIndex = Math.floor(Math.random() * activeReels);

  if (activeReels === 1) {
    // No second reel to hide behind — just reveal a real digit directly, no respin needed.
    let best: Symbol | null = null;
    let bestDistance = Infinity;
    for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt++) {
      const candidate = randomNonZeroSymbolForReel(0);
      const value = concatenatedValue([candidate]);
      if (value >= range.min && value <= range.max) return { symbols: [candidate], respunIndexes: [] };
      const distance = value < range.min ? range.min - value : value - (range.max === Infinity ? value : range.max);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return { symbols: [best ?? NULL_SYMBOL], respunIndexes: [] };
  }

  const respunIndexes = Array.from({ length: activeReels }, (_, i) => i).filter((i) => i !== zeroIndex);
  let best: Symbol[] | null = null;
  let bestDistance = Infinity;

  for (let attempt = 0; attempt < MAX_SYNTHESIS_ATTEMPTS; attempt++) {
    const candidate: Symbol[] = Array.from({ length: activeReels }, (_, i) =>
      i === zeroIndex ? ZERO_SYMBOL : randomNonNullSymbolForReel(i)
    );
    const value = concatenatedValue(candidate);
    if (value >= range.min && value <= range.max) return { symbols: candidate, respunIndexes };

    const distance = value < range.min ? range.min - value : value - (range.max === Infinity ? value : range.max);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return { symbols: best ?? Array.from({ length: activeReels }, (_, i) => (i === zeroIndex ? ZERO_SYMBOL : NULL_SYMBOL)), respunIndexes };
}

function rollTier(tiers: TierRow[]): TierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Builds the reels + respin indexes for a rolled tier. The credited amount (before bet-ratio
 * scaling) is always the actual concatenated value the reels end up showing — what's on
 * screen is what gets paid, for every tier including "loss" (which always nets 0 since it
 * synthesizes an all-blank board). The admin's payoutMultiplier field is estimate-only, used
 * solely for the live RTP preview — the real per-spin amount is decided here, from the tier's
 * admin-configured value range (rangeForTier / amountThresholds). */
function resolveTier(
  tierKey: TierKey,
  activeReels: number,
  thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>
): { symbols: Symbol[]; respunIndexes: number[]; rawAmount: number } {
  const range = rangeForTier(tierKey, thresholds);

  if (tierKey === "zeroRespin") {
    const { symbols, respunIndexes } = synthesizeZeroRespin(activeReels, range);
    return { symbols, respunIndexes, rawAmount: concatenatedValue(symbols) };
  }

  const symbols = synthesizeSymbols(activeReels, range);
  return { symbols, respunIndexes: [], rawAmount: concatenatedValue(symbols) };
}

/** Runs one authoritative, outcome-first spin: the tier is decided first (from paytableConfig's
 * frequencies), then reel symbols are synthesized to visually match it. */
export function spin(betTier: BetTier, paytableConfig: PaytableConfigDTO): SpinResult {
  const thresholds = paytableConfig.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = rollTier(paytableConfig.tiers);
  const { symbols, respunIndexes, rawAmount } = resolveTier(tier.key, betTier.activeReels, thresholds);

  const scaled = rawAmount * (betTier.bet / betTier.fullBetForReels);
  const winAmount = Math.round(scaled * 100) / 100;

  return { symbols, respunIndexes, winAmount, tier: tier.key === "loss" ? null : getCelebration(tier.key, paytableConfig) };
}

/** Forced outcomes are now exact — directly roll the requested tier instead of retrying. */
export function spinForTier(betTier: BetTier, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers
    .map((t) => t.key)
    .find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(betTier, paytableConfig);

  const thresholds = paytableConfig.amountThresholds ?? DEFAULT_THRESHOLDS;
  const { symbols, respunIndexes, rawAmount } = resolveTier(tierRow.key, betTier.activeReels, thresholds);

  const scaled = rawAmount * (betTier.bet / betTier.fullBetForReels);
  const winAmount = Math.round(scaled * 100) / 100;

  return { symbols, respunIndexes, winAmount, tier: targetTier };
}
