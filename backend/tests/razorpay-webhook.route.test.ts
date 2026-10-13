
import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processRazorpayWebhook: vi.fn(),
}));

// Mock business logic while testing the actual Express middleware and route.
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

vi.mock("../src/config/razorpay.js", () => ({
  RazorpayConfigError: class RazorpayConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RazorpayConfigError";
    }
  },
}));

import razorpayWebhookRoutes from "../src/routes/razorpay-webhook.routes.js";

let server: Server;
let baseUrl: string;

// Start a local Express server using the same raw-body middleware as app.ts.
const startServer = async (): Promise<void> => {
  const app = express();

  app.use(
    "/api/webhooks/razorpay",
    express.raw({ type: "application/json" }),
    razorpayWebhookRoutes
  );

  server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine the test server port.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
};

const stopServer = async (): Promise<void> => {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

describe("Razorpay webhook HTTP route", () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    mocks.processRazorpayWebhook.mockResolvedValue({
      received: true,
      processed: true,
      event: "payment.captured",
    });

    await startServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  it("passes the original raw JSON bytes and event ID to the webhook service", async () => {
    const rawPayload =
      '{"event":"payment.captured","payload":{"payment":{"entity":{}}}}';
    const eventId = "evt_route_test_123";

    const response = await fetch(
      `${baseUrl}/api/webhooks/razorpay`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": "a".repeat(64),
          "X-Razorpay-Event-Id": eventId,
        },
        body: rawPayload,
      }
    );

    expect(response.status).toBe(200);

    expect(mocks.processRazorpayWebhook).toHaveBeenCalledOnce();

    const [receivedBody, receivedSignature, receivedEventId] =
      mocks.processRazorpayWebhook.mock.calls[0] as [
        Buffer,
        string | undefined,
        string | undefined,
      ];

    expect(Buffer.isBuffer(receivedBody)).toBe(true);
    expect(receivedBody.toString("utf8")).toBe(rawPayload);
    expect(receivedSignature).toBe("a".repeat(64));
    expect(receivedEventId).toBe(eventId);

    await expect(response.json()).resolves.toEqual({
      received: true,
      processed: true,
      event: "payment.captured",
    });
  });
  it("rejects requests that do not contain a raw JSON body", async () => {
    const response = await fetch(
      `${baseUrl}/api/webhooks/razorpay`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "X-Razorpay-Signature": "a".repeat(64),
        },
        body: '{"event":"payment.captured"}',
      }
    );

    expect(response.status).toBe(400);

    await expect(response.json()).resolves.toEqual({
      message: "The raw webhook request body is required.",
    });

    expect(mocks.processRazorpayWebhook).not.toHaveBeenCalled();
  });
});
