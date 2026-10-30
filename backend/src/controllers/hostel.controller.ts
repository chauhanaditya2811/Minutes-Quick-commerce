import type { Request, Response } from "express";
import {
  HostelServiceError,
  activateHostel,
  createHostel,
  deactivateHostel,
  getActiveHostels,
  getAllHostels,
  permanentlyDeleteHostel,
} from "../services/hostel.service.js";

const handleError = (error: unknown, res: Response, fallback: string) => {
  if (error instanceof HostelServiceError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ message: fallback });
};

export const listActiveHostels = async (_req: Request, res: Response): Promise<void> => {
  try { res.status(200).json(await getActiveHostels()); }
  catch (error) { handleError(error, res, "Unable to retrieve hostels."); }
};

export const listAdminHostels = async (_req: Request, res: Response): Promise<void> => {
  try { res.status(200).json(await getAllHostels()); }
  catch (error) { handleError(error, res, "Unable to retrieve hostels."); }
};

export const createHostelController = async (req: Request, res: Response): Promise<void> => {
  if (typeof req.body?.name !== "string" || !req.body.name.trim()) {
    res.status(400).json({ message: "A non-empty hostel name is required." });
    return;
  }
  const stockGroupId = typeof req.body.stockGroupId === "string" && req.body.stockGroupId.trim() ? req.body.stockGroupId.trim() : undefined;
  try { res.status(201).json(await createHostel(req.body.name, stockGroupId)); }
  catch (error) { handleError(error, res, "Unable to create hostel right now. Please try again later."); }
};

export const deactivateHostelController = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ message: "A hostel ID is required." });
    return;
  }
  try { res.status(200).json(await deactivateHostel(id)); }
  catch (error) { handleError(error, res, "Unable to deactivate hostel."); }
};

export const activateHostelController = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ message: "A hostel ID is required." });
    return;
  }
  try { res.status(200).json(await activateHostel(id)); }
  catch (error) { handleError(error, res, "Unable to activate hostel."); }
};

export const permanentlyDeleteHostelController = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  if (typeof id !== "string" || !id.trim()) {
    res.status(400).json({ message: "A hostel ID is required." });
    return;
  }
  try {
    await permanentlyDeleteHostel(id);
    res.status(204).send();
  } catch (error) {
    handleError(error, res, "Unable to permanently delete hostel.");
  }
};
