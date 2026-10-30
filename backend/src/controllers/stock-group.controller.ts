import type { Request, Response } from "express";
import {
  StockGroupError,
  createStockGroup,
  deleteStockGroup,
  listStockGroups,
  moveHostelToGroup,
  updateStockGroup,
} from "../services/stock-group.service.js";

const handleError = (error: unknown, res: Response, fallback: string) => {
  if (error instanceof StockGroupError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ message: fallback });
};

const groupId = (req: Request) => (typeof req.params.id === "string" ? req.params.id.trim() : "");

export const listStockGroupsController = async (_req: Request, res: Response): Promise<void> => {
  try { res.status(200).json(await listStockGroups()); }
  catch (error) { handleError(error, res, "Unable to load stock groups."); }
};

export const createStockGroupController = async (req: Request, res: Response): Promise<void> => {
  try { res.status(201).json(await createStockGroup(req.body)); }
  catch (error) { handleError(error, res, "Unable to create the stock group."); }
};

export const updateStockGroupController = async (req: Request, res: Response): Promise<void> => {
  try { res.status(200).json(await updateStockGroup(groupId(req), req.body)); }
  catch (error) { handleError(error, res, "Unable to update the stock group."); }
};

export const moveHostelToGroupController = async (req: Request, res: Response): Promise<void> => {
  try { res.status(200).json(await moveHostelToGroup(groupId(req), req.body)); }
  catch (error) { handleError(error, res, "Unable to move the hostel."); }
};

export const deleteStockGroupController = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteStockGroup(groupId(req));
    res.status(204).end();
  } catch (error) { handleError(error, res, "Unable to delete the stock group."); }
};
