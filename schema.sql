-- SQL schema for Gunvald backend

-- Users table stores login credentials. The email column is unique.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
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