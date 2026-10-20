import { prisma } from "../config/database.js";

export class HostelServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "HostelServiceError";
  }
}

export const getActiveHostels = () =>
  prisma.hostel.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

export const getAllHostels = () =>
  prisma.hostel.findMany({ orderBy: { name: "asc" } });

export const getHostelById = (id: string) => prisma.hostel.findUnique({ where: { id } });

export const createHostel = async (name: string) => {
  const normalizedName = name.trim();
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
    return await prisma.hostel.create({ data: { name: normalizedName } });
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

  try {
    await prisma.hostel.delete({ where: { id } });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2003"
    ) {
      throw new HostelServiceError(
        "This hostel cannot be deleted because user profiles still reference it. Reassign those users before deleting the hostel.",
        409,
      );
    }
    throw error;
  }
};
