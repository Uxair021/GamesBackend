/** Pure win-evaluation engine for Life of Luxury — no imports from services/ or any other game,
 * so this can be imported by both engine.ts (real spins) and services/paytableConfig.ts (RTP
 * math) without creating a circular dependency. Mirrors VegasHits/winCalc.ts's shape. */

import {
  LifeOfLuxurySymbol,
  REGULAR_SYMBOLS,
  PAYLINES,
  SCATTER_SYMBOL,
  WILD_SYMBOL,
  SCATTER_TRIGGER_COUNT,
  SymbolPayout,
  ScatterRules,
} from "./config";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. Every cell is always
 * filled (plain classic 5x3 grid, unlike VegasHits/Crystal Clover's 2-state 3-reel shape). */
export type Grid = LifeOfLuxurySymbol[][];

export type SymbolPayoutTable = Record<Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">, SymbolPayout>;

export interface LineWin {
  lineNumber: number;
  symbol: Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">;
  /** 3, 4, or 5 — the longest run matched, starting from reel 1. */
  count: 3 | 4 | 5;
  /** This line's own payout, in multiples of the bet (before betAmount is applied). */
  multiplier: number;
  finalWin: number;
  positions: [number, number][]; // [reelIndex, rowIndex] for every winning cell on this line
}

export interface ScatterResult {
  count: number;
  /** Multiple of the bet already applied — 0 if count < SCATTER_TRIGGER_COUNT. */
  win: number;
  positions: [number, number][];
  triggered: boolean;
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  scatter: ScatterResult;
  finalWin: number;
  winningPositions: [number, number][];
}

/** Reads the 5 symbols a payline passes through, one per reel. */
function symbolsOnLine(grid: Grid, line: readonly [number, number, number, number, number]): LifeOfLuxurySymbol[] {
  return line.map((row, reel) => grid[reel][row]);
}

/**
 * Evaluates a single payline: the longest run of one regular symbol starting at reel 1
 * (left-to-right), minimum 3, with WILD substituting for whatever symbol the run started with.
 * COIN (the scatter) breaks a run exactly like a mismatched symbol would. WILD can never itself
 * be the run's target symbol — engine.ts's drawGrid never places it on reel 1 (index 0), so
 * `first` is always a real symbol here; the WILD_SYMBOL check below is defensive only.
 */
export function evaluatePayline(
  grid: Grid,
  line: readonly [number, number, number, number, number],
  lineNumber: number,
  paytable: SymbolPayoutTable,
  bet: number
): LineWin | null {
  const symbols = symbolsOnLine(grid, line);
  const first = symbols[0];
  if (first === SCATTER_SYMBOL || first === WILD_SYMBOL) return null;

  let count = 1;
  while (count < symbols.length && (symbols[count] === first || symbols[count] === WILD_SYMBOL)) count++;
  if (count < 3) return null;

  const matched = first as Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">;
  const runLength = count as 3 | 4 | 5;
  const multiplier = runLength === 3 ? paytable[matched].x3 : runLength === 4 ? paytable[matched].x4 : paytable[matched].x5;
  const positions: [number, number][] = line.slice(0, runLength).map((row, reel) => [reel, row]);

  return {
    lineNumber,
    symbol: matched,
    count: runLength,
    multiplier,
    finalWin: multiplier * bet,
    positions,
  };
}

export function evaluateAllPaylines(grid: Grid, paytable: SymbolPayoutTable, bet: number): LineWin[] {
  return PAYLINES.map((line, i) => evaluatePayline(grid, line, i + 1, paytable, bet)).filter(
    (w): w is LineWin => w !== null
  );
}

/** COIN can land anywhere on the 5x3 grid, doesn't need a payline. 3+ anywhere pays a multiple
 * of the bet (admin-editable, unlike VegasHits' fixed BONUS scatter) and — on a base spin only,
 * see engine.ts's spin() — triggers free spins. "5" means 5 or more (15 cells can hold more). */
export function calculateScatterWin(grid: Grid, bet: number, scatterRules: ScatterRules): ScatterResult {
  const positions: [number, number][] = [];
  grid.forEach((reel, reelIndex) => {
    reel.forEach((symbol, rowIndex) => {
      if (symbol === SCATTER_SYMBOL) positions.push([reelIndex, rowIndex]);
    });
  });

  const count = positions.length;
  if (count < SCATTER_TRIGGER_COUNT) return { count, win: 0, positions, triggered: false };

  const multiplier = count === 3 ? scatterRules.x3 : count === 4 ? scatterRules.x4 : scatterRules.x5;
  return { count, win: multiplier * bet, positions, triggered: true };
}

export function calculateSpinWin(grid: Grid, paytable: SymbolPayoutTable, bet: number, scatterRules: ScatterRules): SpinEvaluation {
  const lineWins = evaluateAllPaylines(grid, paytable, bet);
  const scatter = calculateScatterWin(grid, bet, scatterRules);

  const lineWinTotal = lineWins.reduce((sum, w) => sum + w.finalWin, 0);
  const finalWin = lineWinTotal + scatter.win;

  const winningPositions: [number, number][] = [];
  for (const w of lineWins) winningPositions.push(...w.positions);

  return { lineWins, scatter, finalWin, winningPositions };
}

export { REGULAR_SYMBOLS };
