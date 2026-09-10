import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { FreeSpinRound } from "../../models/FreeSpinRound";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier, SpinResult } from "./engine";
import { rubberDuckMeta } from "./meta";
import {
  BET_LEVELS,
  REFERENCE_PAYTABLE,
  FREE_SPIN_TRIGGER_COUNT,
  FREE_SPINS_BASE,
  FREE_SPINS_RETRIGGER,
  FREE_SPIN_WIN_MULTIPLIER,
} from "./config";

const router = Router();

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const paytableConfig = await getPaytableConfig(rubberDuckMeta.id);

    const paytable = REFERENCE_PAYTABLE.map((row) => {
      const tier = paytableConfig.tiers.find((t) => t.key === row.symbol);
      return { symbol: row.symbol, payout: tier?.payoutMultiplier ?? row.payout };
    });
    // The reel builds its own cosmetic scrolling filler client-side, so it needs these weights
    // to replicate the same symbol distribution admin configured — the landed reels themselves
    // always come from the server's spin response, this is filler only (mirrors LifeOfLuxury).
    const symbolWeights = Object.fromEntries(paytableConfig.tiers.map((t) => [t.key, t.frequencyPercent]));

    res.json({
      meta: rubberDuckMeta,
      betLevels: BET_LEVELS,
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
      paytable,
      symbolWeights,
      freeSpins: {
        triggerCount: FREE_SPIN_TRIGGER_COUNT,
        base: FREE_SPINS_BASE,
        retrigger: FREE_SPINS_RETRIGGER,
        winMultiplier: FREE_SPIN_WIN_MULTIPLIER,
      },
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bet = Number(req.body?.bet);
    if (!Number.isFinite(bet) || !BET_LEVELS.includes(bet)) {
      res.status(400).json({ error: `bet must be one of ${BET_LEVELS.join(", ")}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Authoritative, not the client's own claim — a round only exists here once a base spin
    // actually triggered one (see below), same pattern Life of Luxury's routes.ts uses.
    let activeRound = await FreeSpinRound.findOne({ userId: user._id, gameId: rubberDuckMeta.id });
    const isFreeSpin = Boolean(activeRound && activeRound.remaining > 0);

    if (!isFreeSpin && user.balance < bet) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(rubberDuckMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: rubberDuckMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result: SpinResult = forcedOutcome
      ? spinForTier(bet, forcedOutcome.targetTier, paytableConfig)
      : spin(bet, paytableConfig, isFreeSpin);

    let freeSpinsAwarded: number | null = null;
    let retriggered = false;
    let freeSpinRoundResult: { totalWin: number; totalSpins: number } | null = null;

    if (isFreeSpin && activeRound) {
      activeRound.totalWin += result.winAmount;
      activeRound.remaining -= 1;

      // Rule 2: 3+ BONUS while already in a free-spins round adds 10 more to what's left,
      // rather than starting a fresh batch — confirmed with user ("10 additional free spins if
      // already in free game").
      if (result.evaluation.triggered) {
        activeRound.remaining += FREE_SPINS_RETRIGGER;
        activeRound.totalSpins += FREE_SPINS_RETRIGGER;
        retriggered = true;
      }

      if (activeRound.remaining <= 0) {
        freeSpinRoundResult = { totalWin: activeRound.totalWin, totalSpins: activeRound.totalSpins };
        await FreeSpinRound.deleteOne({ _id: activeRound._id });
        activeRound = null;
      } else {
        await activeRound.save();
      }
    } else if (result.evaluation.triggered) {
      // A base spin's own BONUS trigger starts the round others will play through.
      freeSpinsAwarded = FREE_SPINS_BASE;
      await FreeSpinRound.findOneAndUpdate(
        { userId: user._id, gameId: rubberDuckMeta.id },
        {
          $set: {
            betAmount: bet,
            totalSpins: FREE_SPINS_BASE,
            remaining: FREE_SPINS_BASE,
            wildCount: 0,
            totalWin: 0,
          },
        },
        { upsert: true }
      );
    }

    const stakedAmount = isFreeSpin ? 0 : bet;
    user.balance = Math.round((user.balance - stakedAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: rubberDuckMeta.id,
      betAmount: stakedAmount,
      winAmount: result.winAmount,
      reelSymbols: result.reels.map((symbol) => [symbol]),
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
      gameId: rubberDuckMeta.id,
      bet: stakedAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      reels: result.reels,
      evaluation: result.evaluation,
      winAmount: result.winAmount,
      tier: result.tier,
      freeSpinsAwarded,
      retriggered,
      freeSpinRoundResult,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
