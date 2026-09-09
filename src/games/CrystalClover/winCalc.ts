/** Shared result shapes for 7 Crystal Clover — kept separate from engine.ts (which now
 * constructs these directly from a rolled discrete tier rather than evaluating paylines
 * combinatorially, see engine.ts's doc comment) purely so both engine.ts and the frontend mirror
 * (frontEnd/src/games/CrystalClover/api.ts) agree on one shape without a circular import. */

import { CrystalCloverSymbol, BAR_FAMILY, WILD_SYMBOL, WinRuleId } from "./config";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. `null` means that reel has
 * no symbol on this row at all (see engine.ts's doc comment: every reel always shows either 1
 * symbol on the middle row, or 2 symbols on the top+bottom rows — never all 3). */
export type Grid = (CrystalCloverSymbol | null)[][];

export interface LineWin {
  lineNumber: number;
  symbol: CrystalCloverSymbol;
  matchCount: number;
  basePayout: number;
  wildCount: number;
  wildMultiplier: number;
  betMultiplier: number;
  finalWin: number;
  positions: [number, number][]; // [reelIndex, rowIndex] for every winning cell on this line
  isPureWild: boolean;
  isAnyBar: boolean;
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  totalLineWin: number;
  multiplierCount: number;
  multiplierFactor: number;
  finalWin: number;
  winningPositions: [number, number][];
}

/** Pure structural classifier — does this line's 3 cells form one of the known win patterns?
 * Any `null` (empty) cell means an automatic non-match, since a reel in either 2-state shape
 * always leaves at least one payline's worth of cells empty on it. Mirrors engine.ts's
 * buildSymbolsForRule exactly, in reverse — the only place either direction of this mapping is
 * defined, so the two can never drift apart. No admin-config dependency (which tier a rule
 * pays as is decided by the caller via ruleTierMap) — same "pure predicate, engine.ts adds the
 * money" split 5x Rewind's isGenuineLoss/isAny3BarOnly use. */
export function classifyLine(cells: [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null]): WinRuleId | null {
  if (cells.some((c) => c === null)) return null;
  const [a, b, c] = cells as [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol];

  const wildCount = [a, b, c].filter((s) => s === WILD_SYMBOL).length;
  if (wildCount === 3) return "THREE_WILD";
  if (wildCount === 2) return "TWO_WILD";
  if (wildCount === 1) return "ONE_WILD";

  if (a === b && b === c) {
    if (a === "SEVEN_CLOVER") return "SEVEN_CLOVER";
    if (a === "TRIPLE_BAR") return "TRIPLE_BAR";
    if (a === "DOUBLE_BAR") return "DOUBLE_BAR";
    if (a === "BAR") return "BAR";
    return null; // MULTIPLIER_2X x3 isn't a real win pattern
  }

  if ((BAR_FAMILY as CrystalCloverSymbol[]).includes(a) && (BAR_FAMILY as CrystalCloverSymbol[]).includes(b) && (BAR_FAMILY as CrystalCloverSymbol[]).includes(c)) {
    return "ANY_BAR";
  }

  return null;
}
