// Gunvald profile backend (CommonJS version) with default port 8880
// This Express server exposes API endpoints for user registration,
// authentication, profile management, brand profiles, content generation and scheduling.
// It uses PostgreSQL for data storage and JWT for authentication. It also applies
// the database schema on startup using a local schema.sql file.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

// Import Clerk middleware for authentication via Clerk sessions
const { ClerkExpressWithAuth } = require('@clerk/clerk-sdk-node');
const fs = require('fs');
const path = require('path');

// Import AI helper for content generation
const { generatePlan } = require('./ai');

// Read environment variables for database connection and JWT secret.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Simple logger for tracing requests.
const logger = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
};

// Apply the database schema from schema.sql at startup.
async function applySchema() {
  try {
    // schema.sql is located one directory up from this server file
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    logger.info('Database schema applied successfully');
  } catch (err) {
    logger.error('Error applying database schema:', err);
  }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Apply Clerk middleware to attach `auth` information to each request.
// This will populate `req.auth.userId` when a valid Clerk session token is provided.
app.use(ClerkExpressWithAuth());

// Middleware for unique request IDs and logging.
app.use((req, res, next) => {
  const reqId = randomUUID();
  req.reqId = reqId;
  // Include request ID in response headers for tracing
  res.setHeader('X-Request-ID', reqId);
  const start = Date.now();
  logger.info(`[${reqId}] -> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      `[${reqId}] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });
  next();
});

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Auth middleware
function authenticate(req, res, next) {
  // If Clerk has authenticated the request, use the Clerk userId
  if (req.auth && req.auth.userId) {
    req.userId = req.auth.userId;
    return next();
  }
  // Fallback to JWT authentication for legacy clients
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure user belongs to an organization; create if missing
async function ensureOrganization(userId, name) {
  const orgRes = await pool.query(
    'SELECT organization_id FROM users WHERE id=$1',
    [userId]
  );
  let orgId = orgRes.rows[0]?.organization_id;
  if (!orgId) {
    const createOrg = await pool.query(
      'INSERT INTO organizations (name, created_at) VALUES ($1, NOW()) RETURNING id',
      [name || 'Unnamed']
    );
    orgId = createOrg.rows[0].id;
    await pool.query('UPDATE users SET organization_id=$1 WHERE id=$2', [orgId, userId]);
  }
  return orgId;
}

// --- AUTH ROUTES ---
app.post('/register', async (req, res) => {
  const { email, password, companyName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      'INSERT INTO users (email, password_hash, organization_id, created_at) VALUES ($1, $2, NULL, NOW()) RETURNING id',
      [email, passwordHash]
    );
    const userId = userRes.rows[0].id;
    const orgId = await ensureOrganization(userId, companyName || email.split('@')[0]);
    const token = jwt.sign({ userId, organizationId: orgId }, JWT_SECRET);
    return res.json({ token });
  } catch (err) {
    logger.error('Register error:', err);
    return res.status(400).json({ error: 'User already exists' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const userRes = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (userRes.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
  const user = userRes.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id, organizationId: user.organization_id }, JWT_SECRET);
  return res.json({ token });
});

// --- PROFILE ROUTES ---
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
    logger.error('Error saving profile:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

app.post('/profile/images', authenticate, upload.array('images', 10), async (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId is required' });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  try {
    const insertPromises = req.files.map((file) =>
      pool.query('INSERT INTO profile_images (profile_id, image_url) VALUES ($1, $2)', [profileId, file.filename])
    );
    await Promise.all(insertPromises);
    return res.json({ message: 'Images uploaded successfully' });
  } catch (err) {
    logger.error('Image upload error:', err);
    return res.status(500).json({ error: 'Failed to upload images' });
  }
});

app.get('/profile', authenticate, async (req, res) => {
  try {
    const profileRes = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [req.userId]);
    const profile = profileRes.rows[0];
    if (!profile) return res.json(null);
    const imagesRes = await pool.query(
      'SELECT image_url FROM profile_images WHERE profile_id = $1',
      [profile.id]
    );
    const images = imagesRes.rows.map((row) => row.image_url);
    return res.json({ ...profile, images });
  } catch (err) {
    logger.error('Error fetching profile:', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// --- BRAND PROFILE ROUTES ---
app.post('/api/brand-profile', authenticate, async (req, res) => {
  const { company_name, industry, target_audience, tone, brand_colors, logo_url } = req.body;
  try {
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    const result = await pool.query(
      `INSERT INTO brand_profiles (organization_id, company_name, industry, target_audience, tone, brand_colors, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id) DO UPDATE
       SET company_name=$2,
           industry=$3,
           target_audience=$4,
           tone=$5,
           brand_colors=$6,
           logo_url=$7
       RETURNING *`,
      [orgId, company_name, industry, target_audience, tone, brand_colors, logo_url]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error saving brand profile:', err);
    return res.status(500).json({ error: 'Failed to save brand profile' });
  }
});

app.get('/api/brand-profile', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    const result = await pool.query('SELECT * FROM brand_profiles WHERE organization_id = $1', [orgId]);
    return res.json(result.rows[0] || null);
  } catch (err) {
    logger.error('Error fetching brand profile:', err);
    return res.status(500).json({ error: 'Failed to fetch brand profile' });
  }
});

// --- AI GENERATION & POSTS ---
// Array of words that should flag generated content for moderation.
const bannedWords = ['kielletty', 'väkivalta', 'rasismi'];

/**
 * POST /api/generate
 * Generates a series of draft posts for the authenticated user's organization.
 * Optionally accepts `count` in the request body to control the number of posts (1–7).
 * Uses the brand profile to craft more relevant content via the generatePlan helper.
 */
app.post('/api/generate', authenticate, async (req, res) => {
  const { count } = req.body;
  // Default to 5 posts; clamp the count between 1 and 7 to avoid excessive generation.
  const postCount = count && Number(count) > 0 ? Math.min(Number(count), 7) : 5;
  try {
    // Determine the organization for the current user.
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization not found' });
    }

    // Fetch the brand profile associated with this organization to inform content generation.
    const brandRes = await pool.query(
      'SELECT company_name, industry, target_audience, tone, brand_colors FROM brand_profiles WHERE organization_id=$1',
      [orgId]
    );
    const brand = brandRes.rows[0] || {};

    // Use the AI helper to generate raw post suggestions (text + hashtags).
    const generated = generatePlan(brand, postCount);
    const posts = [];

    // Construct final post objects with scheduling and moderation flags.
    for (let i = 0; i < generated.length; i++) {
      const { text, hashtags } = generated[i];
      const flagged = bannedWords.some((w) => text.toLowerCase().includes(w));
      const date = new Date();
      date.setDate(date.getDate() + i);
      posts.push({
        organization_id: orgId,
        text,
        hashtags,
        scheduled_at: date,
        flagged,
        status: 'draft',
      });
    }

    // Persist posts to the database.
    for (const post of posts) {
      await pool.query(
        `INSERT INTO posts (organization_id, text, hashtags, scheduled_at, flagged, status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [post.organization_id, post.text, post.hashtags, post.scheduled_at, post.flagged, post.status]
      );
    }
    return res.status(201).json(posts);
  } catch (err) {
    logger.error('Error generating posts:', err);
    return res.status(500).json({ error: 'Failed to generate posts' });
  }
});

app.get('/api/posts', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    const postsRes = await pool.query('SELECT * FROM posts WHERE organization_id=$1 ORDER BY scheduled_at', [orgId]);
    return res.json(postsRes.rows);
  } catch (err) {
    logger.error('Error fetching posts:', err);
    return res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/usage', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    const usageRes = await pool.query(
      'SELECT month, tokens_used, images_generated FROM organization_usage WHERE organization_id=$1 ORDER BY month DESC LIMIT 1',
      [orgId]
    );
    return res.json(usageRes.rows[0] || { tokens_used: 0, images_generated: 0 });
  } catch (err) {
    logger.error('Error fetching usage:', err);
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

app.post('/api/schedule', authenticate, async (req, res) => {
  const { postId, publishAt } = req.body;
  if (!postId || !publishAt) {
    return res.status(400).json({ error: 'postId and publishAt are required' });
  }
  try {
    await pool.query(
      'UPDATE posts SET scheduled_at=$1, status=$2 WHERE id=$3 AND organization_id=(SELECT organization_id FROM users WHERE id=$4)',
      [new Date(publishAt), 'scheduled', postId, req.userId]
    );
    return res.json({ message: 'Post scheduled' });
  } catch (err) {
    logger.error('Error scheduling post:', err);
    return res.status(500).json({ error: 'Failed to schedule post' });
  }
});

app.post('/api/publish-scheduled', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE posts
       SET status='published'
       WHERE status='scheduled' AND scheduled_at <= NOW() AND organization_id=(SELECT organization_id FROM users WHERE id=$1)
       RETURNING *`,
      [req.userId]
    );
    return res.json({ published: result.rows.length });
  } catch (err) {
    logger.error('Error publishing scheduled posts:', err);
    return res.status(500).json({ error: 'Failed to publish scheduled posts' });
  }
});

app.get('/health', (req, res) => {
  return res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

applySchema().then(() => {
  // Start a simple scheduler to publish scheduled posts automatically.
  async function publishScheduledPosts() {
    try {
      const result = await pool.query(
        `UPDATE posts SET status='published'
         WHERE status='scheduled' AND scheduled_at <= NOW() RETURNING id`
      );
      if (result.rowCount > 0) {
        logger.info(`Scheduler published ${result.rowCount} posts`);
      }
    } catch (err) {
      logger.error('Scheduler error publishing posts:', err);
    }
  }
  // Run scheduler every minute
  setInterval(publishScheduledPosts, 60 * 1000);
  // Always listen on port 8880. Railway meta-edge proxies use port 8880 for HTTP services.
  const port = 8880;
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });
});

module.exports = app;