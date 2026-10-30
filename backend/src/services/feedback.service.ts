import { createHash } from "node:crypto";
import type { FeedbackStatus, Prisma, ProductRequestStatus } from "../generated/prisma/client.js";
import { prisma } from "../config/database.js";
import { containsBlockedWords } from "../utils/profanity.js";

export class FeedbackError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "FeedbackError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Stocked requests stay on the public list as "Now available" for this long. */
export const ADDED_VISIBLE_DAYS = 7;
const MAX_PUBLIC_REQUESTS = 100;
/** At most this many open requests per hostel at a time. */
export const MAX_OPEN_REQUESTS = 10;
/** How many of the most upvoted open requests survive each nightly reset. */
export const KEEP_AFTER_RESET = 3;
// India has no daylight saving, so midnight there is always 18:30 UTC the day before.
const INDIA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const LIST_FULL_MESSAGE = "Today’s list is full. Upvote a request below, or try again after midnight.";

// Product names: English letters, digits, spaces and the punctuation real product names use.
// English letters only, so abuse can't be written in other scripts the word filter can't read.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 &'.,()+/-]*$/;
const NAME_MIN = 2;
const NAME_MAX = 60;
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 1000;
const PHONE_PATTERN = /^[6-9]\d{9}$/;
// Voter tokens are 256-bit random values made in the browser; only their hash is stored.
const VOTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** "Red  Bull" and "redbull" are the same request. */
export const normalizeProductName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const parseProductName = (input: unknown) => {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name.length < NAME_MIN || name.length > NAME_MAX || !NAME_PATTERN.test(name) || !/[A-Za-z]/.test(name)) {
    throw new FeedbackError(`Enter a product name in English (${NAME_MIN} to ${NAME_MAX} letters or numbers).`, 400);
  }
  if (/https?:|www\./i.test(name)) {
    throw new FeedbackError("Links can't be added to a product request.", 400);
  }
  // Deliberately vague, so it doesn't reveal which word was caught.
  if (containsBlockedWords(name)) {
    throw new FeedbackError("Please enter a real product name.", 400);
  }
  return name;
};

/** The SHA-256 of the browser's voter token, or null when the token is missing or malformed. */
export const hashVoterToken = (token: unknown) =>
  typeof token === "string" && VOTER_TOKEN_PATTERN.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;

const requireVoter = (token: unknown) => {
  const hash = hashVoterToken(token);
  if (!hash) throw new FeedbackError("Refresh the page and try again.", 400);
  return hash;
};

const requireActiveHostel = async (hostelId: unknown) => {
  const id = typeof hostelId === "string" ? hostelId.trim() : "";
  const hostel = id ? await prisma.hostel.findUnique({ where: { id } }) : null;
  if (!hostel || !hostel.isActive) throw new FeedbackError("Select an active hostel.", 400);
  return hostel;
};

const toPublicRequest = (
  request: { id: string; name: string; status: ProductRequestStatus; voteCount: number; addedAt: Date | null; createdAt: Date },
  voted: boolean
) => ({
  id: request.id,
  name: request.name,
  status: request.status,
  votes: request.voteCount,
  voted,
  addedAt: request.addedAt,
  createdAt: request.createdAt,
});

/** Which of these requests the voter has already upvoted. */
const votedIds = async (requestIds: string[], voterHash: string | null) => {
  if (!voterHash || requestIds.length === 0) return new Set<string>();
  const votes = await prisma.productRequestVote.findMany({
    where: { requestId: { in: requestIds }, voterHash },
    select: { requestId: true },
  });
  return new Set(votes.map((vote) => vote.requestId));
};

/** The most recent midnight in India time. */
export const lastIndiaMidnight = (now = Date.now()) =>
  new Date(Math.floor((now + INDIA_OFFSET_MS) / DAY_MS) * DAY_MS - INDIA_OFFSET_MS);

