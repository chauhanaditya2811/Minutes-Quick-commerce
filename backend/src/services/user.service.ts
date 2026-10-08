import { prisma } from "../config/database.js";

export interface FirebaseUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

// Finds an existing PostgreSQL user or creates one using Firebase user information.
export const getOrCreateUser = async (firebaseUser: FirebaseUser) => {
  const existingUser = await prisma.user.findUnique({
    where: {
      firebaseUid: firebaseUser.uid,
    },
  });

  if (existingUser) {
    return existingUser;
  }

  if (!firebaseUser.email) {
    throw new Error("Firebase user does not have an email address.");
  }

  const newUser = await prisma.user.create({
    data: {
      firebaseUid: firebaseUser.uid,
      email: firebaseUser.email,
      name: firebaseUser.name ?? null,
      profileImage: firebaseUser.picture ?? null,
    },
  });

  return newUser;
};

export interface UpdateUserProfile {
  name: string;
  phone: string;
  hostel: string;
  floor: number;
  room: string;
}

// Updates the authenticated user's allowed profile fields in PostgreSQL.
export const updateUserProfile = async (
  firebaseUid: string,
  data: UpdateUserProfile
) => {
  const updatedUser = await prisma.user.update({
    where: {
      firebaseUid,
    },
    data: {
      name: data.name,
      phone: data.phone,
      hostel: data.hostel,
      floor: data.floor,
      room: data.room,
    },
  });

  return updatedUser;
};