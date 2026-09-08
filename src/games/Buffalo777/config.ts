/** The 11 symbols that have real art and can appear in a paying combination. */
export const DISPLAY_SYMBOLS = [
  "TEN",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
  "BULL",
  "SINGLE_BAR",
  "DOUBLE_BAR",
  "TRIPLE_BAR",
  "MONEY_BAG",
  "COIN",
] as const;

export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

export const BAR_SYMBOLS: ReadonlySet<Symbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"]);

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];
export const DEFAULT_BET = 0.1;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/** Static reference paytable — cosmetic/display only (e.g. the rules popup); the actual
 * credited payout always comes from the live PaytableConfig tier, which starts seeded with
 * these same values but is admin-tunable afterward (see services/paytableConfig.ts). */
export interface PayoutRow {
  symbol: Symbol | "ANY_BAR";
  payout: number;
}

export const REFERENCE_PAYTABLE: PayoutRow[] = [
  { symbol: "COIN", payout: 500 },
  { symbol: "MONEY_BAG", payout: 250 },
  { symbol: "TRIPLE_BAR", payout: 100 },
  { symbol: "DOUBLE_BAR", payout: 75 },
  { symbol: "SINGLE_BAR", payout: 50 },
  { symbol: "ANY_BAR", payout: 15 },
  { symbol: "BULL", payout: 10 },
  { symbol: "ACE", payout: 5 },
  { symbol: "KING", payout: 4 },
  { symbol: "QUEEN", payout: 3 },
  { symbol: "JACK", payout: 2 },
  { symbol: "TEN", payout: 1 },
];
