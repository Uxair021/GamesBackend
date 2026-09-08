/** "null" is the blank/no-value symbol; the rest are real cash values. */
export const DISPLAY_SYMBOLS = ["null", "0", "1", "2", "5", "10"] as const;

export type Symbol = (typeof DISPLAY_SYMBOLS)[number];

export const NULL_SYMBOL: Symbol = "null";
export const ZERO_SYMBOL: Symbol = "0";

/**
 * One strip per reel, all reels sharing this weighting. "null" dominates so that a spin
 * showing 2-3 real numbers (which is what produces the big multi-digit wins via
 * concatenation) stays rare. Verified via Monte Carlo simulation (2M+ spins) at 3 active
 * reels, full-bet tier: ~56% of spins win nothing, BIG WIN(>=100) ~1-in-32,
 * MEGA WIN(>=1000) ~1-in-333, JACKPOT(>=10000) ~1-in-9600.
 */
function buildStrip(): Symbol[] {
  const weights: Record<Symbol, number> = {
    null: 75,
    "0": 10,
    "1": 7,
    "2": 5,
    "5": 2,
    "10": 1,
  };
  const strip: Symbol[] = [];
  for (const symbol of Object.keys(weights) as Symbol[]) {
    for (let i = 0; i < weights[symbol]; i++) strip.push(symbol);
  }

  // Shuffle so same-symbol copies aren't clustered together in the strip's layout order
  // (purely cosmetic — the actual per-spin draw is an independent weighted pick either way).
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }

  return strip;
}

export const REEL_STRIPS: readonly Symbol[][] = [buildStrip(), buildStrip(), buildStrip()];

/**
 * Bet determines how many reels are even in play — 1 reel at the lowest tier, up to all
 * 3 at the highest. `fullBetForReels` is the "100%" bet for that reel count (1, 5, or 10);
 * the win is scaled by (bet / fullBetForReels) so the low-value tier (0.10/0.50/0.90)
 * lands on the *same* RTP as its full-value pair instead of just being a flat fraction of
 * it — verified: e.g. bet=1 and bet=0.10 both average ~37% RTP at the reel weights above.
 */
export interface BetTier {
  bet: number;
  activeReels: number;
  fullBetForReels: number;
}

export const BET_TIERS: BetTier[] = [
  { bet: 0.1, activeReels: 1, fullBetForReels: 1 },
  { bet: 1, activeReels: 1, fullBetForReels: 1 },
  { bet: 0.5, activeReels: 2, fullBetForReels: 5 },
  { bet: 5, activeReels: 2, fullBetForReels: 5 },
  { bet: 0.9, activeReels: 3, fullBetForReels: 10 },
  { bet: 10, activeReels: 3, fullBetForReels: 10 },
];

export const BET_LEVELS = BET_TIERS.map((t) => t.bet).sort((a, b) => a - b);
export const DEFAULT_BET = BET_LEVELS[0];
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

export function getBetTier(bet: number): BetTier | undefined {
  return BET_TIERS.find((t) => Math.abs(t.bet - bet) < 1e-9);
}
