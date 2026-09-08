import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier } from "./engine";
import { REFERENCE_SPECIAL_PAYTABLE, BET_LEVELS, MIN_BET, MAX_BET, PayoutRow, SpecialPayoutRow } from "./config";
import { crazy777Meta } from "./meta";
import { TierKey } from "../../models/PaytableConfig";

const router = Router();

/** Maps each line tier key to the display symbol its ladder row/LCD represents. */
const LINE_TIER_DISPLAY: Partial<Record<TierKey, PayoutRow["symbol"]>> = {
  sevenHigh: "SEVEN_HIGH",
  sevenMid: "SEVEN_MID",
  sevenLow: "SEVEN_LOW",
  doubleBar: "DOUBLE_BAR",
  singleBar: "SINGLE_BAR",
  anySeven: "ANY_SEVEN",
  anyBar: "ANY_BAR",
  anyGlobal: "ANY_GLOBAL",
};

const SPECIAL_TIER_DISPLAY: Partial<Record<TierKey, SpecialPayoutRow["symbol"]>> = {
  multiplier2x: "MULT_2X",
  multiplier5x: "MULT_5X",
  multiplier10x: "MULT_10X",
  dollarPlus: "DOLLAR_PLUS",
  doubleDollarPlus: "DOUBLE_DOLLAR_PLUS",
  respin: "RESPIN",
};

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    // Live values (admin-tunable via the RTP panel), not a static snapshot — the in-game
    // ladder should always show what's actually configured right now.
    const paytableConfig = await getPaytableConfig(crazy777Meta.id);

    const paytable: PayoutRow[] = paytableConfig.tiers
      .map((t) => {
        const symbol = LINE_TIER_DISPLAY[t.key];
        return symbol && t.payoutMultiplier !== null ? { symbol, payout: t.payoutMultiplier } : null;
      })
      .filter((row): row is PayoutRow => row !== null);

    const specialLabels = new Map(REFERENCE_SPECIAL_PAYTABLE.map((r) => [r.symbol, r]));
    const specialPaytable: SpecialPayoutRow[] = (paytableConfig.specialReelTiers ?? [])
      .map((t) => {
        const symbol = SPECIAL_TIER_DISPLAY[t.key];
        const ref = symbol ? specialLabels.get(symbol) : undefined;
        if (!symbol || !ref) return null;
        const isBetBonus = t.key === "dollarPlus" || t.key === "doubleDollarPlus";
        return { symbol, label: ref.label, effect: ref.effect, betMultiplier: isBetBonus ? t.payoutMultiplier : null };
      })
      .filter((row): row is SpecialPayoutRow => row !== null);

    res.json({
      meta: crazy777Meta,
      paytable,
      specialPaytable,
      betLevels: BET_LEVELS,
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);
    const isRespin = Boolean(req.body?.respin);

    if (!Number.isFinite(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      res.status(400).json({ error: `betAmount must be between ${MIN_BET} and ${MAX_BET}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!isRespin && user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(crazy777Meta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: crazy777Meta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result = forcedOutcome
      ? spinForTier(betAmount, forcedOutcome.targetTier, paytableConfig)
      : spin(betAmount, paytableConfig, isRespin);

    const stakedAmount = isRespin ? 0 : betAmount;
    user.balance = Math.round((user.balance - stakedAmount + result.finalWin) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: crazy777Meta.id,
      betAmount: stakedAmount,
      winAmount: result.finalWin,
      reelSymbols: [...result.reels.map((r) => r.symbols), result.specialReel.symbols],
      balanceAfter: user.balance,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      forcedOutcomeId: forcedOutcome?._id ?? null,
    });

    if (forcedOutcome) {
      forcedOutcome.consumedSpinId = spinDoc._id;
      await forcedOutcome.save();
    }

    emitSpinEvent({
      userId: String(user._id),
      username: user.username,
      gameId: crazy777Meta.id,
      bet: stakedAmount,
      winAmount: result.finalWin,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      reels: result.reels.map((r) => r.symbols),
      lineSymbols: result.lineSymbols,
      specialReel: result.specialReel.symbols,
      lineWinTierKey: result.lineWinTierKey,
      baseWin: result.baseWin,
      winAmount: result.finalWin,
      respinsAwarded: result.respinsAwarded,
      tier: result.tier,
      emptyReelIndex: result.emptyReelIndex,
      specialIsHalfStop: result.specialIsHalfStop,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
