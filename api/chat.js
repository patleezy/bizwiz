export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'];
    if (body.model && !ALLOWED_MODELS.includes(body.model)) {
      return res.status(400).json({ type: 'error', error: { type: 'invalid_request', message: 'Invalid model' } });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({ type: 'error', error: { type: 'invalid_request', message: 'messages must be a non-empty array' } });
    }
    if (body.max_tokens && (typeof body.max_tokens !== 'number' || body.max_tokens > 4096)) {
      return res.status(400).json({ type: 'error', error: { type: 'invalid_request', message: 'max_tokens must be a number ≤ 4096' } });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Forward the exact status + body from Anthropic
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('BizWiz API error:', err);
    return res.status(500).json({
      type: 'error',
      error: { type: 'server_error', message: err.message }
    });
  }
}
