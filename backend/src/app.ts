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
import adminHostelRoutes from "./routes/admin-hostel.routes.js";

const app = express();

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
app.use("/api/admin/hostels", adminHostelRoutes);
app.use("/api/admin", adminProductRoutes);
app.use("/api/admin", adminOrderRoutes);
// Public store settings.
app.use("/api/settings", settingsRoutes);

// Admin-only store settings.
app.use("/api/admin/settings", adminSettingsRoutes);

//order routes
app.use("/api/orders", orderRoutes);

export default app;
