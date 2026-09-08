import { Router } from "express";
import shamrockSpinRoutes from "../games/ShamrockSpin/routes";
import { shamrockSpinMeta } from "../games/ShamrockSpin/meta";
import cashMachineRoutes from "../games/CashMachine/routes";
import { cashMachineMeta } from "../games/CashMachine/meta";
import buffalo777Routes from "../games/Buffalo777/routes";
import { buffalo777Meta } from "../games/Buffalo777/meta";
import crazy777Routes from "../games/Crazy777/routes";
import { crazy777Meta } from "../games/Crazy777/meta";
import fiveXRewindRoutes from "../games/FiveXRewind/routes";
import { fiveXRewindMeta } from "../games/FiveXRewind/meta";
import sizzlingSevensRoutes from "../games/SizzlingSevens/routes";
import { sizzlingSevensMeta } from "../games/SizzlingSevens/meta";

// Add each new game's meta + router here as it's built.
const games = [
  { meta: shamrockSpinMeta, router: shamrockSpinRoutes },
  { meta: cashMachineMeta, router: cashMachineRoutes },
  { meta: buffalo777Meta, router: buffalo777Routes },
  { meta: crazy777Meta, router: crazy777Routes },
  { meta: fiveXRewindMeta, router: fiveXRewindRoutes },
  { meta: sizzlingSevensMeta, router: sizzlingSevensRoutes },
];

const router = Router();

router.get("/", (_req, res) => {
  res.json({ games: games.map((g) => g.meta) });
});

for (const game of games) {
  router.use(`/${game.meta.id}`, game.router);
}

export default router;
