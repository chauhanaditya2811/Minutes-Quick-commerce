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


const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/admin", adminProductRoutes);
// Public store settings.
app.use("/api/settings", settingsRoutes);

// Admin-only store settings.
app.use("/api/admin/settings", adminSettingsRoutes);

//order routes
app.use("/api/orders", orderRoutes);

export default app;