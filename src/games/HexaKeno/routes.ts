import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getRtpMultiplier } from "../../services/gameSettings";
import { emitSpinEvent } from "../../realtime/eventBus";
import { playKeno, validatePicks } from "./engine";
import { BET_LEVELS, DRAWN_COUNT, MAX_BET, MAX_PICKS, MIN_BET, MIN_PICKS, PAYTABLE, POOL_SIZE } from "./config";
import { hexaKenoMeta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: hexaKenoMeta,
    paytable: PAYTABLE,
    betLevels: BET_LEVELS,
    poolSize: POOL_SIZE,
    drawnCount: DRAWN_COUNT,
    minPicks: MIN_PICKS,
    maxPicks: MAX_PICKS,
  });
});

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);
    if (!Number.isFinite(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      res.status(400).json({ error: `betAmount must be between ${MIN_BET} and ${MAX_BET}` });
      return;
    }

    const picksError = validatePicks(req.body?.picks);
    if (picksError) {
      res.status(400).json({ error: picksError });
      return;
    }
    const picks = req.body.picks as number[];

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const rtpMultiplier = await getRtpMultiplier(hexaKenoMeta.id);
    const result = playKeno(picks, betAmount, rtpMultiplier);

    user.balance = Math.round((user.balance - betAmount + result.winAmount) * 100) / 100;

    const [, spinDoc] = await Promise.all([
      user.save(),
      SpinHistory.create({
        userId: user._id,
        gameId: hexaKenoMeta.id,
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: [result.picks.map(String), result.drawn.map(String), result.matched.map(String)],
        balanceAfter: user.balance,
        tier: result.tier,
        forced: false,
        forcedOutcomeId: null,
      }),
    ]);

    emitSpinEvent({
      userId: String(user._id),
      username: user.username,
      gameId: hexaKenoMeta.id,
      bet: betAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: false,
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      picks: result.picks,
      drawn: result.drawn,
      matched: result.matched,
      multiplier: result.multiplier,
      winAmount: result.winAmount,
      tier: result.tier,
      balance: user.balance,
    });
  })
);

export default router;
