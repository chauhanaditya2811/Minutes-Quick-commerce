import type  { UploadApiResponse } from "cloudinary";
import { Readable } from "node:stream";
import cloudinary from "../config/cloudinary.js";

// Uploads an image buffer to Cloudinary and returns its hosted URL.
export const uploadProductImage = async (
  file: Express.Multer.File
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "minutes/products",
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result) {
          reject(new Error("Cloudinary did not return an upload result."));
          return;
        }

        resolve(result);
      }
    );

    Readable.from(file.buffer).pipe(uploadStream);
  });
};