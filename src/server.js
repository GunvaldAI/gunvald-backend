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
import { randomUUID } from 'crypto';
import fs from 'fs';

// Read environment variables for database connection and JWT secret. In a
// Railway deployment you should configure DATABASE_URL and JWT_SECRET.
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Simple logger implementation used throughout the API. In production, you may
// replace this with a structured logger like pino or winston. The logger
// exposes info and error methods that proxy to console.log and console.error.
const logger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
};

// Attempt to apply the database schema on startup. This function reads the
// schema.sql file from the project root and executes it against the
// PostgreSQL database. It runs once when the server is first imported. If
// the tables already exist, the CREATE TABLE ... IF NOT EXISTS statements
// will simply do nothing. Any errors are logged but do not prevent the
// server from starting.
(async () => {
  try {
    // Resolve the path to schema.sql relative to this file. The schema
    // resides one directory up from src (../schema.sql) in the repository.
    const schemaPath = new URL('../schema.sql', import.meta.url);
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    logger.info('Database schema applied successfully');
  } catch (err) {
    logger.error('Error applying database schema:', err);
  }
})();


const app = express();
app.use(cors());
app.use(bodyParser.json());

// Middleware to assign a unique request ID and log each request and response.
// We generate a UUID for every request, attach it to req.reqId and log
// incoming and outgoing requests with duration. This aids in tracing and
// debugging without requiring heavy logging libraries.
app.use((req, res, next) => {
  const reqId = randomUUID();
  req.reqId = reqId;
  const start = Date.now();
  console.log(`[${reqId}] -> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${reqId}] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});


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
    // Create a new organization for the user. The name is derived from the
    // part of the email before the @ symbol. If it already exists, we still
    // create a separate organization for each new user.
    const orgName = email.split('@')[0];
    const orgResult = await pool.query(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [orgName]
    );
    const organizationId = orgResult.rows[0].id;

    // Hash the password and create the user record referencing the organization.
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      'INSERT INTO users (email, password_hash, organization_id) VALUES ($1, $2, $3) RETURNING id',
      [email, passwordHash, organizationId]
    );

    const userId = userResult.rows[0].id;
    const token = jwt.sign({ userId }, JWT_SECRET);
    return res.json({ token });
  } catch (err) {
    // Unique constraint violation on email or other DB error
    logger.error({ err }, 'Registration error');
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

/**
 * GET /health
 * A simple health check endpoint. Returns 200 OK when the server is running.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/generate
 * Generates a weekly content plan. Accepts a payload containing companyName,
 * industry, tone and campaign. Returns a list of posts, with basic moderation
 * and usage tracking. This is a stub implementation that generates
 * placeholder posts.
 */
app.post('/api/generate', authenticate, async (req, res) => {
  try {
    const {
      companyName = '',
      industry = '',
      tone = 'Innostunut',
      campaign = '',
      count = 5,
    } = req.body || {};

    // Basic banned words filter
    const bannedWords = ['kielletty', 'väkivalta', 'rasismi'];

    // Generate draft posts
    const generatedPosts = [];
    for (let i = 0; i < count; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      let text = `Postaus ${i + 1} yritykselle ${companyName}. Toimiala: ${industry}. Kampanja: ${campaign}.`;
      let hashtags = ['#yritys', '#some'];
      let flagged = false;
      // Check for banned words
      bannedWords.forEach(word => {
        if (text.toLowerCase().includes(word)) {
          flagged = true;
        }
      });
      generatedPosts.push({
        date: date.toISOString().split('T')[0],
        text,
        hashtags,
        image_url: null,
        flagged,
      });
    }

    // Update usage counters (tokens approximate to characters length, images zero)
    const tokensUsed = generatedPosts.reduce((sum, post) => sum + post.text.length, 0);
    const imagesGenerated = 0;
    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    // Upsert usage entry
    await pool.query(
      `INSERT INTO organization_usage (organization_id, month, tokens_used, images_generated)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, month) DO UPDATE
       SET tokens_used = organization_usage.tokens_used + $3,
           images_generated = organization_usage.images_generated + $4`,
      [req.userId, month, tokensUsed, imagesGenerated]
    );

    // Insert posts into DB as drafts
    for (const p of generatedPosts) {
      await pool.query(
        `INSERT INTO posts (organization_id, text, hashtags, image_url, status, scheduled_at)
         VALUES ($1, $2, $3, $4, 'draft', NULL)`,
        [req.userId, p.text, p.hashtags, p.image_url]
      );
    }

    return res.status(201).json(generatedPosts);
  } catch (err) {
    logger.error({ err }, 'Error in /api/generate');
    return res.status(500).json({ error: 'Failed to generate content' });
  }
});

/**
 * GET /api/posts
 * Returns a list of posts for the authenticated user's organization.
 * For now this returns an empty array as no posts exist at the beginning.
 */
app.get('/api/posts', authenticate, async (req, res) => {
  try {
    // Fetch all posts for the authenticated user's organization, ordered by created_at
    const result = await pool.query(
      'SELECT id, text, hashtags, image_url, status, scheduled_at, created_at, updated_at FROM posts WHERE organization_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    return res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Error in /api/posts');
    return res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

/**
 * POST /api/brand-profile
 * Creates or updates the brand profile for the authenticated user's organization.
 * This is a simplified implementation that associates the brand profile with
 * the user ID as the organization ID until proper organization support is added.
 */
app.post('/api/brand-profile', authenticate, async (req, res) => {
  const {
    company_name,
    industry,
    target_audience,
    tone,
    brand_colors,
    logo_url,
  } = req.body;
  try {
    // Upsert into brand_profiles using userId as organization_id placeholder
    const result = await pool.query(
      `INSERT INTO brand_profiles (organization_id, company_name, industry, target_audience, tone, brand_colors, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id) DO UPDATE
       SET company_name = $2,
           industry = $3,
           target_audience = $4,
           tone = $5,
           brand_colors = $6,
           logo_url = $7,
           updated_at = NOW()
       RETURNING *`,
      [req.userId, company_name, industry, target_audience, tone, brand_colors, logo_url]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Error in /api/brand-profile');
    return res.status(500).json({ error: 'Failed to save brand profile' });
  }
});

/**
 * GET /api/brand-profile
 * Retrieves the brand profile for the authenticated user's organization.
 */
app.get('/api/brand-profile', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM brand_profiles WHERE organization_id = $1',
      [req.userId]
    );
    const profile = result.rows[0] || null;
    return res.json(profile);
  } catch (err) {
    logger.error({ err }, 'Error in GET /api/brand-profile');
    return res.status(500).json({ error: 'Failed to fetch brand profile' });
  }
});

/**
 * GET /api/usage
 * Returns usage statistics (tokens and images) for the authenticated user's organization for the current month.
 */
app.get('/api/usage', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const result = await pool.query(
      'SELECT tokens_used, images_generated FROM organization_usage WHERE organization_id = $1 AND month = $2',
      [req.userId, month]
    );
    const usage = result.rows[0] || { tokens_used: 0, images_generated: 0 };
    return res.json(usage);
  } catch (err) {
    logger.error({ err }, 'Error in GET /api/usage');
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

/**
 * POST /api/schedule
 * Schedule a post to be published at a specific date/time. Expects
 * postId and publishAt (ISO string) in the request body.
 */
app.post('/api/schedule', authenticate, async (req, res) => {
  const { postId, publishAt } = req.body;
  if (!postId || !publishAt) {
    return res.status(400).json({ error: 'postId and publishAt are required' });
  }
  try {
    await pool.query(
      `UPDATE posts SET scheduled_at = $1, status = 'scheduled' WHERE id = $2 AND organization_id = $3`,
      [publishAt, postId, req.userId]
    );
    return res.json({ message: 'Post scheduled' });
  } catch (err) {
    logger.error({ err }, 'Error in POST /api/schedule');
    return res.status(500).json({ error: 'Failed to schedule post' });
  }
});

/**
 * POST /api/publish-scheduled
 * Mock worker endpoint to publish any scheduled posts whose scheduled_at is
 * in the past. This updates status to 'published'. In a real system this
 * would run in a background worker (BullMQ/Agenda) and integrate with
 * social media APIs.
 */
app.post('/api/publish-scheduled', authenticate, async (req, res) => {
  try {
    const now = new Date();
    await pool.query(
      `UPDATE posts SET status = 'published'
       WHERE organization_id = $1 AND status = 'scheduled' AND scheduled_at <= $2`,
      [req.userId, now.toISOString()]
    );
    return res.json({ message: 'Scheduled posts published' });
  } catch (err) {
    logger.error({ err }, 'Error in /api/publish-scheduled');
    return res.status(500).json({ error: 'Failed to publish scheduled posts' });
  }
});

// Start the server. The port is read from the PORT env variable or defaults
// to 3000. When deploying to Railway or other cloud environments, ensure
// this port is exposed by the runtime.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});