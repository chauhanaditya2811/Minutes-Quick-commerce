/**
 * Customer profile from GET /api/users/me.
 */
export interface UserProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  hostelId: string | null;
  hostel: string | null;
  floor: number | null;
  room: string | null;
  profileImage: string | null;
}

/** Body accepted by PUT /api/users/me. */
export interface UpdateProfileInput {
  name: string;
  phone: string;
  hostelId: string;
  floor: number;
  room: string;
}

export function isProfileComplete(p: UserProfile | null): boolean {
  return Boolean(
    p &&
      p.name?.trim() &&
      /^[6-9]\d{9}$/.test(p.phone ?? '') &&
      p.hostelId?.trim() &&
      Number.isInteger(p.floor) &&
      p.floor !== null &&
      p.floor >= 0 &&
      p.room?.trim(),
  );
}
