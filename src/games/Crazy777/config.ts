/** The symbols that appear on reels 1-3 (the matching reels). There's no separate "EMPTY"
 * symbol — a losing spin instead lands one reel physically between two of these real symbols
 * (see `emptyReelIndex` on SpinResult / the half-stop landing in the frontend Reel class),
 * exactly like a real machine's reel strip. */
export const DISPLAY_SYMBOLS = ["SEVEN_LOW", "SEVEN_MID", "SEVEN_HIGH", "SINGLE_BAR", "DOUBLE_BAR"] as const;

export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

/** The symbols reel 4 (the special reel) can land on — never mixed with DISPLAY_SYMBOLS.
 * "No bonus this round" (specialEmpty tier) is likewise rendered as a half-stop landing
 * between two of these, not a distinct symbol — see `specialIsHalfStop` on SpinResult. */
export const SPECIAL_SYMBOLS = ["MULT_2X", "MULT_5X", "MULT_10X", "DOLLAR_PLUS", "DOUBLE_DOLLAR_PLUS", "RESPIN"] as const;

export type SpecialSymbol = (typeof SPECIAL_SYMBOLS)[number];

export const SEVEN_SYMBOLS: ReadonlySet<Symbol> = new Set(["SEVEN_LOW", "SEVEN_MID", "SEVEN_HIGH"]);
export const BAR_SYMBOLS: ReadonlySet<Symbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR"]);

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20] as const;
export const DEFAULT_BET = 0.1;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/** Static reference paytable — cosmetic/display only (e.g. the rules popup); the actual
 * credited payout always comes from the live PaytableConfig tier, which starts seeded with
 * these same values but is admin-tunable afterward (see services/paytableConfig.ts). Base
 * Win = Pay × Bet for every row below. Confirmed against a reference build: reels 1-3 win
 * on an exact 3-of-a-kind OR a mixed-family combo (ANY 7 / ANY BAR / ANY — mixing both). */
export interface PayoutRow {
  symbol: Symbol | "ANY_SEVEN" | "ANY_BAR" | "ANY_GLOBAL";
  payout: number;
}

export const REFERENCE_PAYTABLE: PayoutRow[] = [
  { symbol: "SEVEN_HIGH", payout: 200 },
  { symbol: "SEVEN_MID", payout: 80 },
  { symbol: "SEVEN_LOW", payout: 40 },
  { symbol: "DOUBLE_BAR", payout: 30 },
  { symbol: "SINGLE_BAR", payout: 15 },
  { symbol: "ANY_SEVEN", payout: 8 },
  { symbol: "ANY_BAR", payout: 5 },
  { symbol: "ANY_GLOBAL", payout: 2 },
];

/** Static reference for reel 4's effects — cosmetic/display only (label/effect text never
 * change), same "seeded but admin-tunable" relationship to the live specialReelTiers table as
 * REFERENCE_PAYTABLE above. `betMultiplier` here is the *seed* value only — the ladder's live
 * LCD readout (routes.ts's /config) always pulls the real number from the saved PaytableConfig
 * instead, same as `paytable`/`payout` above. */
export interface SpecialPayoutRow {
  symbol: SpecialSymbol;
  label: string;
  effect: string;
  /** Bet-multiplier bonus for DOLLAR_PLUS/DOUBLE_DOLLAR_PLUS (finalWin = baseWin + this × bet) — null for the others. */
  betMultiplier: number | null;
}

export const REFERENCE_SPECIAL_PAYTABLE: SpecialPayoutRow[] = [
  { symbol: "MULT_10X", label: "10X", effect: "Base win × 10", betMultiplier: null },
  { symbol: "MULT_5X", label: "5X", effect: "Base win × 5", betMultiplier: null },
  { symbol: "MULT_2X", label: "2X", effect: "Base win × 2", betMultiplier: null },
  { symbol: "DOUBLE_DOLLAR_PLUS", label: "$$+", effect: "+ bonus on top of base win", betMultiplier: 8 },
  { symbol: "DOLLAR_PLUS", label: "$+", effect: "+ bonus on top of base win", betMultiplier: 3 },
  { symbol: "RESPIN", label: "RESPIN", effect: "1-5 free re-spins", betMultiplier: null },
];
