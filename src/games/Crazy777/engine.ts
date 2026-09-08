import { DISPLAY_SYMBOLS, SPECIAL_SYMBOLS, SEVEN_SYMBOLS, BAR_SYMBOLS, Symbol, SpecialSymbol } from "./config";
import { WinTierName } from "./winTiers";
import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";

export interface ReelResult<S> {
  /** Symbols visible on this reel, top -> middle -> bottom. Middle is the payline. */
  symbols: [S, S, S];
}

export interface SpinResult {
  /** Reels 1-3 (the matching reels). */
  reels: [ReelResult<Symbol>, ReelResult<Symbol>, ReelResult<Symbol>];
  lineSymbols: [Symbol, Symbol, Symbol];
  /** Reel 4 (the special reel). */
  specialReel: ReelResult<SpecialSymbol>;
  lineWinTierKey: TierKey | null;
  specialTierKey: TierKey;
  baseWin: number;
  finalWin: number;
  respinsAwarded: number;
  /** Celebration overlay, keyed off the *special* tier — only set when baseWin > 0. */
  tier: WinTierName | null;
  /** Which of reels 0-2 (if any) should land physically between two symbols instead of
   * squarely on one — how a loss is represented (no separate "EMPTY" symbol). Set only when
   * lineWinTierKey is null. */
  emptyReelIndex: number | null;
  /** True when the special reel should land physically between two symbols (the
   * "specialEmpty" tier — no bonus this round), instead of squarely on one. */
  specialIsHalfStop: boolean;
}

/** Exact 3-of-a-kind tiers map 1:1 to a single symbol. anySeven/anyBar/anyGlobal are mixed-
 * family combos — confirmed against a reference build that these are real wins too, not just
 * decorative ladder rows. */
const LINE_TIER_SYMBOL: Partial<Record<TierKey, Symbol>> = {
  sevenLow: "SEVEN_LOW",
  sevenMid: "SEVEN_MID",
  sevenHigh: "SEVEN_HIGH",
  singleBar: "SINGLE_BAR",
  doubleBar: "DOUBLE_BAR",
};

const SPECIAL_TIER_SYMBOL: Partial<Record<TierKey, SpecialSymbol>> = {
  multiplier2x: "MULT_2X",
  multiplier5x: "MULT_5X",
  multiplier10x: "MULT_10X",
  dollarPlus: "DOLLAR_PLUS",
  doubleDollarPlus: "DOUBLE_DOLLAR_PLUS",
  respin: "RESPIN",
  // specialEmpty has no symbol mapping — it lands as a half-stop (see resolveSpin), using a
  // random real symbol as its nominal target via the `?? randomSpecialSymbol()` fallback.
};

/** Fallback celebration mapping (keyed off the *special* tier, since that's what makes a win
 * "big" here) for any tier the admin hasn't explicitly set. RESPIN deliberately stays null —
 * it gets its own dedicated "N RESPINS" banner client-side, not a WinCelebration overlay. */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  multiplier2x: null,
  multiplier5x: "BIG WIN",
  multiplier10x: "JACKPOT",
  dollarPlus: null,
  doubleDollarPlus: "MEGA WIN",
  respin: null,
  specialEmpty: null,
};

function getCelebration(specialTierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[specialTierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[specialTierKey] ?? null);
}

