import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCashfreeOrderForCustomer: vi.fn(),
  verifyCashfreePaymentForCustomer: vi.fn(),
}));

vi.mock("../src/services/payment.service.js", () => mocks);
vi.mock("../src/config/cashfree.js", () => ({
  CashfreeConfigError: class CashfreeConfigError extends Error {},
}));

import type { Response } from "express";
import type { AuthenticatedRequest } from "../src/middleware/auth.middleware.js";
import { CashfreeConfigError } from "../src/config/cashfree.js";
import {
  createCashfreeOrderController,
  verifyCashfreePaymentController,
} from "../src/controllers/payment.controller.js";

const response = () => {
  const result = { status: vi.fn(), json: vi.fn() };
  result.status.mockReturnValue(result);
  return result;
};

const request = (body?: unknown, authenticated = true) =>
  ({
    params: { orderId: "order-1" },
    body,
    firebaseUser: authenticated ? { uid: "firebase-1" } : undefined,
  }) as unknown as AuthenticatedRequest;

describe("Cashfree payment controller", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects unauthenticated initialization", async () => {
    const res = response();
    await createCashfreeOrderController(request(undefined, false), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns the payment envelope", async () => {
    mocks.createCashfreeOrderForCustomer.mockResolvedValue({ paymentSessionId: "session-1" });
    const res = response();
    await createCashfreeOrderController(request(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ payment: { paymentSessionId: "session-1" } }));
  });

  it("maps provider configuration failures to 503", async () => {
    mocks.createCashfreeOrderForCustomer.mockRejectedValue(new CashfreeConfigError("missing"));
    const res = response();
    await createCashfreeOrderController(request(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("passes verification input to the service", async () => {
    mocks.verifyCashfreePaymentForCustomer.mockResolvedValue({ paymentStatus: "SUCCESS" });
    const body = { cashfree_order_id: "MIN-attempt-1" };
    const res = response();
    await verifyCashfreePaymentController(request(body), res as unknown as Response);
    expect(mocks.verifyCashfreePaymentForCustomer).toHaveBeenCalledWith("firebase-1", "order-1", body);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
