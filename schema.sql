-- SQL schema for Gunvald backend

-- Users table stores login credentials. The email column is unique.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Organizations represent businesses or teams. Each user belongs to a single organization.
CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add an optional organization_id column to users for multi-tenancy.
ALTER TABLE IF EXISTS users
ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

-- Brand profile contains branding settings for an organization.
CREATE TABLE IF NOT EXISTS brand_profiles (
    id SERIAL PRIMARY KEY,
    organization_id INT UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    company_name TEXT,
    industry TEXT,
    target_audience TEXT,
    tone TEXT,
    brand_colors TEXT,
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Channels represent external social media channels (Facebook, Instagram, TikTok, etc.).
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    access_token TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Posts table to store drafted or published social media posts.
CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    text TEXT,
    hashtags TEXT[],
    image_url TEXT,
    status TEXT DEFAULT 'draft', -- 'draft' or 'published'
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Assets table to store uploaded images or other media assets.
CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    type TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Usage table to track per-organization usage of tokens and images per month. Helps with cost control.
CREATE TABLE IF NOT EXISTS organization_usage (
    id SERIAL PRIMARY KEY,
    organization_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    tokens_used INT DEFAULT 0,
    images_generated INT DEFAULT 0,
    UNIQUE (organization_id, month)
);

-- Moderation flags for posts containing prohibited content.
CREATE TABLE IF NOT EXISTS moderation_flags (
    id SERIAL PRIMARY KEY,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Profiles table stores business profiles. Each user can have at most
-- one profile, enforced by the unique constraint on user_id.
CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    company_description TEXT,
    content_preferences TEXT,
    team_info TEXT,
    target_audience TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Profile images table stores file names of uploaded images. Each row
-- references the profile it belongs to.
CREATE TABLE IF NOT EXISTS profile_images (
    id SERIAL PRIMARY KEY,
    profile_id INT REFERENCES profiles(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL
);