export async function syncClerkAllowedOrigins() {
  try {
    const secret = process.env.CLERK_SECRET_KEY;
    const apiUrl = process.env.CLERK_API_URL || 'https://api.clerk.com';
    const raw = (process.env.CLERK_ALLOWED_ORIGINS || '').trim();

    if (!secret) {
      console.warn('[clerk] CLERK_SECRET_KEY missing; skip allowed_origins sync');
      return;
    }
    if (!raw) {
      console.warn('[clerk] CLERK_ALLOWED_ORIGINS empty; skip allowed_origins sync');
      return;
    }

    const allowed = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const res = await fetch(`${apiUrl}/v1/instance`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowed_origins: allowed }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[clerk] Failed to PATCH allowed_origins', res.status, text);
      return;
    }

    console.log('[clerk] allowed_origins synced:', allowed.join(', '));
  } catch (err) {
    console.error('[clerk] allowed_origins sync error', err);
  }
}