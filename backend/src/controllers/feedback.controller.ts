import type { Request, Response } from "express";
import {
  FeedbackError,
  MAX_OPEN_REQUESTS,
  createFeedback,
  createProductRequest,
  deleteProductRequest,
  getAdminFeedback,
  getAdminProductRequests,
  listProductRequests,
  removeProductRequestVote,
  updateFeedbackStatus,
  updateProductRequestStatus,
  voteForProductRequest,
} from "../services/feedback.service.js";

/** Header carrying the browser's random voter token (one upvote per request per device). */
export const VOTER_TOKEN_HEADER = "x-voter-token";

const sendError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof FeedbackError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ message: fallback });
};

const voterToken = (req: Request) => req.get(VOTER_TOKEN_HEADER);
const query = (value: unknown) => (typeof value === "string" ? value : undefined);

export const listProductRequestsController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({
      requests: await listProductRequests({ poolId: query(req.query.poolId), hostelId: query(req.query.hostelId) }, voterToken(req)),
      maxOpen: MAX_OPEN_REQUESTS,
    });
  } catch (error) {
    sendError(error, res, "Could not load product requests.");
  }
};

export const createProductRequestController = async (req: Request, res: Response) => {
  try {
    const result = await createProductRequest(req.body, voterToken(req));
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    sendError(error, res, "Could not save your request.");
  }
};

export const voteProductRequestController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ request: await voteForProductRequest(req.params.requestId, voterToken(req)) });
  } catch (error) {
    sendError(error, res, "Could not save your vote.");
  }
};

export const unvoteProductRequestController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ request: await removeProductRequestVote(req.params.requestId, voterToken(req)) });
  } catch (error) {
    sendError(error, res, "Could not remove your vote.");
  }
};

export const createFeedbackController = async (req: Request, res: Response) => {
  try {
    res.status(201).json({ feedback: await createFeedback(req.body) });
  } catch (error) {
    sendError(error, res, "Could not send your feedback.");
  }
};

export const getAdminProductRequestsController = async (req: Request, res: Response) => {
  try {
    res.status(200).json(await getAdminProductRequests({ poolId: query(req.query.poolId), status: query(req.query.status) }));
  } catch (error) {
    sendError(error, res, "Could not load product requests.");
  }
};

export const updateProductRequestStatusController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ request: await updateProductRequestStatus(req.params.requestId, req.body) });
  } catch (error) {
    sendError(error, res, "Could not update the request.");
  }
};

export const deleteProductRequestController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ request: await deleteProductRequest(req.params.requestId) });
  } catch (error) {
    sendError(error, res, "Could not delete the request.");
  }
};

export const getAdminFeedbackController = async (req: Request, res: Response) => {
  try {
    res.status(200).json(await getAdminFeedback({ status: query(req.query.status) }));
  } catch (error) {
    sendError(error, res, "Could not load feedback.");
  }
};

export const updateFeedbackStatusController = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ feedback: await updateFeedbackStatus(req.params.feedbackId, req.body) });
  } catch (error) {
    sendError(error, res, "Could not update the feedback.");
  }
};
