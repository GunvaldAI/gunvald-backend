// ai.js
// Simple AI content generation module for Gunvald
// This module exports a function `generatePlan` which creates a list of post
// objects based on the provided brand profile. Each post contains a text
// suggestion and a list of hashtags derived from the brand's industry.

/**
 * Generates a weekly content plan based on the brand profile.
 *
 * @param {Object} brand - The brand profile with company_name, industry,
 *   target_audience, tone and other optional fields.
 * @param {number} postCount - The number of posts to generate (default 5).
 * @returns {Array} Array of objects with `text` and `hashtags` fields.
 */
function generatePlan(brand, postCount = 5) {
  const posts = [];
  // Normalize the industry to create a tag (remove spaces and special chars)
  const industryTag = brand.industry
    ? String(brand.industry).toLowerCase().replace(/\s+/g, '')
    : 'brand';

  for (let i = 0; i < postCount; i++) {
    // Compose a simple post using brand information. If tone is provided,
    // include it as part of the message for stylistic guidance.
    const toneSegment = brand.tone ? ` Tyylimme: ${brand.tone}.` : '';
    const text = `Hei ${brand.company_name || 'yritys'}! Tässä ${brand.industry || ''} vinkki numero ${i + 1}.${toneSegment}`.trim();
    const hashtags = [`#${industryTag}`, '#vinkki'];
    posts.push({ text, hashtags });
  }
  return posts;
}

module.exports = { generatePlan };
