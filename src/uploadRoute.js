// Express router to handle image uploads. This route expects a JSON body
// with a single `image` property containing a base64-encoded data URL. It
// uploads the image to Cloudinary and returns the publicly accessible URL.

const express = require('express');
const cloudinary = require('./cloudinary');

const router = express.Router();

// POST /upload-image
// Body: { image: "data:image/png;base64,..." }
// Response: { url: "https://res.cloudinary.com/..." }
router.post('/upload-image', async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }
  try {
    const uploadResponse = await cloudinary.uploader.upload(image, {
      folder: 'gunvald',
      resource_type: 'image',
    });
    return res.json({ url: uploadResponse.secure_url });
  } catch (error) {
    console.error('Cloudinary upload failed:', error);
    return res.status(500).json({ error: 'Image upload failed' });
  }
});

module.exports = router;