import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ processCashfreeWebhook: vi.fn() }));
vi.mock("../src/services/cashfree-webhook.service.js", () => ({
  processCashfreeWebhook: mocks.processCashfreeWebhook,
  CashfreeWebhookError: class CashfreeWebhookError extends Error {
    constructor(message: string, readonly statusCode: number) {
      super(message);
    }
  },
}));
vi.mock("../src/config/cashfree.js", () => ({
  CashfreeConfigError: class CashfreeConfigError extends Error {},
}));

import type { Request, Response } from "express";
import { cashfreeWebhookController } from "../src/controllers/cashfree-webhook.controller.js";

const response = () => {
  const result = { status: vi.fn(), json: vi.fn() };
  result.status.mockReturnValue(result);
  return result;
};

describe("Cashfree webhook controller", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires the raw body", async () => {
    const res = response();
    await cashfreeWebhookController({ body: {} } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("passes raw body and Cashfree headers to the service", async () => {
    mocks.processCashfreeWebhook.mockResolvedValue({ received: true });
    const res = response();
    await cashfreeWebhookController({
      body: Buffer.from("{}"),
      get: (header: string) => ({
        "x-webhook-signature": "sig",
        "x-webhook-timestamp": "timestamp",
        "x-webhook-id": "event",
      }[header] ?? undefined),
    } as unknown as Request, res as unknown as Response);
    expect(mocks.processCashfreeWebhook).toHaveBeenCalledWith(
      Buffer.from("{}"), "sig", "timestamp", "event",
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
