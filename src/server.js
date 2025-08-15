// Gunvald profile backend (CommonJS version) with default port 8880
// This Express server exposes API endpoints for user registration,
// authentication, profile management, brand profiles, content generation
// and scheduling. It uses PostgreSQL for data storage and JWT for
// authentication. It also applies the database schema on startup using
// a local schema.sql file.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

// Import Sentry for observability and tracing
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');

// Import Clerk middleware for authentication via Clerk sessions
const { ClerkExpressWithAuth } = require('@clerk/clerk-sdk-node');
const { syncClerkAllowedOrigins } = require('./utils/clerkAllowedOrigins.js');
const fs = require('fs');
const path = require('path');

// Import AI helper for content generation
const { generatePlan } = require('./ai');

// Import Profiles router for Clerk-based profile CRUD operations.  This
// router handles profiles keyed by Clerk ID and exposes GET, POST and
// PUT endpoints under /api/profiles.  See src/profiles.js for the
// implementation details.
const createProfilesRouter = require('./profiles');

// Read environment variables for database connection and JWT secret.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Initialize Sentry for error and performance monitoring. Use environment
// variables for configuration. The DSN should be set in Railway or the
// environment to enable event delivery. The Http integration captures
// outbound requests and tracing information. We do not specify an
// Express integration here to avoid referencing the app before it is
// created.
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'development',
  integrations: [new Sentry.Integrations.Http({ tracing: true })],
  // Adjust this value in production. A value of 1.0 will capture all
  // transactions; decrease to reduce data volume.
  tracesSampleRate: 1.0,
});

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
// Run Clerk allowed origins synchronization on startup
syncClerkAllowedOrigins();
app.use(cors());
app.use(bodyParser.json());

// Register Sentry request and tracing handlers before other middlewares.
// These handlers create a Sentry transaction for each incoming request
// and attach helpful context for debugging.
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Apply Clerk middleware to attach `auth` information to each request.
// This will populate `req.auth.userId` when a valid Clerk session token is
// provided.
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
      `[${reqId}] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Auth middleware.  If Clerk has authenticated the request then use
// the Clerk userId.  Otherwise fall back to verifying our own JWT.
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

// Instantiate and mount the profiles router for Clerk-based profile CRUD.
// Mounting under "/api" means that the routes defined in profiles.js
// (e.g. GET /profiles/:clerkId) will be served at /api/profiles/:clerkId.
const profilesRouter = createProfilesRouter(pool);
app.use('/api', authenticate, profilesRouter);

// Ensure user belongs to an organization; create if missing
async function ensureOrganization(userId, name) {
  const orgRes = await pool.query(
    'SELECT organization_id FROM users WHERE id=$1',
    [userId],
  );
  let orgId = orgRes.rows[0]?.organization_id;
  if (!orgId) {
    const createOrg = await pool.query(
      'INSERT INTO organizations (name, created_at) VALUES ($1, NOW()) RETURNING id',
      [name || 'Unnamed'],
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
      [email, passwordHash],
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
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (userRes.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const user = userRes.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, organizationId: user.organization_id }, JWT_SECRET);
    return res.json({ token });
  } catch (err) {
    logger.error('Login error:', err);
    return res.status(400).json({ error: 'Invalid credentials' });
  }
});

// --- PROFILE ROUTES ---
// These legacy routes store profiles keyed by internal user ID. They are
// retained for backwards compatibility but not used by the new frontend.
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
      [req.userId, company_description, content_preferences, team_info, target_audience],
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
      pool.query('INSERT INTO profile_images (profile_id, image_url) VALUES ($1, $2)', [profileId, file.filename]),
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
    const imagesRes = await pool.query('SELECT image_url FROM profile_images WHERE profile_id = $1', [profile.id]);
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
      [orgId, company_name, industry, target_audience, tone, brand_colors, logo_url],
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
  // Default to 5 posts; clamp the count between 1 and 10 to avoid excessive generation.
  const postCount = count && Number(count) > 0 ? Math.min(Number(count), 10) : 5;
  try {
    // Determine the organization for the current user.
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization not found' });
    }

    // Fetch the user's profile to inform content generation.  If no profile
    // exists, return an error.  The query maps company_description to
    // description to align with the AI helper input.
    const profRes = await pool.query(
      `SELECT company_name,
              company_description AS description,
              target_audience,
              tone_of_voice,
              marketing_goals,
              content_themes,
              social_channels
         FROM profiles
        WHERE user_id = $1`,
      [req.userId],
    );
    const profile = profRes.rows[0];
    if (!profile) {
      return res.status(400).json({ error: 'Profile not found' });
    }

    // Use the AI helper to asynchronously generate raw post suggestions (text + hashtags).
    const generated = await generatePlan(profile, postCount);
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
        [post.organization_id, post.text, post.hashtags, post.scheduled_at, post.flagged, post.status],
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
      [orgId],
    );
    return res.json(usageRes.rows[0] || { tokens_used: 0, images_generated: 0 });
  } catch (err) {
    logger.error('Error fetching usage:', err);
    return res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// --- ANALYTICS ROUTES ---
// Returns weekly post counts for the authenticated organization. Each record
// contains the week start date (ISO string) and the number of posts scheduled
// or published in that week.
app.get('/api/stats/posts', authenticate, async (req, res) => {
  try {
    // Determine the organization for the current user
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    // Aggregate posts by ISO week (starting Monday)
    const statsRes = await pool.query(
      `SELECT to_char(date_trunc('week', scheduled_at), 'YYYY-MM-DD') AS week_start,
                   COUNT(*) AS post_count
            FROM posts
            WHERE organization_id=$1
            GROUP BY week_start
            ORDER BY week_start DESC
            LIMIT 6`,
      [orgId],
    );
    return res.json(statsRes.rows);
  } catch (err) {
    logger.error('Error fetching post stats:', err);
    return res.status(500).json({ error: 'Failed to fetch post statistics' });
  }
});

// Returns counts of posts by status (draft, scheduled, published) for the
// authenticated organization.
app.get('/api/stats/status', authenticate, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT organization_id FROM users WHERE id=$1', [req.userId]);
    const orgId = userRes.rows[0]?.organization_id;
    if (!orgId) return res.status(400).json({ error: 'Organization not found' });
    const resCounts = await pool.query(
      `SELECT status, COUNT(*) AS count
            FROM posts
            WHERE organization_id=$1
            GROUP BY status`,
      [orgId],
    );
    // Convert array of rows to an object keyed by status
    const counts = resCounts.rows.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});
    return res.json(counts);
  } catch (err) {
    logger.error('Error fetching status stats:', err);
    return res.status(500).json({ error: 'Failed to fetch status statistics' });
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
      [new Date(publishAt), 'scheduled', postId, req.userId],
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
      [req.userId],
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

// Capture any errors that have not been handled by previous middleware.
// This should be registered after all route definitions so that Sentry
// receives information about thrown exceptions.
app.use(Sentry.Handlers.errorHandler());

applySchema().then(() => {
  // Start a simple scheduler to publish scheduled posts automatically.
  async function publishScheduledPosts() {
    try {
      const result = await pool.query(
        `UPDATE posts SET status='published'
              WHERE status='scheduled' AND scheduled_at <= NOW() RETURNING id`,
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