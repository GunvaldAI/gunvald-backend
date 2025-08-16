// Modified AI helper with code fence stripping
// This file is based on the original src/ai.js but includes logic to strip
// triple backtick code fences (e.g. ```json ... ```) before attempting to
// parse the AI-generated JSON. Without this, the backend would return a
// stringified JSON array wrapped in markdown, which breaks the frontend.

// Dynamically import a fetch implementation. Node.js 18+ has a global
// fetch function; if not available, fall back to the `node-fetch` package.
let fetchFn;
try {
  fetchFn = global.fetch || require('node-fetch');
} catch (_) {
  fetchFn = global.fetch;
}

/**
 * Helper to initialize OpenAI client.  The API key must be provided via
 * the OPENAI_API_KEY environment variable.  You can optionally set
 * OPENAI_MODEL (e.g. 'gpt-4o') to override the default model.
 */
// We intentionally avoid depending on the OpenAI SDK to reduce external
// dependencies. Instead, we will call the OpenAI REST API directly using
// fetchFn. Ensure OPENAI_API_KEY is set in your environment.

/**
 * Generates a list of social media post suggestions based on the given
 * profile information.  The returned array contains objects with
 * `text`, `hashtags` and optional `imagePrompt` properties.  The
 * underlying implementation uses the OpenAI Chat Completion API to
 * synthesize content.  You should set the OPENAI_API_KEY in your
 * environment for this to work.  If no API key is provided, an
 * error will be thrown at runtime.
 *
 * @param {Object} profile - The user's profile including company_name,
 *   description, target_audience, tone_of_voice, marketing_goals,
 *   content_themes and social_channels.
 * @param {number} count - Number of posts to generate (1–10 recommended).
 * @returns {Promise<Array<{text: string, hashtags: string[], imagePrompt?:
 * string}>>}
 */
async function generatePlan(profile, count = 5) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const {
    company_name,
    description,
    target_audience,
    tone_of_voice,
    marketing_goals,
    content_themes,
    social_channels,
  } = profile;

  // Build a detailed prompt for the assistant.  We request the model to
  // return a JSON array for easier parsing on the backend.  Each post
  // includes a short text (max ~400 characters), a list of hashtags, and
  // an optional image prompt that could be passed to a separate image
  // generator (e.g. DALL·E) later on.
  const prompt = [
    `Yrityksen nimi: ${company_name || ''}`,
    `Kuvaus: ${description || ''}`,
    `Kohdeyleisö: ${target_audience || ''}`,
    `Äänen sävy: ${tone_of_voice || ''}`,
    marketing_goals ? `Markkinointitavoitteet: ${marketing_goals}` : '',
    content_themes ? `Sisällön teemat: ${content_themes}` : '',
    social_channels && social_channels.length
      ? `Sosiaalisen median kanavat: ${social_channels.join(', ')}`
      : '',
    '',
    `Luo seuraavaksi ${count} eri somepostausta tälle yritykselle seuraavaksi kuukaudeksi.`,
    'Kunkin postauksen tulee noudattaa yrityksen äänen sävyä ja puhuttua kohdeyleisöä.',
    'Käytä markkinointitavoitteita ja sisältöteemoja inspiraationa.',
    'Palauta tulos täsmälleen JSON-taulukkona, jossa jokainen alkio on objekti muotoa:',
    '{ "text": "...postauksen teksti...", "hashtags": ["#hashtag1", "#hashtag2"], "imagePrompt": "...kuvaprompti..." }',
    'Älä selitä mitään muuta, äläkä sisällytä muuta tekstiä JSON:in ulkopuolelle.',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'Olet luova markkinointikonsultti, joka laatii suomenkielisiä sosiaalisen median postauksia pienyrityksille.',
    },
    { role: 'user', content: prompt },
  ];

  // Prepare request payload for OpenAI's chat completion API.  Use
  // temperature and max_tokens settings similar to the SDK call above.
  const body = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1500,
  };
  // Call the OpenAI API directly using fetchFn. Handle error responses
  // explicitly by throwing an error with status and message.
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  let raw = data.choices?.[0]?.message?.content?.trim() || '';
  // Strip Markdown code fences if the AI includes them (e.g. ```json ... ```)
  if (raw.startsWith('```')) {
    // Remove opening fence with optional "json" label and trailing fence
    raw = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }
  let posts;
  try {
    posts = JSON.parse(raw);
  } catch (err) {
    // If the model returns something unexpected, wrap it as a single post.
    posts = [{ text: raw, hashtags: [] }];
  }
  // Normalize posts to ensure consistent structure.
  return posts.map((p) => ({
    text: p.text || '',
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    imagePrompt: p.imagePrompt || undefined,
  }));
}

module.exports = { generatePlan };