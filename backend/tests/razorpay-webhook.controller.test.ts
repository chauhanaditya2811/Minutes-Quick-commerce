
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  processRazorpayWebhook: vi.fn(),
}));

// Mock the webhook service so tests never modify the database.
vi.mock("../src/services/razorpay-webhook.service.js", () => ({
  processRazorpayWebhook: mocks.processRazorpayWebhook,

  RazorpayWebhookError: class RazorpayWebhookError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message);
      this.name = "RazorpayWebhookError";
    }
  },
}));

// Keep configuration-error handling independent of real credentials.
vi.mock("../src/config/razorpay.js", () => ({
  RazorpayConfigError: class RazorpayConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RazorpayConfigError";
    }
  },
}));

import {
  razorpayWebhookController,
} from "../src/controllers/razorpay-webhook.controller.js";

import {
  RazorpayWebhookError,
} from "../src/services/razorpay-webhook.service.js";

import {
  RazorpayConfigError,
} from "../src/config/razorpay.js";

// Create a minimal mocked Express response.
const createMockResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);
  return res;
};

// Simulate a request with raw bytes and a Razorpay signature header.
const createMockRequest = (
  body: unknown,
  signature?: string,
  eventId?: string
) =>
  ({
    body,
    get: vi.fn((headerName: string) => {
      switch (headerName.toLowerCase()) {
        case "x-razorpay-signature":
          return signature;
        case "x-razorpay-event-id":
          return eventId;
        default:
          return undefined;
      }
    }),
  }) as unknown as Request;

describe("Razorpay webhook controller", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes the exact raw body, signature, and event ID to the webhook service", async () => {
    const rawBody = Buffer.from(
      '{"event":"payment.captured","payload":{}}',
      "utf8"
    );
    const signature = "a".repeat(64);
    const eventId = "evt_controller_123";

    mocks.processRazorpayWebhook.mockResolvedValue({
      received: true,
      processed: true,
      event: "payment.captured",
    });

    const req = createMockRequest(rawBody, signature, eventId);
    const res = createMockResponse();

    await razorpayWebhookController(
      req,
      res as unknown as Response
    );

    expect(mocks.processRazorpayWebhook).toHaveBeenCalledOnce();
    expect(mocks.processRazorpayWebhook).toHaveBeenCalledWith(
      rawBody,
      signature,
      eventId
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      received: true,
      processed: true,
      event: "payment.captured",
    });
  });

  it("rejects parsed JSON instead of a raw request body", async () => {
    const req = createMockRequest({
      event: "payment.captured",
    });
    const res = createMockResponse();

    await razorpayWebhookController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "The raw webhook request body is required.",
    });

    expect(mocks.processRazorpayWebhook).not.toHaveBeenCalled();
  });

  it("returns the status from a webhook processing error", async () => {
    mocks.processRazorpayWebhook.mockRejectedValue(
      new RazorpayWebhookError(
        "Razorpay webhook signature verification failed.",
        400
      )
    );

    const req = createMockRequest(
      Buffer.from('{"event":"payment.captured"}'),
      "a".repeat(64)
    );
    const res = createMockResponse();

    await razorpayWebhookController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Razorpay webhook signature verification failed.",
    });
  });

  it("returns 503 when webhook configuration is missing", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.processRazorpayWebhook.mockRejectedValue(
      new RazorpayConfigError(
        "Razorpay Webhook Secret is not configured."
      )
    );

    const req = createMockRequest(
      Buffer.from('{"event":"payment.captured"}'),
      "a".repeat(64)
    );
    const res = createMockResponse();

    await razorpayWebhookController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: "Webhook processing is not configured.",
    });

    consoleSpy.mockRestore();
  });

  it("returns a generic error without exposing internal details", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.processRazorpayWebhook.mockRejectedValue(
      new Error("Private database connection details")
    );

    const req = createMockRequest(
      Buffer.from('{"event":"payment.captured"}'),
      "a".repeat(64)
    );
    const res = createMockResponse();

    await razorpayWebhookController(
      req,
      res as unknown as Response
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Unable to process Razorpay webhook.",
    });

    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Private database connection details",
      })
    );

    consoleSpy.mockRestore();
  });
});
