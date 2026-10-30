import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("../../src/config/firebase.js", () => ({ default: {} }));
vi.mock("../../src/config/cloudinary.js", () => ({ default: {} }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));

import app from "../../src/app.js";
import { prisma } from "../../src/config/database.js";
import { createInventoryFixture } from "./fixtures.js";
import { ensureDailyReset, lastIndiaMidnight } from "../../src/services/feedback.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Product requests, upvotes and private feedback over HTTP against minutes_test.
describe("customer feedback (minutes_test)", () => {
  let server: Server;
  let baseUrl: string;
  let fx: Awaited<ReturnType<typeof createInventoryFixture>>;
  let hostelA: string;
  let hostelB: string;
  let closedHostel: string;
  const env = { ...process.env };

  const voter = () => randomBytes(32).toString("base64url");
  let ipCounter = 0;
  const nextIp = () => `10.30.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

  const call = async (
    method: string,
    path: string,
    { body, voterToken, admin, ip }: { body?: unknown; voterToken?: string; admin?: "admin" | "customer"; ip?: string } = {}
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "x-forwarded-for": ip ?? nextIp(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(voterToken ? { "x-voter-token": voterToken } : {}),
        ...(admin ? { authorization: `Bearer ${admin}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const request = (hostelId: string, name: string, voterToken = voter()) =>
    call("POST", "/api/product-requests", { body: { hostelId, name }, voterToken });
  const list = async (hostelId: string, voterToken?: string) =>
    (await call("GET", `/api/product-requests?hostelId=${hostelId}`, { voterToken })).body.requests as {
      id: string;
      name: string;
      votes: number;
      voted: boolean;
      status: string;
    }[];
  const vote = (id: string, voterToken: string, method: "PUT" | "DELETE" = "PUT") =>
    call(method, `/api/product-requests/${id}/vote`, { voterToken });
  const name = (label: string) => `${label} ${fx.tag}`;

  beforeAll(async () => {
    process.env.ADMIN_EMAIL = "admin@example.test";
    mocks.verifyIdToken.mockImplementation(async (token: string) =>
      token === "admin" ? { uid: "admin", email: "admin@example.test" } : { uid: "customer", email: "c@example.test" }
    );
    fx = await createInventoryFixture();
    hostelA = (await fx.hostel("Feedback Hostel A")).id;
    hostelB = (await fx.hostel("Feedback Hostel B")).id;
    closedHostel = (await fx.hostel("Feedback Closed")).id;
    await prisma.hostel.update({ where: { id: closedHostel }, data: { isActive: false } });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.feedback.deleteMany({ where: { message: { contains: fx.tag } } });
    await fx.cleanup(); // deleting the hostels removes their requests and votes
    process.env = env;
  });

  it("creates a request with the requester's own upvote and shows who has voted", async () => {
    const me = voter();
    const created = await request(hostelA, name("Red Bull"), me);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ duplicate: false, request: { name: name("Red Bull"), votes: 1, voted: true, status: "OPEN" } });

    const mine = (await list(hostelA, me)).find((r) => r.id === created.body.request.id);
    const theirs = (await list(hostelA, voter())).find((r) => r.id === created.body.request.id);
    expect(mine).toMatchObject({ votes: 1, voted: true });
    expect(theirs).toMatchObject({ votes: 1, voted: false });
  });

  it("turns a repeat request (any case or spacing) into an upvote instead of a duplicate", async () => {
    const first = voter();
    const created = (await request(hostelA, name("Dark Fantasy"), first)).body.request;

    const repeat = await request(hostelA, name("DARK   fantasy"), voter());
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ duplicate: true, request: { id: created.id, name: name("Dark Fantasy"), votes: 2 } });

    // The same device asking again changes nothing.
    expect((await request(hostelA, name("dark fantasy"), first)).body.request.votes).toBe(2);
    expect((await list(hostelA)).filter((r) => r.id === created.id)).toHaveLength(1);
  });

  it("keeps each hostel's requests separate", async () => {
    const a = (await request(hostelA, name("Kurkure"))).body.request;
    const b = await request(hostelB, name("Kurkure"));
    expect(b.status).toBe(201);
    expect(b.body.request.id).not.toBe(a.id);
    expect((await list(hostelB)).map((r) => r.id)).not.toContain(a.id);
  });

  it("allows one upvote per device, and lets that device take it back", async () => {
    const id = (await request(hostelA, name("Oreo"))).body.request.id;
    const fan = voter();

    expect((await vote(id, fan)).body.request).toMatchObject({ votes: 2, voted: true });
    expect((await vote(id, fan)).body.request).toMatchObject({ votes: 2, voted: true });
    expect((await vote(id, fan, "DELETE")).body.request).toMatchObject({ votes: 1, voted: false });
    expect((await vote(id, fan, "DELETE")).body.request).toMatchObject({ votes: 1, voted: false });
  });

  it("counts simultaneous votes exactly once each", async () => {
    const id = (await request(hostelA, name("Coke Zero"))).body.request.id;
    const repeat = voter();
    await Promise.all([
      ...Array.from({ length: 10 }, () => vote(id, voter())),
      ...Array.from({ length: 5 }, () => vote(id, repeat)),
    ]);

    const row = await prisma.productRequest.findUniqueOrThrow({ where: { id } });
    expect(row.voteCount).toBe(12); // requester + 10 voters + 1 repeat voter
    expect(await prisma.productRequestVote.count({ where: { requestId: id } })).toBe(12);
  });

  it("lists open requests by votes", async () => {
    const low = (await request(hostelB, name("Low"))).body.request.id;
    const high = (await request(hostelB, name("High"))).body.request.id;
    await vote(high, voter());
    const ids = (await list(hostelB)).map((r) => r.id);
    expect(ids.indexOf(high)).toBeLessThan(ids.indexOf(low));
  });

  it.each([
    ["a one-letter name", { name: "A" }],
    ["a name with only numbers", { name: "12345" }],
    ["an overlong name", { name: "x".repeat(61) }],
    ["a link", { name: "www.example.com" }],
    ["markup", { name: "<script>alert(1)</script>" }],
    ["a name in another script", { name: "रेड बुल" }],
    ["emoji", { name: "Red Bull 🔥" }],
    ["an abusive word", { name: "Chutiya chips" }],
    ["abuse with spelling tricks", { name: "f u c k" }],
    ["an abusive phrase", { name: "Teri maa ki" }],
  ])("rejects %s without saving it", async (_label, body) => {
    const before = await prisma.productRequest.count({ where: { hostelId: hostelA } });
    const response = await call("POST", "/api/product-requests", { body: { hostelId: hostelA, ...body }, voterToken: voter() });
    expect(response.status).toBe(400);
    expect(await prisma.productRequest.count({ where: { hostelId: hostelA } })).toBe(before);
  });

  it("gives abusive requests a vague message that doesn't name the caught word", async () => {
    const response = await request(hostelA, "Bhenchod biscuits");
    expect(response.body.message).toBe("Please enter a real product name.");
  });

  it("lets only admins permanently delete a request and its votes", async () => {
    const id = (await request(hostelA, name("Delete Me"))).body.request.id;
    await vote(id, voter());
    const path = `/api/admin/feedback/product-requests/${id}`;

    expect((await call("DELETE", path)).status).toBe(401);
    expect((await call("DELETE", path, { admin: "customer" })).status).toBe(403);
    expect(await prisma.productRequest.count({ where: { id } })).toBe(1);

    expect((await call("DELETE", path, { admin: "admin" })).status).toBe(200);
    expect(await prisma.productRequest.count({ where: { id } })).toBe(0);
    expect(await prisma.productRequestVote.count({ where: { requestId: id } })).toBe(0);
    expect((await list(hostelA)).map((r) => r.id)).not.toContain(id);
    expect((await call("DELETE", path, { admin: "admin" })).status).toBe(404);
  });

  it("rejects requests without a voter token or for an inactive hostel", async () => {
    expect((await call("POST", "/api/product-requests", { body: { hostelId: hostelA, name: "Pepsi" } })).status).toBe(400);
    expect((await request(closedHostel, "Pepsi")).status).toBe(400);
    expect((await call("GET", `/api/product-requests?hostelId=${closedHostel}`)).status).toBe(400);
  });

  it("lets only admins manage requests, and shows stocked ones as available for a week", async () => {
    const id = (await request(hostelA, name("Monster"))).body.request.id;
    const path = `/api/admin/feedback/product-requests/${id}`;

    expect((await call("GET", "/api/admin/feedback/product-requests")).status).toBe(401);
    expect((await call("PATCH", path, { body: { status: "ADDED" }, admin: "customer" })).status).toBe(403);

    const added = await call("PATCH", path, { body: { status: "ADDED" }, admin: "admin" });
    expect(added.status).toBe(200);
    expect(added.body.request).toMatchObject({ status: "ADDED", addedAt: expect.any(String) });

    expect((await list(hostelA)).find((r) => r.id === id)).toMatchObject({ status: "ADDED" });
    expect((await vote(id, voter())).status).toBe(404);
    const again = await request(hostelA, name("monster"));
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already in the shop/);

    await prisma.productRequest.update({ where: { id }, data: { addedAt: new Date(Date.now() - 8 * DAY_MS) } });
    expect((await list(hostelA)).map((r) => r.id)).not.toContain(id);
  });

  it("hides requests from customers and blocks them from being requested again", async () => {
    const id = (await request(hostelA, name("Rude Joke"))).body.request.id;
    await call("PATCH", `/api/admin/feedback/product-requests/${id}`, { body: { status: "HIDDEN" }, admin: "admin" });

    expect((await list(hostelA)).map((r) => r.id)).not.toContain(id);
    expect((await request(hostelA, name("rude joke"))).status).toBe(409);

    const admin = await call("GET", `/api/admin/feedback/product-requests?hostelId=${hostelA}&status=HIDDEN`, { admin: "admin" });
    expect(admin.body.requests.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(admin.body.counts.HIDDEN).toBe(1);
  });

  it("stores private feedback for admins only", async () => {
    const message = `Please deliver faster after 10pm ${fx.tag}`;
    const sent = await call("POST", "/api/feedback", { body: { hostelId: hostelA, message, rating: 4, contactPhone: "98765 43210" } });
    expect(sent.status).toBe(201);

    const stored = await prisma.feedback.findUniqueOrThrow({ where: { id: sent.body.feedback.id } });
    expect(stored).toMatchObject({ message, rating: 4, contactPhone: "9876543210", hostelId: hostelA, status: "NEW" });

    expect((await call("GET", "/api/admin/feedback/messages", { admin: "customer" })).status).toBe(403);
    const inbox = await call("GET", "/api/admin/feedback/messages?status=NEW", { admin: "admin" });
    expect(inbox.body.messages.find((m: { id: string }) => m.id === stored.id)).toMatchObject({
      message,
      rating: 4,
      hostel: { id: hostelA },
    });

    const done = await call("PATCH", `/api/admin/feedback/messages/${stored.id}`, { body: { status: "DONE" }, admin: "admin" });
    expect(done.body.feedback).toMatchObject({ status: "DONE" });
  });

  it.each([
    ["a too-short message", { message: "ok" }],
    ["a rating above 5", { message: "Great service overall", rating: 6 }],
    ["a fractional rating", { message: "Great service overall", rating: 4.5 }],
    ["an invalid phone", { message: "Great service overall", contactPhone: "12345" }],
  ])("rejects feedback with %s", async (_label, body) => {
    expect((await call("POST", "/api/feedback", { body })).status).toBe(400);
  });

  it("rate-limits one address flooding requests", async () => {
    const ip = "10.31.0.1";
    const statuses: number[] = [];
    // The same name every time, so the 10-request limit doesn't stop it first: after the
    // first request, each one is an upvote from a new device.
    for (let i = 0; i < 31; i++) {
      statuses.push((await call("POST", "/api/product-requests", { body: { hostelId: hostelB, name: name("Flood") }, voterToken: voter(), ip })).status);
    }
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  describe("daily limit and midnight reset", () => {
    const yesterday = () => new Date(lastIndiaMidnight().getTime() - DAY_MS);
    const openCount = (hostelId: string) => prisma.productRequest.count({ where: { hostelId, status: "OPEN" } });

    /** Creates requests in order with the given vote counts (oldest first). */
    const seed = async (hostelId: string, votes: number[]) => {
      const ids: string[] = [];
      for (const [index, count] of votes.entries()) {
        const id = (await request(hostelId, name(`Item ${String.fromCharCode(65 + index)}`))).body.request.id;
        await prisma.productRequest.update({
          where: { id },
          data: { voteCount: count, createdAt: new Date(Date.now() - (votes.length - index) * 60_000) },
        });
        ids.push(id);
      }
      return ids;
    };

    it("works out midnight in India time", () => {
      expect(lastIndiaMidnight(Date.parse("2026-11-03T18:29:00Z")).toISOString()).toBe("2026-11-02T18:30:00.000Z");
      expect(lastIndiaMidnight(Date.parse("2026-11-03T18:30:00Z")).toISOString()).toBe("2026-11-03T18:30:00.000Z");
      expect(lastIndiaMidnight(Date.parse("2026-11-04T05:00:00Z")).toISOString()).toBe("2026-11-03T18:30:00.000Z");
    });

    it("allows 10 open requests per hostel, but repeats still count as upvotes", async () => {
      const hostel = (await fx.hostel("Limit Hostel")).id;
      const ids = await seed(hostel, Array.from({ length: 10 }, () => 1));
      expect(await openCount(hostel)).toBe(10);

      const full = await request(hostel, name("One Too Many"));
      expect(full.status).toBe(409);
      expect(full.body.message).toMatch(/list is full/);

      const repeat = await request(hostel, name("Item A"));
      expect(repeat.status).toBe(200);
      expect(repeat.body).toMatchObject({ duplicate: true, request: { id: ids[0], votes: 2 } });

      // Stocking one frees a spot.
      await call("PATCH", `/api/admin/feedback/product-requests/${ids[1]}`, { body: { status: "ADDED" }, admin: "admin" });
      expect((await request(hostel, name("One Too Many"))).status).toBe(201);
      expect(await openCount(hostel)).toBe(10);
    });

    it("never lets two customers take the last open spot", async () => {
      const hostel = (await fx.hostel("Race Hostel")).id;
      await seed(hostel, Array.from({ length: 9 }, () => 1));
      const results = await Promise.all(
        ["Racer One", "Racer Two", "Racer Three", "Racer Four", "Racer Five"].map((label) => request(hostel, name(label)))
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await openCount(hostel)).toBe(10);
    });

    it("keeps the top 3 after midnight and archives the rest with their votes", async () => {
      const hostel = (await fx.hostel("Reset Hostel")).id;
      // A=2, B=9, C=5, D=5 (tie with C, newer), E=1, F=7 → keep B, F, C.
      const [a, b, c, d, e, f] = await seed(hostel, [2, 9, 5, 5, 1, 7]);
      const stocked = (await request(hostel, name("Stocked"))).body.request.id;
      await call("PATCH", `/api/admin/feedback/product-requests/${stocked}`, { body: { status: "ADDED" }, admin: "admin" });
      await prisma.hostel.update({ where: { id: hostel }, data: { requestsResetAt: yesterday() } });

      const board = await list(hostel);
      expect(board.filter((r) => r.status === "OPEN").map((r) => r.id)).toEqual([b, f, c]);
      expect(board.find((r) => r.id === stocked)).toMatchObject({ status: "ADDED" });

      const archived = await prisma.productRequest.findMany({ where: { id: { in: [a, d, e] } } });
      expect(archived.every((r) => r.status === "ARCHIVED" && r.archivedAt !== null)).toBe(true);
      expect(Object.fromEntries(archived.map((r) => [r.id, r.voteCount]))).toEqual({ [a]: 2, [d]: 5, [e]: 1 });

      // Only once per day: new requests after the reset stay open.
      const later = (await request(hostel, name("After Reset"))).body.request.id;
      await list(hostel);
      expect((await list(hostel)).map((r) => r.id)).toContain(later);
      expect(await openCount(hostel)).toBe(4);

      // Archived requests can't be voted on, but requesting one again brings it back with its votes.
      expect((await vote(d, voter())).status).toBe(404);
      const back = await request(hostel, name("item d"));
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ duplicate: true, request: { id: d, votes: 6, status: "OPEN" } });

      const admin = await call("GET", `/api/admin/feedback/product-requests?hostelId=${hostel}&status=ARCHIVED`, { admin: "admin" });
      expect(admin.body.requests.map((r: { id: string }) => r.id).sort()).toEqual([a, e].sort());
      expect(admin.body.counts).toMatchObject({ OPEN: 5, ADDED: 1, ARCHIVED: 2 });
    });

    it("resets exactly once when many requests arrive just after midnight", async () => {
      const hostel = (await fx.hostel("Busy Midnight")).id;
      await seed(hostel, [8, 7, 6, 5, 4, 3, 2]);
      await prisma.hostel.update({ where: { id: hostel }, data: { requestsResetAt: yesterday() } });

      const archived = await Promise.all(Array.from({ length: 6 }, () => ensureDailyReset(hostel)));
      expect(archived.reduce((sum, n) => sum + n, 0)).toBe(4);
      expect(await openCount(hostel)).toBe(3);
      expect((await prisma.hostel.findUniqueOrThrow({ where: { id: hostel } })).requestsResetAt).toEqual(lastIndiaMidnight());
    });
  });
});
