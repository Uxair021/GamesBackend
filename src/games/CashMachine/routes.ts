import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier } from "./engine";
import { BET_LEVELS, getBetTier } from "./config";
import { WIN_TIERS } from "./winTiers";
import { cashMachineMeta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: cashMachineMeta,
    winTiers: WIN_TIERS,
    betLevels: BET_LEVELS,
  });
});

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);
    const betTier = Number.isFinite(betAmount) ? getBetTier(betAmount) : undefined;

    if (!betTier) {
      res.status(400).json({ error: `betAmount must be one of: ${BET_LEVELS.join(", ")}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(cashMachineMeta.id);

    // Atomically claim the oldest pending forced-outcome directive for this user *on this game*.
    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: cashMachineMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result = forcedOutcome
      ? spinForTier(betTier, forcedOutcome.targetTier, paytableConfig)
      : spin(betTier, paytableConfig);

    user.balance = Math.round((user.balance - betAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: cashMachineMeta.id,
      betAmount,
      winAmount: result.winAmount,
      reelSymbols: [result.symbols],
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
      gameId: cashMachineMeta.id,
      bet: betAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      symbols: result.symbols,
      activeReels: betTier.activeReels,
      respunIndexes: result.respunIndexes,
      winAmount: result.winAmount,
      tier: result.tier,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
