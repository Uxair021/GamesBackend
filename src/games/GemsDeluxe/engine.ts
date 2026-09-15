import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierRow, TierKey } from "../../models/PaytableConfig";
import { Symbol, BAR_SYMBOLS, DOLLAR_REEL_INDEX, OFFER_DRAW_COUNT_WEIGHTS, OFFER_COUNT } from "./config";

const NON_DIAMOND_SYMBOLS: readonly Symbol[] = ["SEVEN", "TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"];
const ALL_REAL_SYMBOLS: readonly Symbol[] = ["SEVEN", "TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR", "DIAMOND"];
const BAR_SYMBOL_LIST: readonly Symbol[] = [...BAR_SYMBOLS];

/** [above, middle, below] for one reel — middle is the scored payline symbol. */
export interface ReelResult {
  symbols: [Symbol, Symbol, Symbol];
}

export interface SpinResult {
  reels: [ReelResult, ReelResult, ReelResult];
  /** Which of the 3 reels (0-2) lands physically between two symbols instead of cleanly on
   * one — how a loss is represented, no separate blank/filler symbol needed (see buildLossLine's
   * doc comment). null whenever the spin actually won or triggered the bonus (every reel lands
   * clean). */
  emptyReelIndex: number | null;
  /** Always 0 when bonusTriggered (the bonus round replaces the line win entirely — confirmed
   * with user) or on a loss. */
  lineWinAmount: number;
  bonusTriggered: boolean;
  /** Present only when bonusTriggered — 4 pre-rolled flat-dollar offers (First..Last). Never
   * sent to the client in full (see models/GemsDeluxeBonus.ts's doc comment) — routes.ts only
   * ever reveals offers[currentIndex]. */
  offers: [number, number, number, number] | null;
}

