/** Pure win-evaluation for Rubber Duck — no imports from services/ or any other game, so this
 * can be imported by both engine.ts (real spins) and services/paytableConfig.ts (RTP math)
 * without creating a circular dependency. */

import { Symbol, PayingSymbol, BONUS_SYMBOL, FREE_SPIN_TRIGGER_COUNT, FREE_SPIN_WIN_MULTIPLIER } from "./config";

export type Reels = Symbol[]; // length REEL_COUNT (5), one symbol per reel

export type PayoutTable = Partial<Record<PayingSymbol, number>>;

export interface PositionWin {
  reelIndex: number;
  symbol: PayingSymbol;
  /** This position's own contribution to finalWin — already includes the free-spin 3x if
   * `isFreeSpin` was true, so the client can show it directly next to the symbol. */
  win: number;
}

export interface SpinEvaluation {
  positionWins: PositionWin[];
  /** Reel indices with a paying-symbol hit — what the client draws the blinking blue border on. */
  winningPositions: number[];
  bonusCount: number;
  /** True once bonusCount >= FREE_SPIN_TRIGGER_COUNT (rule 2) — engine.ts decides what that
   * means (award 15, or +10 if already mid-round) since this module doesn't know spin context. */
  triggered: boolean;
  finalWin: number;
}

/** Every reel is evaluated independently — no adjacency/matching requirement at all (confirmed
 * with user: "whatever the symbol comes even a one symbol hit the win... if more then one then
 * win will be adding all the points"). BONUS never contributes cash here; its only effect is
 * bonusCount/triggered, consumed by engine.ts to decide free-spin awards. */
export function evaluateSpin(reels: Reels, paytable: PayoutTable, bet: number, isFreeSpin: boolean): SpinEvaluation {
  const scale = isFreeSpin ? FREE_SPIN_WIN_MULTIPLIER : 1;
  const positionWins: PositionWin[] = [];
  const winningPositions: number[] = [];
  let bonusCount = 0;
  let finalWin = 0;

  reels.forEach((symbol, reelIndex) => {
    if (symbol === BONUS_SYMBOL) {
      bonusCount += 1;
      return;
    }
    const payout = paytable[symbol as PayingSymbol];
    if (!payout) return; // fruit symbol (or a paying symbol an admin zeroed out) — no win
    const win = Math.round(payout * bet * scale * 100) / 100;
    positionWins.push({ reelIndex, symbol: symbol as PayingSymbol, win });
    winningPositions.push(reelIndex);
    finalWin += win;
  });

  return {
    positionWins,
    winningPositions,
    bonusCount,
    triggered: bonusCount >= FREE_SPIN_TRIGGER_COUNT,
    finalWin: Math.round(finalWin * 100) / 100,
  };
}