/**
 * Resets a hostel's board once a day: after midnight (India time) only the top 3 open requests
 * stay (most votes, then oldest); the rest are archived for admins. The first caller after
 * midnight claims the reset by moving hostels."requestsResetAt" forward inside the same
 * transaction, so concurrent requests and server restarts never reset twice.
 * Returns how many requests were archived.
 */
export const ensureDailyReset = async (hostelId: string, now = Date.now()) => {
  const boundary = lastIndiaMidnight(now);
  return prisma.$transaction(async (tx) => {
    // Raw SQL so the hostel's updatedAt isn't touched by this bookkeeping.
    const claimed = await tx.$executeRaw`
      UPDATE "hostels" SET "requestsResetAt" = ${boundary}
      WHERE "id" = ${hostelId} AND ("requestsResetAt" IS NULL OR "requestsResetAt" < ${boundary})`;
    if (!claimed) return 0;

    const open = await tx.productRequest.findMany({
      where: { hostelId, status: "OPEN" },
      orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const archive = open.slice(KEEP_AFTER_RESET).map((r) => r.id);
    if (archive.length) {
      await tx.productRequest.updateMany({
        where: { id: { in: archive }, status: "OPEN" },
        data: { status: "ARCHIVED", archivedAt: new Date(now) },
      });
    }
    return archive.length;
  });
};

/**
 * A hostel's public request board: open requests by votes (oldest first on ties), plus
 * requests stocked in the last 7 days so customers see their votes led somewhere.
 */
export const listProductRequests = async (hostelId: unknown, voterToken: unknown, now = Date.now()) => {
  const hostel = await requireActiveHostel(hostelId);
  await ensureDailyReset(hostel.id, now);
  const requests = await prisma.productRequest.findMany({
    where: {
      hostelId: hostel.id,
      OR: [{ status: "OPEN" }, { status: "ADDED", addedAt: { gte: new Date(now - ADDED_VISIBLE_DAYS * DAY_MS) } }],
    },
    orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
    take: MAX_PUBLIC_REQUESTS,
  });
  const voted = await votedIds(requests.map((r) => r.id), hashVoterToken(voterToken));
  return requests.map((request) => toPublicRequest(request, voted.has(request.id)));
};

/** Adds this voter's upvote once; returns the request with its current count. */
const addVoteIn = async (tx: Prisma.TransactionClient, requestId: string, voterHash: string) => {
  const { count } = await tx.productRequestVote.createMany({
    data: [{ requestId, voterHash }],
    skipDuplicates: true,
  });
  return count
    ? tx.productRequest.update({ where: { id: requestId }, data: { voteCount: { increment: 1 } } })
    : tx.productRequest.findUniqueOrThrow({ where: { id: requestId } });
};

const addVote = (requestId: string, voterHash: string) =>
  prisma.$transaction((tx) => addVoteIn(tx, requestId, voterHash));

/**
 * Requests a product at a hostel. If the same product (ignoring case and spaces) is already
 * open there, the customer's request becomes an upvote on it instead of a duplicate, even when
 * the list is full. A new product, or an archived one coming back with its old votes, needs one
 * of the 10 open spots.
 */
export const createProductRequest = async (input: unknown, voterToken: unknown) => {
  const data = isRecord(input) ? input : {};
  const hostel = await requireActiveHostel(data.hostelId);
  const name = parseProductName(data.name);
  const voterHash = requireVoter(voterToken);
  const normalizedName = normalizeProductName(name);
  await ensureDailyReset(hostel.id);

  return prisma.$transaction(async (tx) => {
    // Lock the hostel's row so two customers can't both take the last open spot.
    await tx.$queryRaw`SELECT "id" FROM "hostels" WHERE "id" = ${hostel.id} FOR UPDATE`;

    const existing = await tx.productRequest.findUnique({
      where: { hostelId_normalizedName: { hostelId: hostel.id, normalizedName } },
    });
    if (existing?.status === "HIDDEN") {
      throw new FeedbackError("This product can't be requested.", 409);
    }
    if (existing?.status === "ADDED") {
      throw new FeedbackError(`Good news: ${existing.name} is already in the shop.`, 409);
    }
    if (existing?.status === "OPEN") {
      return { request: toPublicRequest(await addVoteIn(tx, existing.id, voterHash), true), duplicate: true };
    }

    const open = await tx.productRequest.count({ where: { hostelId: hostel.id, status: "OPEN" } });
    if (open >= MAX_OPEN_REQUESTS) throw new FeedbackError(LIST_FULL_MESSAGE, 409);

    if (existing) {
      // Archived earlier: bring it back with the votes it already had.
      await tx.productRequest.update({ where: { id: existing.id }, data: { status: "OPEN", archivedAt: null } });
      return { request: toPublicRequest(await addVoteIn(tx, existing.id, voterHash), true), duplicate: true };
    }

    const created = await tx.productRequest.create({
      data: { hostelId: hostel.id, name, normalizedName, voteCount: 1, votes: { create: { voterHash } } },
    });
    return { request: toPublicRequest(created, true), duplicate: false };
  });
};

const requireOpenRequest = async (requestId: unknown) => {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  const found = id ? await prisma.productRequest.findUnique({ where: { id }, select: { hostelId: true } }) : null;
  // A vote just after midnight must not land on a request the reset is about to archive.
  if (found) await ensureDailyReset(found.hostelId);
  const request = found ? await prisma.productRequest.findUnique({ where: { id } }) : null;
  if (!request || request.status !== "OPEN") throw new FeedbackError("This request is no longer open.", 404);
  return request;
};

/** Upvotes an open request; voting twice from the same device changes nothing. */
export const voteForProductRequest = async (requestId: unknown, voterToken: unknown) => {
  const voterHash = requireVoter(voterToken);
  const request = await requireOpenRequest(requestId);
  return toPublicRequest(await addVote(request.id, voterHash), true);
};

/** Takes back this device's upvote, if it has one. */
export const removeProductRequestVote = async (requestId: unknown, voterToken: unknown) => {
  const voterHash = requireVoter(voterToken);
  const request = await requireOpenRequest(requestId);
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.productRequestVote.deleteMany({ where: { requestId: request.id, voterHash } });
    return count
      ? tx.productRequest.update({ where: { id: request.id }, data: { voteCount: { decrement: count } } })
      : tx.productRequest.findUniqueOrThrow({ where: { id: request.id } });
  });
  return toPublicRequest(updated, false);
};

