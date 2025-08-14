/*
 * Express router for managing user profiles.  This module defines
 * REST endpoints for creating, retrieving and updating profiles
 * associated with Clerk users.  It expects a PostgreSQL client
 * exposed via `db.query` and should be mounted under `/profiles`.
 *
 * Each profile record contains the user’s Clerk ID and various
 * fields describing their business, target audience, tone of
 * voice, and social media channels.  Images may be stored as
 * base64 strings or URLs.
 */
const express = require('express');

module.exports = function createProfilesRouter(db) {
  const router = express.Router();

  // Ensure the profiles table has the extended Clerk fields.  This
  // ALTER TABLE statement is idempotent: if the columns already exist,
  // PostgreSQL will ignore the additions.  We run this asynchronously
  // on router creation so that the application can continue starting.
  (async () => {
    try {
      await db.query(`
        ALTER TABLE IF EXISTS profiles
          ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE,
          ADD COLUMN IF NOT EXISTS company_name TEXT,
          ADD COLUMN IF NOT EXISTS tone_of_voice TEXT,
          ADD COLUMN IF NOT EXISTS social_channels TEXT[],
          ADD COLUMN IF NOT EXISTS images TEXT[];
      `);
    } catch (err) {
      console.error('Error altering profiles table:', err);
    }
  })();

  // GET /profiles/:clerkId – Retrieve a single profile by Clerk ID.  We select
  // the extended columns and alias legacy columns (company_description,
  // content_preferences) to more intuitive names.  If no record exists,
  // return 404.
  router.get('/profiles/:clerkId', async (req, res) => {
    const { clerkId } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT clerk_id,
                company_name,
                company_description AS description,
                target_audience,
                tone_of_voice,
                social_channels,
                images,
                content_preferences AS content_themes
           FROM profiles
           WHERE clerk_id = $1`,
        [clerkId],
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Error fetching profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // POST /profiles – Create or update a profile.  We perform an upsert on
  // clerk_id so that repeated calls overwrite existing values.  The
  // description field maps to company_description and content_themes
  // maps to content_preferences.  After insertion or update, we
  // return the unified representation used by the frontend.
  router.post('/profiles', async (req, res) => {
    const {
      clerk_id,
      company_name,
      description,
      target_audience,
      tone_of_voice,
      social_channels,
      images,
      content_themes,
    } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO profiles
         (clerk_id, company_name, company_description, target_audience, tone_of_voice, social_channels, images, content_preferences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (clerk_id) DO UPDATE
           SET company_name = EXCLUDED.company_name,
               company_description = EXCLUDED.company_description,
               target_audience = EXCLUDED.target_audience,
               tone_of_voice = EXCLUDED.tone_of_voice,
               social_channels = EXCLUDED.social_channels,
               images = EXCLUDED.images,
               content_preferences = EXCLUDED.content_preferences
         RETURNING clerk_id, company_name, company_description AS description, target_audience,
                  tone_of_voice, social_channels, images, content_preferences AS content_themes`,
        [
          clerk_id,
          company_name,
          description,
          target_audience,
          tone_of_voice,
          social_channels,
          images,
          content_themes,
        ],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Error creating/updating profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // PUT /profiles/:clerkId – Upsert a profile by Clerk ID.  This mirrors
  // the behaviour of POST but uses the path parameter instead of
  // requiring the clerk_id in the request body.  The same upsert
  // semantics apply.
  router.put('/profiles/:clerkId', async (req, res) => {
    const { clerkId } = req.params;
    const {
      company_name,
      description,
      target_audience,
      tone_of_voice,
      social_channels,
      images,
      content_themes,
    } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO profiles
         (clerk_id, company_name, company_description, target_audience, tone_of_voice, social_channels, images, content_preferences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (clerk_id) DO UPDATE
           SET company_name = EXCLUDED.company_name,
               company_description = EXCLUDED.company_description,
               target_audience = EXCLUDED.target_audience,
               tone_of_voice = EXCLUDED.tone_of_voice,
               social_channels = EXCLUDED.social_channels,
               images = EXCLUDED.images,
               content_preferences = EXCLUDED.content_preferences
         RETURNING clerk_id, company_name, company_description AS description, target_audience,
                  tone_of_voice, social_channels, images, content_preferences AS content_themes`,
        [
          clerkId,
          company_name,
          description,
          target_audience,
          tone_of_voice,
          social_channels,
          images,
          content_themes,
        ],
      );
      res.json(rows[0]);
    } catch (err) {
      console.error('Error upserting profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
};
