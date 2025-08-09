// Gunvald profile backend
// This Express server exposes API endpoints for user registration,
// authentication, profile management and image uploads. It uses
// PostgreSQL for data storage and JWT for authentication.

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pkg from 'pg';

// Read environment variables for database connection and JWT secret. In a
// Railway deployment you should configure DATABASE_URL and JWT_SECRET.
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configure multer for handling image uploads. Images are stored on
// disk under the `uploads/` directory. In production you may want to
// replace this with an S3 or Cloud Storage integration.
const upload = multer({ dest: 'uploads/' });

/**
 * Helper middleware to authenticate requests using JWT. It reads the
 * Authorization header in the form "Bearer <token>" and verifies the
 * token with the configured secret. On success it attaches the
 * userId to req and calls next(). On failure it returns 401.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * POST /register
 * Registers a new user by storing their email and a hashed password in
 * the users table. Returns a JWT for subsequent authenticated requests.
 */
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
      [email, passwordHash]
    );
    const token = jwt.sign({ userId: result.rows[0].id }, JWT_SECRET);
    return res.json({ token });
  } catch (err) {
    // Unique constraint violation on email
    return res.status(400).json({ error: 'User already exists' });
  }
});

/**
 * POST /login
 * Authenticates a user by comparing the provided password with the
 * stored password hash. Returns a JWT if successful.
 */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const userRes = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (userRes.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const user = userRes.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET);
  return res.json({ token });
});

/**
 * POST /profile
 * Creates or updates a profile for the authenticated user. If a
 * profile already exists for the user_id, it updates the existing row.
 */
app.post('/profile', authenticate, async (req, res) => {
  const { company_description, content_preferences, team_info, target_audience } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO profiles (user_id, company_description, content_preferences, team_info, target_audience)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET company_description = $2,
           content_preferences = $3,
           team_info = $4,
           target_audience = $5,
           updated_at = NOW()
       RETURNING *`,
      [req.userId, company_description, content_preferences, team_info, target_audience]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

/**
 * POST /profile/images
 * Uploads one or more images for the authenticated user's profile. The
 * request must include a `profileId` body property to associate the
 * images with an existing profile record. Up to 10 files may be
 * uploaded at once. Each uploaded file's filename is stored in
 * profile_images.image_url.
 */
app.post('/profile/images', authenticate, upload.array('images', 10), async (req, res) => {
  const { profileId } = req.body;
  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  try {
    const insertPromises = req.files.map(file =>
      pool.query('INSERT INTO profile_images (profile_id, image_url) VALUES ($1, $2)', [profileId, file.filename])
    );
    await Promise.all(insertPromises);
    return res.json({ message: 'Images uploaded successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to upload images' });
  }
});

/**
 * GET /profile
 * Retrieves the profile and associated image filenames for the
 * authenticated user. Returns null if no profile exists.
 */
app.get('/profile', authenticate, async (req, res) => {
  try {
    const profileRes = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [req.userId]);
    const profile = profileRes.rows[0];
    if (!profile) {
      return res.json(null);
    }
    const imagesRes = await pool.query(
      'SELECT image_url FROM profile_images WHERE profile_id = $1',
      [profile.id]
    );
    const images = imagesRes.rows.map(row => row.image_url);
    return res.json({ ...profile, images });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Start the server. The port is read from the PORT env variable or defaults
// to 3000. When deploying to Railway or other cloud environments, ensure
// this port is exposed by the runtime.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
