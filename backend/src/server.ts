
import "dotenv/config";
import app from "./app.js";
import { startInventoryCleanup } from "./services/inventory-cleanup.service.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Minutes API running on port ${PORT}`);
  startInventoryCleanup();
});
