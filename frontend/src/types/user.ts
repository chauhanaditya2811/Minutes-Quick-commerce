/**
 * Customer profile from GET /api/users/me.
 * UNCONFIRMED: exact field names (e.g. profile image) — verify against the backend.
 */
export interface UserProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  hostel: string | null;
  floor: string | null;
  room: string | null;
  profileImage: string | null;
}

/** Body accepted by PUT /api/users/me. */
export interface UpdateProfileInput {
  name: string;
  phone: string;
  hostel: string;
  floor: string;
  room: string;
}

export function isProfileComplete(p: UserProfile | null): boolean {
  return Boolean(p && p.name && p.phone && p.hostel && p.floor && p.room);
}
