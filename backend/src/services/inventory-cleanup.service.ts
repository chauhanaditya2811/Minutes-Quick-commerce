
import { expireReservations } from "./inventory.service.js";

const CLEANUP_INTERVAL_MS = 30_000;

// Runs reservation expiration immediately and every 30 seconds.
export const startInventoryCleanup = (): void => {
  const runCleanup = async (): Promise<void> => {
    try {
      const result = await expireReservations();

      if (result.expiredCount > 0) {
        console.log(
          `Expired ${result.expiredCount} inventory reservation(s).`
        );
      }
    } catch (error) {
      console.error("Inventory reservation cleanup failed:", error);
    }
  };

  void runCleanup();
  setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);
};
