/** The 8 symbols that have real art. */
export const DISPLAY_SYMBOLS = [
  "TEN_X",
  "THREE_X",
  "SEVEN",
  "SEVEN_BAR",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
  "CHERRY",
] as const;

export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
export const DEFAULT_BET = 0.1;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/** The 4 "bar family" symbols — SEVEN_BAR counts as a bar for the broader mixed-bar category
 * (ANY_BAR_FAMILY_MIX) but also has its own narrower pairing with SINGLE_BAR
 * (ANY_SINGLE_SEVENBAR_MIX) — mirrors 5x Rewind's BAR_FAMILY/WHITE_OR_SEVEN split exactly. */
const BAR_FAMILY: ReadonlySet<Symbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR", "SEVEN_BAR"]);
const SEVEN_FAMILY: ReadonlySet<Symbol> = new Set(["SEVEN", "SEVEN_BAR"]);
const SINGLE_OR_SEVENBAR: ReadonlySet<Symbol> = new Set(["SINGLE_BAR", "SEVEN_BAR"]);

/** Structural predicates for the 3 "mixed" line categories — independent of admin-configured
 * payout values, these only ask "does this triple structurally belong to this category".
 * Checked in this exact priority order by engine.ts (narrowest first) since a SINGLE_BAR +
 * SEVEN_BAR mix would otherwise also structurally satisfy the broader bar-family category. */
export function isAny3SevenFamily(s1: Symbol, s2: Symbol, s3: Symbol): boolean {
  if (!SEVEN_FAMILY.has(s1) || !SEVEN_FAMILY.has(s2) || !SEVEN_FAMILY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

export function isAny3SingleSevenBarMix(s1: Symbol, s2: Symbol, s3: Symbol): boolean {
  if (!SINGLE_OR_SEVENBAR.has(s1) || !SINGLE_OR_SEVENBAR.has(s2) || !SINGLE_OR_SEVENBAR.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

export function isAny3BarFamilyMix(s1: Symbol, s2: Symbol, s3: Symbol): boolean {
  if (!BAR_FAMILY.has(s1) || !BAR_FAMILY.has(s2) || !BAR_FAMILY.has(s3)) return false;
  if (s1 === s2 && s2 === s3) return false;
  return !isAny3SingleSevenBarMix(s1, s2, s3);
}

/** A line that matches none of the exact-3-of-a-kind or mixed categories below, and has zero
 * CHERRY on it (1 or 2 CHERRY are their own tiers — see engine.ts). */
export function isGenuineLoss(s1: Symbol, s2: Symbol, s3: Symbol): boolean {
  if ([s1, s2, s3].some((s) => s === "CHERRY")) return false;
  if (s1 === s2 && s2 === s3) return false;
  if (isAny3SevenFamily(s1, s2, s3)) return false;
  if (isAny3SingleSevenBarMix(s1, s2, s3)) return false;
  if (isAny3BarFamilyMix(s1, s2, s3)) return false;
  return true;
}

/** Static reference paytable for the rules popup — cosmetic/display only; the real payout
 * always comes from the live PaytableConfig tier (see services/paytableConfig.ts). */
export interface PayoutRow {
  label: string;
  symbol: Symbol | null;
  payout: number;
}

export const REFERENCE_PAYTABLE: PayoutRow[] = [
  { label: "10X PAY x3", symbol: "TEN_X", payout: 5000 },
  { label: "3X PAY x3", symbol: "THREE_X", payout: 2000 },
  { label: "CHERRY x3", symbol: "CHERRY", payout: 64 },
  { label: "7 x3", symbol: "SEVEN", payout: 15 },
  { label: "7-BAR x3", symbol: "SEVEN_BAR", payout: 10 },
  { label: "1 CHERRY (anywhere on the line)", symbol: null, payout: 10 },
  { label: "TRIPLE BAR x3", symbol: "TRIPLE_BAR", payout: 8 },
  { label: "Any 3 (7 / 7-BAR mixed)", symbol: null, payout: 8 },
  { label: "DOUBLE BAR x3", symbol: "DOUBLE_BAR", payout: 6 },
  { label: "Any 3 (SINGLE/DOUBLE/TRIPLE BAR / 7-BAR mixed)", symbol: null, payout: 6 },
  { label: "SINGLE BAR x3", symbol: "SINGLE_BAR", payout: 4 },
  { label: "Any 3 (SINGLE BAR / 7-BAR mixed)", symbol: null, payout: 4 },
  { label: "2 CHERRY on the line", symbol: null, payout: 2 },
];
