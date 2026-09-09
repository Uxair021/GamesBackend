/** The 12 symbols that have real art. BONUS never pays a multiplier directly — 3 BONUS on
 * the line instead triggers the free-spins feature (see engine.ts). */
export const DISPLAY_SYMBOLS = [
  "APPLE",
  "LEMON",
  "ORANGE",
  "PEACH",
  "PINEAPPLE",
  "GRAPE",
  "WATERMELON",
  "DRAGON_FRUIT",
  "SEVEN",
  "BAR",
  "STAR",
  "BONUS",
] as const;

export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

/** The 8 "fruit" symbols — these get the slash/juice win treatment (see pixi/Reel.ts on the
 * frontend); SEVEN/BAR/STAR/BONUS keep a plain gold pulse-glow instead. */
export const FRUIT_SYMBOLS: ReadonlySet<Symbol> = new Set([
  "APPLE",
  "LEMON",
  "ORANGE",
  "PEACH",
  "PINEAPPLE",
  "GRAPE",
  "WATERMELON",
  "DRAGON_FRUIT",
]);

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];
export const DEFAULT_BET = 0.1;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/** Random range for a triggered Bonus round (confirmed with user: random 3-10, no
 * admin-tunable range — see plan). */
export const MIN_FREE_SPINS = 3;
export const MAX_FREE_SPINS = 10;

/** Static reference paytable — cosmetic/display only; the actual credited payout always
 * comes from the live PaytableConfig tier, which starts seeded with these same values but is
 * admin-tunable afterward (see services/paytableConfig.ts). */
export interface PayoutRow {
  symbol: Symbol;
  payout: number;
}

export const REFERENCE_PAYTABLE: PayoutRow[] = [
  { symbol: "STAR", payout: 250 },
  { symbol: "BAR", payout: 100 },
  { symbol: "SEVEN", payout: 75 },
  { symbol: "DRAGON_FRUIT", payout: 50 },
  { symbol: "WATERMELON", payout: 15 },
  { symbol: "GRAPE", payout: 10 },
  { symbol: "PINEAPPLE", payout: 5 },
  { symbol: "PEACH", payout: 4 },
  { symbol: "ORANGE", payout: 3 },
  { symbol: "LEMON", payout: 2 },
  { symbol: "APPLE", payout: 1 },
];
