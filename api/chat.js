// Simple in-memory rate limiter (per serverless instance; 20 req/min per IP)
const _rl = new Map();
function rateLimit(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const e = _rl.get(ip) || { n: 0, reset: now + windowMs };
  if (now > e.reset) { e.n = 0; e.reset = now + windowMs; }
  e.n++;
  _rl.set(ip, e);
  if (_rl.size > 2000) { // Prevent unbounded growth
    for (const [k, v] of _rl) { if (now > v.reset) _rl.delete(k); }
  }
  return e.n <= max;
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip, 20)) {
    return res.status(429).json({ type: 'error', error: { type: 'rate_limit', message: 'Too many requests — please wait a moment.' } });
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

    // Always stream — forward Anthropic's SSE directly to the client
    const upstreamResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!upstreamResp.ok) {
      const errData = await upstreamResp.json();
      return res.status(upstreamResp.status).json(errData);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstreamResp.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();

  } catch (err) {
    console.error('BizWiz API error:', err);
    // Only send JSON error if headers haven't been flushed yet
    if (!res.headersSent) {
      return res.status(500).json({
        type: 'error',
        error: { type: 'server_error', message: err.message }
      });
    }
    res.end();
  }
}
