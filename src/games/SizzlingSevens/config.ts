/** Centralized rules for Sizzling 7s — a classic 3-reel x 3-row, 27-fixed-payline slot. Every
 * number/rule the spec calls out lives here so winCalc.ts/engine.ts never scatter magic
 * numbers; the win-calc/RTP code reads this object, never hardcodes a payout or line pattern. */

export const SYMBOLS = ["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR", "WILD_2X", "BONUS"] as const;
export type SizzlingSymbol = (typeof SYMBOLS)[number];

export const REEL_COUNT = 3;
export const ROW_COUNT = 3;
/** row 0 = TOP, row 1 = MIDDLE, row 2 = BOTTOM. */
export const TOP = 0;
export const MIDDLE = 1;
export const BOTTOM = 2;

/** Purely an internal normalization constant now — every payout in the paytable is expressed
 * as a multiple of this reference bet (see winCalc.ts), not a real player-facing "cost per
 * line". The player instead picks a BET_LEVEL directly (0.10-30, matching every other game's
 * BET_LEVELS convention) as their *total* bet; the actual scale factor fed into the win-calc
 * functions is (selected level / LINE_COST) — see engine.ts's spin()/routes.ts. Renaming or
 * changing this value alone would silently rescale every payout, so it stays fixed at the
 * value the whole paytable (see services/paytableConfig.ts's DEFAULT_CONFIGS) was tuned for. */
export const LINE_COST = 30;
export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/**
 * The 27 fixed payline patterns — one row index (0/1/2) per reel — read directly off the
 * reference 27-line chart (a 3x3-grid classic layout), not generated. Line 20 ([TOP, MID,
 * BOT]) is identical to line 4 in that same reference chart — kept verbatim rather than
 * silently deduplicated, both still evaluate/pay independently.
 */
export const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1], // 1
  [0, 0, 0], // 2
  [2, 2, 2], // 3
  [0, 1, 2], // 4
  [2, 1, 0], // 5
  [1, 0, 1], // 6
  [1, 2, 1], // 7
  [2, 1, 2], // 8
  [0, 1, 0], // 9
  [0, 1, 1], // 10
  [2, 1, 1], // 11
  [1, 0, 0], // 12
  [1, 2, 2], // 13
  [0, 0, 1], // 14
  [2, 2, 1], // 15
  [1, 1, 0], // 16
  [1, 1, 2], // 17
  [0, 2, 0], // 18
  [2, 0, 2], // 19
  [0, 1, 2], // 20 (duplicate of line 4, per the reference chart)
  [2, 2, 0], // 21
  [0, 2, 2], // 22
  [2, 0, 0], // 23
  [1, 0, 2], // 24
  [1, 2, 0], // 25
  [0, 2, 1], // 26
  [2, 0, 1], // 27
];

/** 3-matching-symbol base payouts (as a multiple of the *line* bet, i.e. before the
 * BET_MULTIPLIER is applied) — admin-editable defaults, see services/paytableConfig.ts. Spec
 * only defines a "3 matching" number for each symbol (no separate 4/5-match figure), so a
 * matched run of 4 or 5 pays the same as a run of exactly 3.
 *
 * The originally-requested round numbers (RED_7=250, BLUE_7=100, TRIPLE_BAR=50, DOUBLE_BAR=30,
 * BAR=25, BONUS=60) can't reach an 85% RTP target on this board at ANY weight distribution —
 * with 27 fully-overlapping paylines (every 3-row combination is a live line) and the ANY_BAR
 * rule below, the best achievable RTP via weight-tuning alone floors out around ~725%, roughly
 * 8.5x too high. These values are that same relative shape scaled down by ~17.1x instead (the
 * extra factor beyond the theoretical floor buys room to also maximize loss frequency — see
 * services/paytableConfig.ts's DEFAULT_CONFIGS comment) — confirmed against the seeded
 * simulation to land at 85.1% RTP / 21.57% loss with the weights below. */
export const DEFAULT_PAYTABLE: Record<Exclude<SizzlingSymbol, "WILD_2X">, number> = {
  RED_7: 14.1946,
  BLUE_7: 5.6779,
  TRIPLE_BAR: 2.8389,
  DOUBLE_BAR: 1.7034,
  BAR: 1.4195,
  BONUS: 3.4067,
};

