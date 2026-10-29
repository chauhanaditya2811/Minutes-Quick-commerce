export const BLOCK_FLOOR_MAX_LENGTH = 10;

// Letters and digits, optionally split by "/", "-" or a space: "2", "G", "A/2", "B-3", "Block A 2".
const BLOCK_FLOOR_PATTERN = /^[A-Z0-9](?:[A-Z0-9 /-]*[A-Z0-9])?$/;

export const BLOCK_FLOOR_MESSAGE = "Enter your block/floor, e.g. A/2.";

/**
 * Normalises a customer's block/floor ("a / 2" → "A/2"), or returns null when it isn't valid.
 * Plain whole numbers are still accepted from app versions that sent floor as a number.
 */
export const parseBlockFloor = (input: unknown): string | null => {
  let value: string;
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input) || input < 0) return null;
    value = String(input);
  } else if (typeof input === "string") {
    value = input
      .trim()
      .toUpperCase()
      .replace(/\s*([/-])\s*/g, "$1")
      .replace(/\s+/g, " ");
  } else {
    return null;
  }
  if (value.length > BLOCK_FLOOR_MAX_LENGTH || !BLOCK_FLOOR_PATTERN.test(value)) return null;
  return value;
};
