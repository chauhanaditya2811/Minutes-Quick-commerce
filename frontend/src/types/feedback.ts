export type ProductRequestStatus = 'OPEN' | 'ADDED' | 'HIDDEN' | 'ARCHIVED';
export type FeedbackStatus = 'NEW' | 'DONE';

/** A row on a hostel's public request board (GET /api/product-requests). */
export interface ProductRequest {
  id: string;
  name: string;
  status: ProductRequestStatus;
  votes: number;
  /** Whether this device has upvoted it. */
  voted: boolean;
  addedAt: string | null;
  createdAt: string;
}

/** GET /api/product-requests: the board and how many requests can be open at once. */
export interface ProductRequestBoard {
  requests: ProductRequest[];
  maxOpen: number;
}

export interface CreateProductRequestResponse {
  request: ProductRequest;
  /** True when the product was already requested and this became an upvote. */
  duplicate: boolean;
}

export interface FeedbackInput {
  hostelId?: string;
  message: string;
  rating?: number;
  contactPhone?: string;
}

export interface AdminProductRequest {
  id: string;
  name: string;
  status: ProductRequestStatus;
  votes: number;
  hostel: { id: string; name: string };
  addedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductRequests {
  counts: Record<ProductRequestStatus, number>;
  requests: AdminProductRequest[];
}

export interface AdminFeedbackMessage {
  id: string;
  message: string;
  rating: number | null;
  contactPhone: string | null;
  status: FeedbackStatus;
  hostel: { id: string; name: string } | null;
  createdAt: string;
}

export interface AdminFeedback {
  counts: Record<FeedbackStatus, number>;
  messages: AdminFeedbackMessage[];
}
