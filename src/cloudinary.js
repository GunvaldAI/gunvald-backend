// Configuration for the Cloudinary SDK. This module reads Cloudinary
// credentials from environment variables and initializes the SDK. The
// variables `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
// `CLOUDINARY_API_SECRET` should be defined in your deployment
// environment (e.g. Railway, Vercel).

const cloudinary = require('cloudinary').v2;

// Configure Cloudinary using environment variables. If any of these are
// missing, Cloudinary will throw an error when attempting to upload.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;