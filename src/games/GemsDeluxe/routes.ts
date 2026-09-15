import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { GemsDeluxeBonus } from "../../models/GemsDeluxeBonus";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin } from "./engine";
import { REFERENCE_PAYTABLE, REFERENCE_BONUS_POOL, BET_LEVELS, OFFER_COUNT } from "./config";
import { gemsDeluxeMeta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: gemsDeluxeMeta,
    paytable: REFERENCE_PAYTABLE,
    bonusPool: REFERENCE_BONUS_POOL,
    offerCount: OFFER_COUNT,
    betLevels: BET_LEVELS,
  });
});

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);

    if (!BET_LEVELS.includes(betAmount)) {
      res.status(400).json({ error: `betAmount must be one of ${BET_LEVELS.join(", ")}` });
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

    const paytableConfig = await getPaytableConfig(gemsDeluxeMeta.id);
    const result = spin(betAmount, paytableConfig);

    user.balance = Math.round((user.balance - betAmount + result.lineWinAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: gemsDeluxeMeta.id,
      betAmount,
      winAmount: result.lineWinAmount,
      reelSymbols: result.reels.map((r) => r.symbols),
      balanceAfter: user.balance,
      tier: null,
      forced: false,
      forcedOutcomeId: null,
    });

    if (!result.bonusTriggered || !result.offers) {
      emitSpinEvent({
        userId: String(user._id),
        username: user.username,
        gameId: gemsDeluxeMeta.id,
        bet: betAmount,
        winAmount: result.lineWinAmount,
        tier: null,
        forced: false,
        balanceAfter: user.balance,
        createdAt: spinDoc.createdAt.toISOString(),
      });

      res.json({
        reels: result.reels,
        emptyReelIndex: result.emptyReelIndex,
        winAmount: result.lineWinAmount,
        balance: user.balance,
        bonusTriggered: false,
      });
      return;
    }

    const bonus = await GemsDeluxeBonus.create({
      userId: user._id,
      betAmount,
      reelSymbols: result.reels.flatMap((r) => r.symbols),
      offers: result.offers,
      currentIndex: 0,
      status: "pending",
      spinHistoryId: spinDoc._id,
    });

    res.json({
      reels: result.reels,
      winAmount: 0,
      balance: user.balance,
      bonusTriggered: true,
      bonusId: String(bonus._id),
      currentOffer: result.offers[0],
      offerNumber: 1,
      offerCount: OFFER_COUNT,
      isLastOffer: (OFFER_COUNT as number) <= 1,
    });
  })
);

/** Reveals the next pre-rolled offer (a "Try Again" click) — never the last one twice, and
 * never an index the client picked; see models/GemsDeluxeBonus.ts's doc comment for why the
 * full offer sequence is never sent up front. */
router.post(
  "/bonus-advance",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bonusId = String(req.body?.bonusId ?? "");
    const bonus = await GemsDeluxeBonus.findOne({ _id: bonusId, userId: req.userId, status: "pending" });
    if (!bonus) {
      res.status(404).json({ error: "No pending bonus round found" });
      return;
    }
    if (bonus.currentIndex >= bonus.offers.length - 1) {
      res.status(400).json({ error: "Already on the last offer" });
      return;
    }

    bonus.currentIndex += 1;
    await bonus.save();

    res.json({
      currentOffer: bonus.offers[bonus.currentIndex],
      offerNumber: bonus.currentIndex + 1,
      offerCount: bonus.offers.length,
      isLastOffer: bonus.currentIndex === bonus.offers.length - 1,
    });
  })
);

/** Take It — always credits whichever offer is currently revealed server-side for this bonus
 * (bonus.currentIndex), regardless of what the client sends. On the forced last offer, the
 * client is expected to call this directly instead of /bonus-advance (confirmed with user:
 * the last offer is auto-accepted, no real Try Again choice left). */
router.post(
  "/bonus-resolve",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bonusId = String(req.body?.bonusId ?? "");
    const bonus = await GemsDeluxeBonus.findOne({ _id: bonusId, userId: req.userId, status: "pending" });
    if (!bonus) {
      res.status(404).json({ error: "No pending bonus round found" });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const winAmount = bonus.offers[bonus.currentIndex];
    user.balance = Math.round((user.balance + winAmount) * 100) / 100;
    await user.save();

    bonus.status = "resolved";
    bonus.resolvedAt = new Date();
    await bonus.save();

    await SpinHistory.findByIdAndUpdate(bonus.spinHistoryId, {
      winAmount,
      balanceAfter: user.balance,
    });

    emitSpinEvent({
      userId: String(user._id),
      username: user.username,
      gameId: gemsDeluxeMeta.id,
      bet: 0,
      winAmount,
      tier: null,
      forced: false,
      balanceAfter: user.balance,
      createdAt: bonus.resolvedAt.toISOString(),
    });

    res.json({ balance: user.balance, winAmount });
  })
);

export default router;
