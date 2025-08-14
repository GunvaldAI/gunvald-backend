/*
 * Express router for managing user profiles.  This module defines
 * REST endpoints for creating, retrieving and updating profiles
 * associated with Clerk users.  It expects a PostgreSQL client
 * exposed via `db.query` and should be mounted under `/api`.
 *
 * Each profile record contains the user’s Clerk ID and various
 * fields describing their business, target audience, tone of
 * voice, and social media channels.  Images may be stored as
 * URLs (e.g. uploaded via a separate endpoint).
 */

const express = require('express');

/**
 * Create a new router for profile CRUD operations.
 *
 * @param {object} db A database client exposing a `query` method.
 * @returns {express.Router}
 */
module.exports = function createProfilesRouter(db) {
  const router = express.Router();

  // GET /profiles/:clerkId – Retrieve a single profile by Clerk ID
  router.get('/profiles/:clerkId', async (req, res) => {
    const { clerkId } = req.params;
    try {
      const { rows } = await db.query('SELECT * FROM profiles WHERE clerk_id = $1', [clerkId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Error fetching profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // POST /profiles – Create a new profile
  router.post('/profiles', async (req, res) => {
    const {
      clerk_id,
      company_name,
      description,
      target_audience,
      tone_of_voice,
      social_channels,
      images,
    } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO profiles
         (clerk_id, company_name, description, target_audience, tone_of_voice, social_channels, images)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          clerk_id,
          company_name,
          description,
          target_audience,
          tone_of_voice,
          social_channels,
          images,
        ],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Error creating profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // PUT /profiles/:clerkId – Update an existing profile
  router.put('/profiles/:clerkId', async (req, res) => {
    const { clerkId } = req.params;
    const {
      company_name,
      description,
      target_audience,
      tone_of_voice,
      social_channels,
      images,
    } = req.body;
    try {
      const { rows } = await db.query(
        `UPDATE profiles
         SET company_name = $1,
             description = $2,
             target_audience = $3,
             tone_of_voice = $4,
             social_channels = $5,
             images = $6
         WHERE clerk_id = $7
         RETURNING *`,
        [
          company_name,
          description,
          target_audience,
          tone_of_voice,
          social_channels,
          images,
          clerkId,
        ],
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Error updating profile:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
};