function randomFrom(pool: readonly Symbol[]): Symbol {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Weighted-random pick of one tier row by frequencyPercent — same helper shape as every
 * other outcome-first game here (Buffalo 777, Crazy 777, ...). */
function rollTier(tiers: TierRow[]): TierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/**
 * A loss doesn't need a blank/filler symbol — one reel lands half-stopped (physically between
 * two symbols, see pixi/Reel.ts's spinTo halfStop param), which alone guarantees the exact-
 * match and any-bars-mixed checks can never accidentally fire regardless of what the other two
 * reels show (same technique Crazy 777 uses for its own loss line). The one wrinkle specific to
 * this game: Diamond pays for just 1 clean occurrence, so unlike Crazy 777 the *other* two
 * (clean) reels must also avoid Diamond entirely — otherwise a lone clean Diamond would
 * visually look like a win the server isn't paying.
 */
function buildLossLine(): [Symbol, Symbol, Symbol] {
  return [randomFrom(NON_DIAMOND_SYMBOLS), randomFrom(NON_DIAMOND_SYMBOLS), randomFrom(NON_DIAMOND_SYMBOLS)];
}

/** Constructs the exact 3-symbol line for a given winning tier. */
function buildLineForTier(tierKey: TierKey): [Symbol, Symbol, Symbol] {
  if (tierKey === "seven") return ["SEVEN", "SEVEN", "SEVEN"];
  if (tierKey === "tripleBar") return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
  if (tierKey === "doubleBar") return ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"];
  if (tierKey === "singleBar") return ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"];

  if (tierKey === "anyBar") {
    let line: [Symbol, Symbol, Symbol];
    do {
      line = [randomFrom(BAR_SYMBOL_LIST), randomFrom(BAR_SYMBOL_LIST), randomFrom(BAR_SYMBOL_LIST)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "diamondOne" || tierKey === "diamondTwo" || tierKey === "diamondThree") {
    const count = tierKey === "diamondOne" ? 1 : tierKey === "diamondTwo" ? 2 : 3;
    const positions = [0, 1, 2].sort(() => Math.random() - 0.5);
    const line: Symbol[] = [];
    positions.forEach((pos, i) => {
      line[pos] = i < count ? "DIAMOND" : randomFrom(NON_DIAMOND_SYMBOLS);
    });
    return line as [Symbol, Symbol, Symbol];
  }

  if (tierKey === "dollarBonus") {
    // The other 2 reels' payline symbol must never be DIAMOND alongside the DOLLAR trigger
    // (confirmed with user) — drawn from NON_DIAMOND_SYMBOLS instead of ALL_REAL_SYMBOLS.
    const line: Symbol[] = [0, 1, 2].map((i) => (i === DOLLAR_REEL_INDEX ? "DOLLAR" : randomFrom(NON_DIAMOND_SYMBOLS)));
    return line as [Symbol, Symbol, Symbol];
  }

  return buildLossLine();
}

/** Wraps a scored payline symbol with random above/below flavor for the 3-row reel window.
 * `avoidDiamondFiller` also keeps the random above/below flavor off DIAMOND — used for the 2
 * non-DOLLAR reels on a dollarBonus trigger, so those reels show no DIAMOND anywhere (payline
 * included, see buildLineForTier's dollarBonus branch), not just on the payline itself. */
function buildReel(middle: Symbol, avoidDiamondFiller = false): ReelResult {
  const fillerPool = avoidDiamondFiller ? NON_DIAMOND_SYMBOLS : ALL_REAL_SYMBOLS;
  return { symbols: [randomFrom(fillerPool), middle, randomFrom(fillerPool)] };
}

/** One weighted-random draw from the bonus note-bundle pool (see config.ts's
 * REFERENCE_BONUS_POOL) — payoutMultiplier here holds a FLAT dollar amount, not a bet
 * multiple (see models/PaytableConfig.ts's specialReelTiers doc comment on this game). */
function drawBonusPoolValue(pool: TierRow[]): number {
  const total = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const row of pool) {
    roll -= row.frequencyPercent;
    if (roll < 0) return row.payoutMultiplier ?? 0;
  }
  return pool[pool.length - 1]?.payoutMultiplier ?? 0;
}

function rollDrawCount(): 1 | 2 | 3 {
  const total = OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of OFFER_DRAW_COUNT_WEIGHTS) {
    roll -= w.weight;
    if (roll < 0) return w.count;
  }
  return OFFER_DRAW_COUNT_WEIGHTS[OFFER_DRAW_COUNT_WEIGHTS.length - 1].count;
}

/** One offer = sum of 1-3 independent weighted draws from the bonus pool (confirmed with
 * user: "you can pick min 1 ... max remain 3"). */
function generateOffer(pool: TierRow[]): number {
  const count = rollDrawCount();
  let sum = 0;
  for (let i = 0; i < count; i++) sum += drawBonusPoolValue(pool);
  return sum;
}

/** All 4 sequential offers, pre-rolled up front — see SpinResult.offers' doc comment for why
 * precomputing all of them at spin time (rather than one at a time as the player clicks
 * "Try Again") is both safe and equivalent. */
function generateOffers(pool: TierRow[]): [number, number, number, number] {
  const offers: number[] = [];
  for (let i = 0; i < OFFER_COUNT; i++) offers.push(generateOffer(pool));
  return offers as [number, number, number, number];
}

/**
 * Runs one authoritative, server-drawn spin: the tier is decided first (from paytableConfig's
 * frequencies), then reel symbols are built to match it exactly — same pattern as Buffalo 777/
 * Crazy 777. If the "dollarBonus" tier rolls, lineWinAmount is 0 and `offers` carries the 4
 * pre-rolled flat-dollar amounts the client will let the player choose between (see routes.ts's
 * /bonus-resolve for how the chosen one actually gets credited). A loss lands one reel
 * half-stopped (see buildLossLine) instead of using a blank/filler symbol.
 */
export function spin(betAmount: number, paytableConfig: PaytableConfigDTO): SpinResult {
  const tier = rollTier(paytableConfig.tiers);
  const isLoss = tier.key === "loss";
  const lineSymbols = isLoss ? buildLossLine() : buildLineForTier(tier.key);
  const emptyReelIndex = isLoss ? Math.floor(Math.random() * 3) : null;
  // On a dollarBonus trigger, the 2 non-DOLLAR reels must show no DIAMOND anywhere — including
  // their random above/below filler, not just the payline (confirmed with user).
  const reels = [0, 1, 2].map((i) =>
    buildReel(lineSymbols[i], tier.key === "dollarBonus" && i !== DOLLAR_REEL_INDEX)
  ) as [ReelResult, ReelResult, ReelResult];

  if (tier.key === "dollarBonus") {
    const pool = paytableConfig.specialReelTiers ?? [];
    return { reels, emptyReelIndex: null, lineWinAmount: 0, bonusTriggered: true, offers: generateOffers(pool) };
  }

  const multiplier = isLoss ? 0 : (tier.payoutMultiplier ?? 0);
  return {
    reels,
    emptyReelIndex,
    lineWinAmount: Math.round(multiplier * betAmount * 100) / 100,
    bonusTriggered: false,
    offers: null,
  };
}
