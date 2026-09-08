import { WinTierName, WinTier, getWinTier as getWinTierGeneric } from "../../gameTiers";

export type { WinTierName };

/** Thresholds are absolute win amounts (this game's wins are flat, not multiplier-based). */
export const WIN_TIERS: WinTier[] = [
  { name: "JACKPOT", minAmount: 10000 },
  { name: "MEGA WIN", minAmount: 1000 },
  { name: "BIG WIN", minAmount: 100 },
];

export function getWinTier(amount: number): WinTierName | null {
  return getWinTierGeneric(WIN_TIERS, amount);
}
