import type { NextFunction, Request, Response } from "express";

interface RateLimitOptions {
  /** Length of each counting window. */
  windowMs: number;
  /** Requests allowed per client IP in one window. */
  max: number;
}

// Azure forwards "IPv4:port" in X-Forwarded-For; drop the port so one client is one key.
const clientKey = (req: Request) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return ip.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
};

/**
 * Small fixed-window, per-IP rate limiter for public endpoints. Counts are kept in this
 * process's memory, so each server instance limits independently and counts reset on restart.
 */
export const rateLimit = ({ windowMs, max }: RateLimitOptions) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = Date.now() + windowMs;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
      nextSweep = now + windowMs;
    }

    const key = clientKey(req);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ message: "Too many requests. Please wait a moment and try again." });
      return;
    }
    next();
  };
};
