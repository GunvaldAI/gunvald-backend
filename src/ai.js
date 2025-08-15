const { Configuration, OpenAIApi } = require('openai');

/**
 * Helper to initialize OpenAI client.  The API key must be provided via
 * the OPENAI_API_KEY environment variable.  You can optionally set
 * OPENAI_MODEL (e.g. 'gpt-4o') to override the default model.
 */
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

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
 * @returns {Promise<Array<{text: string, hashtags: string[], imagePrompt?: string}>>}
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

  const response = await openai.createChatCompletion({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1500,
  });

  const raw = response.data.choices?.[0]?.message?.content?.trim() || '';
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