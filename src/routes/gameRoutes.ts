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
import crystalCloverRoutes from "../games/CrystalClover/routes";
import { crystalCloverMeta } from "../games/CrystalClover/meta";
import fruity777Routes from "../games/Fruity777/routes";
import { fruity777Meta } from "../games/Fruity777/meta";
import mega10xPayRoutes from "../games/Mega10XPay/routes";
import { mega10xPayMeta } from "../games/Mega10XPay/meta";
import vegasHitsRoutes from "../games/VegasHits/routes";
import { vegasHitsMeta } from "../games/VegasHits/meta";
import lifeOfLuxuryRoutes from "../games/LifeOfLuxury/routes";
import { lifeOfLuxuryMeta } from "../games/LifeOfLuxury/meta";
import rubberDuckRoutes from "../games/RubberDuck/routes";
import { rubberDuckMeta } from "../games/RubberDuck/meta";
import topDollarRoutes from "../games/TopDollar/routes";
import { topDollarMeta } from "../games/TopDollar/meta";
import gemsDeluxeRoutes from "../games/GemsDeluxe/routes";
import { gemsDeluxeMeta } from "../games/GemsDeluxe/meta";
import hexaKenoRoutes from "../games/HexaKeno/routes";
import { hexaKenoMeta } from "../games/HexaKeno/meta";
import superKenoBallsRoutes from "../games/SuperKenoBalls/routes";
import { superKenoBallsMeta } from "../games/SuperKenoBalls/meta";

// Add each new game's meta + router here as it's built.
const games = [
  { meta: shamrockSpinMeta, router: shamrockSpinRoutes },
  { meta: cashMachineMeta, router: cashMachineRoutes },
  { meta: buffalo777Meta, router: buffalo777Routes },
  { meta: crazy777Meta, router: crazy777Routes },
  { meta: fiveXRewindMeta, router: fiveXRewindRoutes },
  { meta: sizzlingSevensMeta, router: sizzlingSevensRoutes },
  { meta: crystalCloverMeta, router: crystalCloverRoutes },
  { meta: fruity777Meta, router: fruity777Routes },
  { meta: mega10xPayMeta, router: mega10xPayRoutes },
  { meta: vegasHitsMeta, router: vegasHitsRoutes },
  { meta: lifeOfLuxuryMeta, router: lifeOfLuxuryRoutes },
  { meta: rubberDuckMeta, router: rubberDuckRoutes },
  { meta: topDollarMeta, router: topDollarRoutes },
  { meta: gemsDeluxeMeta, router: gemsDeluxeRoutes },
  { meta: hexaKenoMeta, router: hexaKenoRoutes },
  { meta: superKenoBallsMeta, router: superKenoBallsRoutes },
];

const router = Router();

router.get("/", (_req, res) => {
  res.json({ games: games.map((g) => g.meta) });
});

for (const game of games) {
  router.use(`/${game.meta.id}`, game.router);
}

export default router;