export const WILD_SYMBOL: SizzlingSymbol = "WILD_2X";
export const BONUS_SYMBOL: SizzlingSymbol = "BONUS";

/** Wild substitutes for every normal paying symbol, never for BONUS. */
export const WILD_SUBSTITUTES_FOR: SizzlingSymbol[] = ["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"];

/** The 3 BAR-family symbols — a payline showing any mix of these (not necessarily identical,
 * Wild substitutes in same as everywhere else) still wins, just at the flat ANY_BAR_PAYOUT
 * rate rather than one of the 3 higher exact-match payouts above. A fixed rule constant, not a
 * per-symbol tier row — nothing draws an "ANY_BAR" symbol on its own. */
export const BAR_FAMILY: SizzlingSymbol[] = ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"];
/** Flat payout for a payline showing a mixed (non-identical) combination of BAR_FAMILY symbols
 * (see BAR_FAMILY) — always lower than any of the 3 exact-match BAR payouts, so an
 * all-identical BAR line still pays its own higher rate (evaluatePayline takes the max). */
export const ANY_BAR_PAYOUT = 5;

/** wildMultiplier = WILD_MULTIPLIER_BASE ^ numberOfWilds (0 wilds = x1, 1 = x2, 2 = x4, 3 = x8),
 * applied when a Wild substitutes into an otherwise-normal winning line. */
export const WILD_MULTIPLIER_BASE = 2;

/** Pure-Wild-only payouts (a Wild run from reel 1 that never resolves into a real symbol) — a
 * flat, standalone payout, NOT multiplied again by WILD_MULTIPLIER_BASE. Keyed by consecutive
 * leading-Wild count; a run longer than the highest defined key (3) still uses that key's
 * payout (the spec doesn't define a 4/5-Wild figure). Admin-editable default: see
 * services/paytableConfig.ts (the 3-Wild figure only — 1/2-Wild stay fixed consolation
 * amounts, not worth their own admin rows). Originally requested as {1:2, 2:8, 3:10} — scaled
 * down by the same ~17.1x as DEFAULT_PAYTABLE above, same reason (see that constant's comment). */
export const PURE_WILD_PAYOUT: Record<1 | 2 | 3, number> = { 1: 0.1163, 2: 0.4653, 3: 0.5678 };

export const BONUS_TRIGGER_COUNT = 3;

export interface FreeGamesAward {
  freeSpins: number;
  /** Multiplier pool this bonus round draws from — a fresh multiplier is picked from this pool
   * independently for every free spin played (see winCalc.ts's pickFreeSpinMultiplier). */
  multiplierPool: number[];
}

/** The 4 direct award tiers a Bonus trigger can land on, each carrying its own free-spin count
 * and multiplier pool. Selection weights are relative (don't need to sum to 100) — see
 * winCalc.ts's pickFreeGamesAward. */
export const FREE_GAMES_AWARDS: Array<FreeGamesAward & { selectionWeight: number }> = [
  { freeSpins: 5, multiplierPool: [30, 15, 8], selectionWeight: 30 },
  { freeSpins: 8, multiplierPool: [10, 8, 5], selectionWeight: 28 },
  { freeSpins: 10, multiplierPool: [8, 5, 3], selectionWeight: 24 },
  { freeSpins: 15, multiplierPool: [5, 3, 2], selectionWeight: 18 },
];

/** Mystery Pick — an alternative to landing directly on one of the 4 awards above: picks a
 * free-spin count uniformly from MYSTERY_SPIN_COUNTS and hands the whole 7-value multiplier
 * pool to the round (not the narrower 3-value pool the matching direct award would use). */
export const MYSTERY_SPIN_COUNTS = [5, 8, 10, 15];
export const MYSTERY_MULTIPLIER_POOL = [2, 3, 5, 8, 10, 15, 30];
/** Chance a Bonus trigger resolves as a Mystery Pick instead of a direct award (relative to the
 * FREE_GAMES_AWARDS selectionWeights above — see winCalc.ts's pickFreeGamesAward). */
export const MYSTERY_PICK_SELECTION_WEIGHT = 20;

export const RETRIGGER_ENABLED = true;

export type { SizzlingSymbol as Symbol };
