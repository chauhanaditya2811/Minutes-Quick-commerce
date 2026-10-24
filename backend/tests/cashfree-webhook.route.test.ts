import { describe, expect, it, vi } from "vitest";

vi.mock("../src/controllers/cashfree-webhook.controller.js", () => ({
  cashfreeWebhookController: (_req: unknown, res: { status: (code: number) => { send: () => void } }) =>
    res.status(200).send(),
}));

import cashfreeWebhookRoutes from "../src/routes/cashfree-webhook.routes.js";

describe("Cashfree webhook route", () => {
  it("exports a router with a POST handler", () => {
    const router = cashfreeWebhookRoutes as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    };
    expect(router.stack.some((entry) => entry.route?.path === "/" && entry.route.methods.post)).toBe(true);
  });
});
