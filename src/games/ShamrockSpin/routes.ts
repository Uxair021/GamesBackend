import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier } from "./engine";
import { WIN_RULES, BET_LEVELS, MIN_BET, MAX_BET, MAX_TOTAL_FREE_SPINS } from "./config";
import { shamrockSpinMeta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: shamrockSpinMeta,
    winRules: WIN_RULES,
    betLevels: BET_LEVELS,
    maxTotalFreeSpins: MAX_TOTAL_FREE_SPINS,
  });
});

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);
    const isFreeSpin = Boolean(req.body?.freeSpin);

    if (!Number.isFinite(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      res.status(400).json({ error: `betAmount must be between ${MIN_BET} and ${MAX_BET}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!isFreeSpin && user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(shamrockSpinMeta.id);

    // Atomically claim the oldest pending forced-outcome directive for this user *on this
    // game* — scoped by gameId so a directive queued for another game isn't consumed here.
    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: shamrockSpinMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result = forcedOutcome
      ? spinForTier(betAmount, isFreeSpin, forcedOutcome.targetTier, paytableConfig)
      : spin(betAmount, isFreeSpin, paytableConfig);

    const stakedAmount = isFreeSpin ? 0 : betAmount;
    user.balance = Math.round((user.balance - stakedAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: shamrockSpinMeta.id,
      betAmount: stakedAmount,
      winAmount: result.winAmount,
      reelSymbols: result.reels.map((r) => r.symbols),
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
      gameId: shamrockSpinMeta.id,
      bet: stakedAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      reels: result.reels.map((r) => r.symbols),
      lineSymbols: result.lineSymbols,
      winRuleId: result.winRuleId,
      multiplier: result.multiplier,
      winAmount: result.winAmount,
      tier: result.tier,
      freeSpinsAwarded: result.freeSpinsAwarded,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
