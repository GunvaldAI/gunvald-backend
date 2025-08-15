// AI image generation helper for Gunvald backend
//
// This module exports a single function generateImages that accepts an
// array of text prompts and uses the OpenAI Images API (DALL·E) to
// generate a single image for each prompt.  The returned value is an
// array of URLs pointing to the generated images.  The OpenAI API key
// must be provided via the OPENAI_API_KEY environment variable.

/**
 * Generate images from an array of prompts using OpenAI's image
 * generation API.  Each prompt results in a separate API call to
 * generate one 1024×1024 image.  If the API returns an error for a
 * specific prompt, that entry in the returned array will be null.
 *
 * @param {string[]} prompts - Array of textual prompts to generate images for.
 * @returns {Promise<(string|null)[]>} Array of image URLs (or null if generation failed)
 */
async function generateImages(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts must be a non-empty array');
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  const results = [];
  for (const prompt of prompts) {
    try {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          n: 1,
          size: '1024x1024',
          response_format: 'url',
          // DALL·E 3 is the default model for the images endpoint as of 2025
        }),
      });
      if (!response.ok) {
        // If the API returns an error, capture the message for debugging
        const errText = await response.text();
        console.error('OpenAI image generation error:', errText);
        results.push(null);
        continue;
      }
      const json = await response.json();
      if (json && Array.isArray(json.data) && json.data[0]?.url) {
        results.push(json.data[0].url);
      } else {
        results.push(null);
      }
    } catch (err) {
      console.error('Error calling OpenAI image API:', err);
      results.push(null);
    }
  }
  return results;
}

module.exports = { generateImages };