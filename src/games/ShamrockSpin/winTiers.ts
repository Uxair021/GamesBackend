import { WinTierName, WinTier, getWinTier as getWinTierGeneric } from "../../gameTiers";

export type { WinTierName };

/** Ordered highest -> lowest so getWinTier can short-circuit on the first match. */
export const WIN_TIERS: WinTier[] = [
  { name: "JACKPOT", minAmount: 400 },
  { name: "MEGA WIN", minAmount: 50 },
  { name: "BIG WIN", minAmount: 20 },
];

/** Looks up the celebration tier for a spin's credited multiplier. */
export function getWinTier(multiplier: number): WinTierName | null {
  return getWinTierGeneric(WIN_TIERS, multiplier);
}
