import { Symbol, DEFAULT_BASE_TIERS } from "./winCalc";

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
export const DEFAULT_BET = 0.5;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/** Static reference paytable for the rules popup — cosmetic/display only, the real payout
 * always comes from winCalc.calculateWin. */
export interface PayoutRow {
  label: string;
  payout: number;
}

export const REFERENCE_PAYTABLE: PayoutRow[] = [
  { label: "2X | 5X | 2X (exact order)", payout: 1000 },
  { label: "2X | 4X | 2X (exact order)", payout: 400 },
  { label: "RED-7 x3", payout: DEFAULT_BASE_TIERS.RED_7 ?? 0 },
  { label: "PURPLE-7 x3", payout: DEFAULT_BASE_TIERS.PURPLE_7 ?? 0 },
  { label: "BLUE-7 x3", payout: DEFAULT_BASE_TIERS.BLUE_7 ?? 0 },
  { label: "7-BAR x3", payout: DEFAULT_BASE_TIERS.SEVEN_BAR ?? 0 },
  { label: "PURPLE-BAR x3", payout: DEFAULT_BASE_TIERS.PURPLE_BAR ?? 0 },
  { label: "RED-BAR x3", payout: DEFAULT_BASE_TIERS.RED_BAR ?? 0 },
  { label: "WHITE-BAR x3", payout: DEFAULT_BASE_TIERS.WHITE_BAR ?? 0 },
  { label: "Any 3 sevens (mixed)", payout: 8 },
  { label: "ANY 3 BAR + 7-BAR (mixed)", payout: 4 },
  { label: "ANY 3 BAR (mixed, no 7-BAR)", payout: 2 },
  { label: "Any 1 or 2 coins: BET x coin multiplier (stacked)", payout: 0 },
  { label: "3 coins: BET x stacked multiplier", payout: 0 },
];

export type { Symbol };
