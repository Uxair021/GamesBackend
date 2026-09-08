/** The 11 symbols that have real art and can appear in a paying combination. */
export const DISPLAY_SYMBOLS = [
  "SHAMROCK_WILD",
  "SHAMROCK_1",
  "SHAMROCK_2",
  "SHAMROCK_3",
  "SHAMROCK_4",
  "GREEN_SEVEN",
  "ORANGE_SEVEN",
  "YELLOW_SEVEN",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
] as const;

/**
 * Every reel stop is one of the 11 real symbols — no non-paying filler. By request.
 * Note: this makes RTP mathematically unable to land near a normal ~95% (every stop
 * belongs to a paying family, so the floor is ~185%+ regardless of weighting — see
 * git history / conversation for the verified numbers). Kept as-is per instruction.
 */
export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

/** All 5 Shamrock Spin variants are wild, substituting for Seven- and Bar-family symbols. */
export const WILD_SYMBOLS: ReadonlySet<Symbol> = new Set([
  "SHAMROCK_WILD",
  "SHAMROCK_1",
  "SHAMROCK_2",
  "SHAMROCK_3",
  "SHAMROCK_4",
]);

/** Only the numbered variants scatter-trigger free spins; the plain wild doesn't. */
export const SCATTER_VALUES: Partial<Record<Symbol, number>> = {
  SHAMROCK_1: 1,
  SHAMROCK_2: 2,
  SHAMROCK_3: 3,
  SHAMROCK_4: 4,
};

export const SEVEN_SYMBOLS: ReadonlySet<Symbol> = new Set(["GREEN_SEVEN", "ORANGE_SEVEN", "YELLOW_SEVEN"]);
export const BAR_SYMBOLS: ReadonlySet<Symbol> = new Set(["TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"]);

/** One strip per reel, all reels sharing this weighting. Each entry's frequency is its weight. */
function buildStrip(): Symbol[] {
  const weights: Record<Symbol, number> = {
    SHAMROCK_WILD: 1,
    SHAMROCK_1: 1,
    SHAMROCK_2: 1,
    SHAMROCK_3: 1,
    SHAMROCK_4: 1,
    GREEN_SEVEN: 4,
    ORANGE_SEVEN: 9,
    YELLOW_SEVEN: 20,
    TRIPLE_BAR: 6,
    DOUBLE_BAR: 14,
    SINGLE_BAR: 35,
  };
  const strip: Symbol[] = [];
  for (const symbol of Object.keys(weights) as Symbol[]) {
    for (let i = 0; i < weights[symbol]; i++) strip.push(symbol);
  }

  // Shuffle so same-symbol copies aren't clustered together — a reel shows 3 *adjacent*
  // strip positions, so an unshuffled strip would often display the same symbol 3x in a
  // row. This is purely cosmetic layout (done once at module load); the actual per-spin
  // stop is still an independent, correctly-weighted secureRandomInt draw either way.
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }

  return strip;
}

export const REEL_STRIPS: readonly Symbol[][] = [buildStrip(), buildStrip(), buildStrip()];

export type WinRuleId =
  | "WILD_JACKPOT"
  | "GREEN_SEVEN"
  | "ORANGE_SEVEN"
  | "YELLOW_SEVEN"
  | "TRIPLE_BAR"
  | "ANY_SEVENS"
  | "ANY_BARS"
  | "SINGLE_BAR"
  | "TWO_WILDS"
  | "ONE_WILD";

export interface WinRule {
  id: WinRuleId;
  basePayout: number;
  freeSpinPayout: number;
}

/** Evaluated highest-to-lowest; the first matching rule is the one paid ("only the highest winner is paid per line"). */
export const WIN_RULES: WinRule[] = [
  { id: "WILD_JACKPOT", basePayout: 400, freeSpinPayout: 4000 },
  { id: "GREEN_SEVEN", basePayout: 100, freeSpinPayout: 100 },
  { id: "ORANGE_SEVEN", basePayout: 50, freeSpinPayout: 50 },
  { id: "YELLOW_SEVEN", basePayout: 30, freeSpinPayout: 30 },
  { id: "TRIPLE_BAR", basePayout: 20, freeSpinPayout: 20 },
  { id: "ANY_SEVENS", basePayout: 15, freeSpinPayout: 15 },
  { id: "ANY_BARS", basePayout: 3, freeSpinPayout: 10 },
  { id: "SINGLE_BAR", basePayout: 5, freeSpinPayout: 5 },
  { id: "TWO_WILDS", basePayout: 2, freeSpinPayout: 2 },
  { id: "ONE_WILD", basePayout: 1, freeSpinPayout: 1 },
];

export const MAX_INITIAL_FREE_SPINS = 9;
export const MAX_TOTAL_FREE_SPINS = 29;

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
export const DEFAULT_BET = 0.1;
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];
