import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { asyncHandler } from "../utils/asyncHandler";
import { streamEvents } from "../controllers/admin/feedController";
import usersRoutes from "./admin/users";
import forcedOutcomesRoutes from "./admin/forcedOutcomes";
import gameSettingsRoutes from "./admin/gameSettings";
import paytableRoutes from "./admin/paytable";
import earningsRoutes from "./admin/earnings";
import statsRoutes from "./admin/stats";
import feedRoutes from "./admin/feed";

const router = Router();

// SSE authenticates itself via a short-lived ticket (EventSource can't send custom
// headers), so this must stay outside the Bearer-token requireAuth/requireAdmin gate below.
router.get("/events", asyncHandler(streamEvents));

router.use(requireAuth, asyncHandler(requireAdmin));
router.use("/users", usersRoutes);
router.use("/forced-outcomes", forcedOutcomesRoutes);
router.use("/game-settings", gameSettingsRoutes);
router.use("/paytable", paytableRoutes);
router.use("/earnings", earningsRoutes);
router.use("/stats", statsRoutes);
router.use("/", feedRoutes);

export default router;
