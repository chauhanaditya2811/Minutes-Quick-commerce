import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hostelFindMany: vi.fn(), hostelFindFirst: vi.fn(), hostelCreate: vi.fn(), hostelUpdate: vi.fn(), hostelUpdateMany: vi.fn(), hostelFindUnique: vi.fn(), hostelDelete: vi.fn(), userFindFirst: vi.fn(), verifyIdToken: vi.fn(),
}));
vi.mock("../src/config/database.js", () => ({ prisma: { hostel: { findMany: mocks.hostelFindMany, findFirst: mocks.hostelFindFirst, create: mocks.hostelCreate, update: mocks.hostelUpdate, updateMany: mocks.hostelUpdateMany, findUnique: mocks.hostelFindUnique, delete: mocks.hostelDelete }, user: { findFirst: mocks.userFindFirst } } }));
vi.mock("../src/config/firebase.js", () => ({ default: {} }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));

import hostelRoutes from "../src/routes/hostel.routes.js";
import adminHostelRoutes from "../src/routes/admin-hostel.routes.js";

describe("hostel routes", () => {
  let server: Server; let baseUrl: string; let previousAdminEmail: string | undefined;
  beforeAll(async () => {
    previousAdminEmail = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = "admin@example.test";
    const app = express(); app.use(express.json()); app.use("/api/hostels", hostelRoutes); app.use("/api/admin/hostels", adminHostelRoutes);
    server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port"); baseUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockImplementation(async (token: string) => token === "admin" ? { uid: "a", email: "admin@example.test" } : token === "customer" ? { uid: "c", email: "customer@example.test" } : Promise.reject(new Error("bad token")));
    mocks.hostelFindMany.mockResolvedValue([]); mocks.hostelFindFirst.mockResolvedValue(null); mocks.hostelCreate.mockResolvedValue({ id: "h1", name: "Block A", isActive: true }); mocks.hostelUpdateMany.mockResolvedValue({ count: 1 }); mocks.hostelFindUnique.mockResolvedValue({ id: "h1", name: "Block A", isActive: false }); mocks.userFindFirst.mockResolvedValue(null); mocks.hostelDelete.mockResolvedValue({});
  });
  afterAll(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previousAdminEmail; });
  it("lists active hostels publicly", async () => {
    mocks.hostelFindMany.mockResolvedValue([{ id: "h1", name: "Block A", isActive: true }]);
    const response = await fetch(`${baseUrl}/api/hostels`); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual([{ id: "h1", name: "Block A", isActive: true }]); expect(mocks.hostelFindMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { name: "asc" } });
  });
  it("rejects admin writes without an admin token", async () => {
    expect((await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Block A" }) })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer customer", "content-type": "application/json" }, body: JSON.stringify({ name: "Block A" }) })).status).toBe(403);
  });
  it("creates a hostel and rejects blank names", async () => {
    const created = await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: " Block A " }) }); expect(created.status).toBe(201); expect(mocks.hostelCreate).toHaveBeenCalledWith({ data: { name: "Block A" } });
    const blank = await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: " " }) }); expect(blank.status).toBe(400);
  });
  it("rejects duplicate active names and reactivates an inactive name", async () => {
    mocks.hostelFindFirst.mockResolvedValue({ id: "h1", name: "Block A", isActive: true });
    expect((await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "block a" }) })).status).toBe(409);
    mocks.hostelFindFirst.mockResolvedValue({ id: "h1", name: "Block A", isActive: false }); mocks.hostelUpdate.mockResolvedValue({ id: "h1", name: "block a", isActive: true });
    expect((await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "block a" }) })).status).toBe(201); expect(mocks.hostelUpdate).toHaveBeenCalledWith({ where: { id: "h1" }, data: { isActive: true, name: "block a" } });
  });
  it("handles a concurrent duplicate insert without exposing database details", async () => {
    mocks.hostelCreate.mockRejectedValue({ code: "P2002" });
    const response = await fetch(`${baseUrl}/api/admin/hostels`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify({ name: "Block A" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ message: "A hostel with this name already exists." });
  });
  it("deactivates an existing hostel and returns 404 when absent", async () => {
    expect((await fetch(`${baseUrl}/api/admin/hostels/h1/deactivate`, { method: "PATCH", headers: { authorization: "Bearer admin" } })).status).toBe(200);
    mocks.hostelUpdateMany.mockResolvedValue({ count: 0 }); expect((await fetch(`${baseUrl}/api/admin/hostels/missing/deactivate`, { method: "PATCH", headers: { authorization: "Bearer admin" } })).status).toBe(404);
  });
  it("activates an inactive hostel and requires admin access", async () => {
    const response = await fetch(`${baseUrl}/api/admin/hostels/h1/activate`, { method: "PATCH", headers: { authorization: "Bearer admin" } });
    expect(response.status).toBe(200);
    expect(mocks.hostelUpdateMany).toHaveBeenCalledWith({ where: { id: "h1" }, data: { isActive: true } });
    expect((await fetch(`${baseUrl}/api/admin/hostels/h1/activate`, { method: "PATCH" })).status).toBe(401);
  });
  it("permanently deletes an unused hostel", async () => {
    const response = await fetch(`${baseUrl}/api/admin/hostels/h1/permanent`, { method: "DELETE", headers: { authorization: "Bearer admin" } });
    expect(response.status).toBe(204);
    expect(mocks.hostelFindUnique).toHaveBeenCalledWith({ where: { id: "h1" } });
    expect(mocks.userFindFirst).toHaveBeenCalledWith({ where: { hostelId: "h1" }, select: { id: true } });
    expect(mocks.hostelDelete).toHaveBeenCalledWith({ where: { id: "h1" } });
  });
  it("rejects permanent deletion when a user references the hostel", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
    const response = await fetch(`${baseUrl}/api/admin/hostels/h1/permanent`, { method: "DELETE", headers: { authorization: "Bearer admin" } });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ message: "This hostel cannot be deleted because user profiles still reference it. Reassign those users before deleting the hostel." });
    expect(mocks.hostelDelete).not.toHaveBeenCalled();
  });
  it("returns 404 when permanently deleting a nonexistent hostel", async () => {
    mocks.hostelFindUnique.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/api/admin/hostels/missing/permanent`, { method: "DELETE", headers: { authorization: "Bearer admin" } });
    expect(response.status).toBe(404);
  });
});
