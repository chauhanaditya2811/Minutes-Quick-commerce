// Mirrors backend/src/utils/blockFloor.ts so mistakes show before a request; the server re-validates.
export const BLOCK_FLOOR_MAX_LENGTH = 10;

const BLOCK_FLOOR_PATTERN = /^[A-Z0-9](?:[A-Z0-9 /-]*[A-Z0-9])?$/;

export const BLOCK_FLOOR_MESSAGE = 'Enter your block/floor, e.g. A/2.';

/** "a / 2" → "A/2"; null when it isn't a valid block/floor. */
export function parseBlockFloor(input: string): string | null {
  const value = input
    .trim()
    .toUpperCase()
    .replace(/\s*([/-])\s*/g, '$1')
    .replace(/\s+/g, ' ');
  return value.length <= BLOCK_FLOOR_MAX_LENGTH && BLOCK_FLOOR_PATTERN.test(value) ? value : null;
}

/** One-line delivery address: "Hostel A, Block/Floor A/2, Room 214". */
export const deliveryAddress = (hostel: string, floor: string, room: string) =>
  `${hostel}, Block/Floor ${floor}, Room ${room}`;