/** Saves a private feedback message for admins. */
export const createFeedback = async (input: unknown) => {
  const data = isRecord(input) ? input : {};
  const message = typeof data.message === "string" ? data.message.trim() : "";
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    throw new FeedbackError(`Write your feedback (${MESSAGE_MIN} to ${MESSAGE_MAX} characters).`, 400);
  }

  let rating: number | null = null;
  if (data.rating !== undefined && data.rating !== null) {
    if (typeof data.rating !== "number" || !Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
      throw new FeedbackError("Rating must be from 1 to 5.", 400);
    }
    rating = data.rating;
  }

  let contactPhone: string | null = null;
  if (typeof data.contactPhone === "string" && data.contactPhone.trim()) {
    contactPhone = data.contactPhone.replace(/\s+/g, "");
    if (!PHONE_PATTERN.test(contactPhone)) {
      throw new FeedbackError("Phone must be exactly 10 digits and start with 6-9.", 400);
    }
  }

  // The hostel is optional context: a missing or inactive one is simply not recorded.
  const hostelId = typeof data.hostelId === "string" && data.hostelId.trim() ? data.hostelId.trim() : null;
  const hostel = hostelId ? await prisma.hostel.findUnique({ where: { id: hostelId }, select: { id: true } }) : null;

  const saved = await prisma.feedback.create({
    data: { message, rating, contactPhone, hostelId: hostel?.id ?? null },
  });
  return { id: saved.id, createdAt: saved.createdAt };
};

// ---------- Admin ----------

const REQUEST_STATUSES: ProductRequestStatus[] = ["OPEN", "ADDED", "HIDDEN", "ARCHIVED"];
const FEEDBACK_STATUSES: FeedbackStatus[] = ["NEW", "DONE"];

