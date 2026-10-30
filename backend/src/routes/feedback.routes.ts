import { Router } from "express";
import {
  createFeedbackController,
  createProductRequestController,
  listProductRequestsController,
  unvoteProductRequestController,
  voteProductRequestController,
} from "../controllers/feedback.controller.js";
import { rateLimit } from "../middleware/rate-limit.middleware.js";

// Public, no sign-in needed. Per-IP limits are generous because a whole hostel can share
// one Wi-Fi address, but low enough to stop one person flooding requests or votes.
const TEN_MINUTES = 10 * 60_000;

const router = Router();

router.get("/product-requests", rateLimit({ windowMs: TEN_MINUTES, max: 300 }), listProductRequestsController);
router.post("/product-requests", rateLimit({ windowMs: TEN_MINUTES, max: 30 }), createProductRequestController);
router.put("/product-requests/:requestId/vote", rateLimit({ windowMs: TEN_MINUTES, max: 150 }), voteProductRequestController);
router.delete("/product-requests/:requestId/vote", rateLimit({ windowMs: TEN_MINUTES, max: 150 }), unvoteProductRequestController);
router.post("/feedback", rateLimit({ windowMs: TEN_MINUTES, max: 15 }), createFeedbackController);

export default router;
