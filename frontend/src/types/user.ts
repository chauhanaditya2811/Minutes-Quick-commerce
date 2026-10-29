/**
 * Customer profile from GET /api/users/me.
 */
export interface UserProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  hostelId: string | null;
  hostel: string | null;
  /** Block and floor, e.g. "A/2". */
  floor: string | null;
  room: string | null;
  profileImage: string | null;
}

/** Body accepted by PUT /api/users/me. */
export interface UpdateProfileInput {
  name: string;
  phone: string;
  hostelId: string;
  floor: string;
  room: string;
}

export function isProfileComplete(p: UserProfile | null): boolean {
  return Boolean(
    p &&
      p.name?.trim() &&
      /^[6-9]\d{9}$/.test(p.phone ?? '') &&
      p.hostelId?.trim() &&
      p.floor?.trim() &&
      p.room?.trim(),
  );
}