const parseStatus = <T extends string>(value: unknown, allowed: T[]): T | null =>
  typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;

/** Every request with its hostel, most upvoted first, optionally filtered by hostel and status. */
export const getAdminProductRequests = async (filters: { hostelId?: unknown; status?: unknown }) => {
  const status = parseStatus(filters.status, REQUEST_STATUSES);
  const hostelId = typeof filters.hostelId === "string" && filters.hostelId.trim() ? filters.hostelId.trim() : undefined;
  // Apply any reset that's due, so admins see the same board customers do.
  const due = hostelId ? [hostelId] : (await prisma.hostel.findMany({ select: { id: true } })).map((h) => h.id);
  for (const id of due) await ensureDailyReset(id);
  const [requests, grouped] = await Promise.all([
    prisma.productRequest.findMany({
      where: { ...(hostelId && { hostelId }), ...(status && { status }) },
      orderBy: [{ voteCount: "desc" }, { createdAt: "asc" }],
      include: { hostel: { select: { id: true, name: true } } },
      take: 500,
    }),
    prisma.productRequest.groupBy({
      by: ["status"],
      where: { ...(hostelId && { hostelId }) },
      _count: { _all: true },
    }),
  ]);
  const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<ProductRequestStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;

  return {
    counts,
    requests: requests.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      votes: r.voteCount,
      hostel: r.hostel,
      addedAt: r.addedAt,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
};

/** Marks a request Added (stocked), Hidden, Archived, or back to Open (admins may exceed the daily limit). */
export const updateProductRequestStatus = async (requestId: unknown, input: unknown) => {
  const status = parseStatus(isRecord(input) ? input.status : undefined, REQUEST_STATUSES);
  if (!status) throw new FeedbackError("Status must be OPEN, ADDED, HIDDEN or ARCHIVED.", 400);
  const id = typeof requestId === "string" ? requestId.trim() : "";
  const existing = id ? await prisma.productRequest.findUnique({ where: { id } }) : null;
  if (!existing) throw new FeedbackError("Request not found.", 404);

  const updated = await prisma.productRequest.update({
    where: { id },
    data: {
      status,
      addedAt: status === "ADDED" ? (existing.addedAt ?? new Date()) : null,
      archivedAt: status === "ARCHIVED" ? (existing.archivedAt ?? new Date()) : null,
    },
  });
  return { id: updated.id, status: updated.status, addedAt: updated.addedAt };
};

/** Permanently removes a request and its votes (for abusive or junk entries). */
export const deleteProductRequest = async (requestId: unknown) => {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  const { count } = id ? await prisma.productRequest.deleteMany({ where: { id } }) : { count: 0 };
  if (!count) throw new FeedbackError("Request not found.", 404);
  return { id };
};

/** Feedback messages, newest first, with how many are new and done. */
export const getAdminFeedback = async (filters: { status?: unknown }) => {
  const status = parseStatus(filters.status, FEEDBACK_STATUSES);
  const [messages, grouped] = await Promise.all([
    prisma.feedback.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      include: { hostel: { select: { id: true, name: true } } },
      take: 500,
    }),
    prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;

  return {
    counts,
    messages: messages.map((m) => ({
      id: m.id,
      message: m.message,
      rating: m.rating,
      contactPhone: m.contactPhone,
      status: m.status,
      hostel: m.hostel,
      createdAt: m.createdAt,
    })),
  };
};

/** Marks a feedback message Done, or back to New. */
export const updateFeedbackStatus = async (feedbackId: unknown, input: unknown) => {
  const status = parseStatus(isRecord(input) ? input.status : undefined, FEEDBACK_STATUSES);
  if (!status) throw new FeedbackError("Status must be NEW or DONE.", 400);
  const id = typeof feedbackId === "string" ? feedbackId.trim() : "";
  const existing = id ? await prisma.feedback.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!existing) throw new FeedbackError("Feedback not found.", 404);
  const updated = await prisma.feedback.update({ where: { id }, data: { status } });
  return { id: updated.id, status: updated.status };
};
