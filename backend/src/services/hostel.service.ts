import { prisma } from "../config/database.js";

export class HostelServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "HostelServiceError";
  }
}

export const getActiveHostels = () =>
  prisma.hostel.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

/** Every hostel with the stock group it sells from, for the admin. */
export const getAllHostels = () =>
  prisma.hostel.findMany({ orderBy: { name: "asc" }, include: { stockGroup: { select: { id: true, name: true } } } });

export const getHostelById = (id: string) => prisma.hostel.findUnique({ where: { id } });

/**
 * Creates a hostel. With `stockGroupId` it sells from that existing group's stock; otherwise it
 * gets a stock group of its own, named after it.
 */
export const createHostel = async (name: string, stockGroupId?: string) => {
  const normalizedName = name.trim();
  if (stockGroupId && !(await prisma.stockGroup.findUnique({ where: { id: stockGroupId } }))) {
    throw new HostelServiceError("That stock group no longer exists.", 400);
  }
  const existing = await prisma.hostel.findFirst({
    where: { name: { equals: normalizedName, mode: "insensitive" } },
  });

  if (existing?.isActive) {
    throw new HostelServiceError("A hostel with this name already exists.", 409);
  }
  if (existing) {
    return prisma.hostel.update({ where: { id: existing.id }, data: { isActive: true, name: normalizedName } });
  }
  try {
    return await prisma.hostel.create({
      data: {
        name: normalizedName,
        stockGroup: stockGroupId ? { connect: { id: stockGroupId } } : { create: { name: normalizedName } },
      },
    });
  } catch (error) {
    // The database's lower-case unique index also protects against a concurrent create.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new HostelServiceError("A hostel with this name already exists.", 409);
    }
    throw error;
  }
};

export const deactivateHostel = async (id: string) => {
  const updated = await prisma.hostel.updateMany({ where: { id }, data: { isActive: false } });
  if (updated.count === 0) throw new HostelServiceError("Hostel not found.", 404);
  return getHostelById(id);
};

export const activateHostel = async (id: string) => {
  const updated = await prisma.hostel.updateMany({ where: { id }, data: { isActive: true } });
  if (updated.count === 0) throw new HostelServiceError("Hostel not found.", 404);
  return getHostelById(id);
};

export const permanentlyDeleteHostel = async (id: string) => {
  const hostel = await prisma.hostel.findUnique({ where: { id } });
  if (!hostel) throw new HostelServiceError("Hostel not found.", 404);

  const user = await prisma.user.findFirst({
    where: { hostelId: id },
    select: { id: true },
  });
  if (user) {
    throw new HostelServiceError(
      "This hostel cannot be deleted because user profiles still reference it. Reassign those users before deleting the hostel.",
      409,
    );
  }

  const order = await prisma.order.findFirst({
    where: { hostelId: id },
    select: { id: true },
  });
  if (order) {
    throw new HostelServiceError(
      "This hostel cannot be deleted because orders were placed against it. Deactivate it instead.",
      409,
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.hostel.delete({ where: { id } });
      // Its stock group goes too if no other hostel sells from it (taking its stock counts with it).
      const others = await tx.hostel.count({ where: { stockGroupId: hostel.stockGroupId } });
      if (others === 0) await tx.stockGroup.delete({ where: { id: hostel.stockGroupId } });
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2003"
    ) {
      throw new HostelServiceError(
        "This hostel cannot be deleted because users or orders still reference it. Deactivate it instead.",
        409,
      );
    }
    throw error;
  }
};