function randomSymbol(): Symbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function randomFrom(pool: ReadonlySet<Symbol>): Symbol {
  const arr = [...pool];
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSpecialSymbol(): SpecialSymbol {
  return SPECIAL_SYMBOLS[Math.floor(Math.random() * SPECIAL_SYMBOLS.length)];
}

/** A loss doesn't need special symbol selection — one reel lands half-stopped (see
 * emptyReelIndex in resolveSpin), which alone guarantees no tier can match regardless of what
 * the other two reels show, so all 3 are just independent random real symbols. */
function buildLossLine(): [Symbol, Symbol, Symbol] {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

/** Constructs the exact 3-symbol line for a given line tier. */
function buildLineForTier(tierKey: TierKey): [Symbol, Symbol, Symbol] {
  const symbol = LINE_TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];

  if (tierKey === "anySeven") {
    let line: [Symbol, Symbol, Symbol];
    do {
      line = [randomFrom(SEVEN_SYMBOLS), randomFrom(SEVEN_SYMBOLS), randomFrom(SEVEN_SYMBOLS)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "anyBar") {
    let line: [Symbol, Symbol, Symbol];
    do {
      line = [randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "anyGlobal") {
    // A genuine mix of both families (not identical, not all-seven, not all-bar) —
    // everything else among the real symbols falls here by elimination.
    let line: [Symbol, Symbol, Symbol];
    do {
      line = [randomSymbol(), randomSymbol(), randomSymbol()];
    } while (
      (line[0] === line[1] && line[1] === line[2]) ||
      line.every((s) => SEVEN_SYMBOLS.has(s)) ||
      line.every((s) => BAR_SYMBOLS.has(s))
    );
    return line;
  }

  return buildLossLine();
}

function buildReel(middle: Symbol): ReelResult<Symbol> {
  return { symbols: [randomSymbol(), middle, randomSymbol()] };
}

function buildSpecialReel(middle: SpecialSymbol): ReelResult<SpecialSymbol> {
  return { symbols: [randomSpecialSymbol(), middle, randomSpecialSymbol()] };
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

/** Uniform-random integer in [min, max], inclusive. */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Placeholder tier used to keep the special reel showing RESPIN during a respin round —
 * never actually rolled, so its frequencyPercent/payoutMultiplier are irrelevant. */
const FROZEN_RESPIN_TIER: TierRow = { key: "respin", frequencyPercent: 100, payoutMultiplier: null, freeSpinPayoutMultiplier: null };

function resolveSpin(
  betAmount: number,
  lineTier: TierRow,
  specialTier: TierRow,
  paytableConfig: PaytableConfigDTO,
  isRespin = false
): SpinResult {
  const isLineLoss = lineTier.key === "loss";
  const lineSymbols = isLineLoss ? buildLossLine() : buildLineForTier(lineTier.key);
  const emptyReelIndex = isLineLoss ? Math.floor(Math.random() * 3) : null;
  const reels = [buildReel(lineSymbols[0]), buildReel(lineSymbols[1]), buildReel(lineSymbols[2])] as [
    ReelResult<Symbol>,
    ReelResult<Symbol>,
    ReelResult<Symbol>,
  ];

  // Base Win = Pay × Bet (the admin-configured payoutMultiplier is the real multiplier —
  // no extra halving).
  const baseWin = lineTier.key === "loss" ? 0 : Math.round((lineTier.payoutMultiplier ?? 0) * betAmount * 100) / 100;

  const isSpecialEmpty = !isRespin && specialTier.key === "specialEmpty";

  // A specialEmpty roll always renders as a half-stop (reel pauses between two symbols) for
  // suspense. If reels 1-3 already won, the shake+drop reveal must resolve onto a real bonus
  // and genuinely pay it — no more "looks like a win but isn't" — so a weighted-random pick
  // among the other real special tiers stands in as the reel's true target here. If reels 1-3
  // lost, there's nothing to reveal — the reel just stays half-stopped, purely cosmetic.
  let effectiveSpecialTier = specialTier;
  if (isSpecialEmpty && baseWin > 0) {
    const realTiers = (paytableConfig.specialReelTiers ?? []).filter((t) => t.key !== "specialEmpty");
    if (realTiers.length > 0) effectiveSpecialTier = rollTier(realTiers);
  }

  const specialSymbol = SPECIAL_TIER_SYMBOL[effectiveSpecialTier.key] ?? randomSpecialSymbol();
  const specialReel = buildSpecialReel(specialSymbol);

  let finalWin = baseWin;
  let respinsAwarded = 0;
  let tier: WinTierName | null = null;

  // During a respin round the special reel is frozen (held on RESPIN, not re-rolled) — no
  // multiplier/bonus/celebration/re-trigger this round, it just pays the plain line win.
  if (baseWin > 0 && !isRespin) {
    tier = getCelebration(effectiveSpecialTier.key, paytableConfig);
    switch (effectiveSpecialTier.key) {
      case "multiplier2x":
      case "multiplier5x":
      case "multiplier10x":
        finalWin = Math.round(baseWin * (effectiveSpecialTier.payoutMultiplier ?? 1) * 100) / 100;
        break;
      case "dollarPlus":
      case "doubleDollarPlus": {
        const bonus = Math.round((effectiveSpecialTier.payoutMultiplier ?? 0) * betAmount * 100) / 100;
        finalWin = Math.round((baseWin + bonus) * 100) / 100;
        break;
      }
      case "respin": {
        const range = paytableConfig.respinRange ?? { min: 5, max: 5 };
        respinsAwarded = randomInRange(range.min, range.max);
        break;
      }
      default:
        // specialEmpty (only possible here if no real tiers were configured to reveal): no
        // bonus, finalWin stays = baseWin.
        break;
    }
  }

  return {
    reels,
    lineSymbols,
    specialReel,
    lineWinTierKey: isLineLoss ? null : lineTier.key,
    specialTierKey: effectiveSpecialTier.key,
    baseWin,
    finalWin,
    respinsAwarded,
    tier,
    emptyReelIndex,
    specialIsHalfStop: isSpecialEmpty,
  };
}

/** Runs one authoritative, outcome-first spin: the line tier and the special tier are each
 * decided first (independently, from paytableConfig's two separate frequency tables), then
 * reel symbols are built to match exactly. During a respin round (isRespin) the special tier
 * is never rolled — the special reel stays frozen on RESPIN for the whole bonus round, only
 * reels 1-3 spin. */
export function spin(betAmount: number, paytableConfig: PaytableConfigDTO, isRespin = false): SpinResult {
  const lineTier = rollTier(paytableConfig.tiers);
  const specialTier = isRespin ? FROZEN_RESPIN_TIER : rollTier(paytableConfig.specialReelTiers ?? []);
  return resolveSpin(betAmount, lineTier, specialTier, paytableConfig, isRespin);
}

/** Forced outcomes: find the special-reel tier whose celebration matches the request, force
 * reel 4 to it, and force reels 1-3 to the first configured non-loss line tier (so baseWin > 0
 * and the special effect actually shows) — feeds the admin forced-outcome tool. */
export function spinForTier(betAmount: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const specialTiers = paytableConfig.specialReelTiers ?? [];
  const forcedSpecialTier = specialTiers.find((t) => getCelebration(t.key, paytableConfig) === targetTier);
  const forcedLineTier = paytableConfig.tiers.find((t) => t.key !== "loss");

  if (!forcedSpecialTier || !forcedLineTier) return spin(betAmount, paytableConfig);
  return resolveSpin(betAmount, forcedLineTier, forcedSpecialTier, paytableConfig);
}
