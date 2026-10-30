import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import productRoutes from "./routes/product.routes.js";
import adminProductRoutes from "./routes/admin-product.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import adminSettingsRoutes from "./routes/admin-settings.routes.js";
import orderRoutes from "./routes/order.routes.js";
import adminOrderRoutes from "./routes/admin-order.routes.js";
import cashfreeWebhookRoutes from "./routes/cashfree-webhook.routes.js";
import hostelRoutes from "./routes/hostel.routes.js";
import poolRoutes from "./routes/pool.routes.js";
import adminHostelRoutes from "./routes/admin-hostel.routes.js";
import adminStockGroupRoutes from "./routes/admin-stock-group.routes.js";
import guestRoutes from "./routes/guest.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import adminFeedbackRoutes from "./routes/admin-feedback.routes.js";

const app = express();

// Azure App Service sits behind one front-end proxy; trust it so req.ip is the client's
// address (used by the per-IP rate limits on public guest checkout routes).
app.set("trust proxy", 1);

app.use(cors());

// IMPORTANT: register the webhook before the general JSON parser.
app.use(
  "/api/webhooks/cashfree",
  express.raw({ type: "application/json" }),
  cashfreeWebhookRoutes
);

// Parse JSON for the rest of the API.
app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/hostels", hostelRoutes);
// Customers choose a pool (shared stock) first, and their exact hostel at checkout.
app.use("/api/pools", poolRoutes);
app.use("/api/admin/hostels", adminHostelRoutes);
// Shared stock: which hostels sell from which stock, and each group's product stock.
app.use("/api/admin/stock-groups", adminStockGroupRoutes);
app.use("/api/admin", adminProductRoutes);
app.use("/api/admin", adminOrderRoutes);
// Public store settings.
app.use("/api/settings", settingsRoutes);

// Admin-only store settings.
app.use("/api/admin/settings", adminSettingsRoutes);

//order routes
app.use("/api/orders", orderRoutes);

// Public guest checkout (no sign-in); every guest order is gated by its own secret token.
app.use("/api/guest", guestRoutes);

// Product requests with upvotes, and private feedback (no sign-in needed).
app.use("/api", feedbackRoutes);
app.use("/api/admin/feedback", adminFeedbackRoutes);

export default app;
