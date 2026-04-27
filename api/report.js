// Simple in-memory rate limiter (per serverless instance; 5 req/min per IP)
const _rl = new Map();
function rateLimit(ip, max = 5, windowMs = 60000) {
  const now = Date.now();
  const e = _rl.get(ip) || { n: 0, reset: now + windowMs };
  if (now > e.reset) { e.n = 0; e.reset = now + windowMs; }
  e.n++;
  _rl.set(ip, e);
  if (_rl.size > 2000) {
    for (const [k, v] of _rl) { if (now > v.reset) _rl.delete(k); }
  }
  return e.n <= max;
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const allowedOrigin = process.env.ALLOWED_ORIGIN || origin; // default permissive for dev
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit(ip, 5)) {
    return res.status(429).json({ type: 'error', error: { message: 'Too many requests — please wait a moment.' } });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!anthropicKey) return res.status(500).json({ type: 'error', error: { message: 'ANTHROPIC_API_KEY not configured' } });
  if (!tavilyKey) return res.status(500).json({ type: 'error', error: { message: 'TAVILY_API_KEY not configured' } });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { company, industry, focus, firm, ctx, explainFrameworks } = body;

    if (!focus) return res.status(400).json({ type: 'error', error: { message: 'Missing report focus' } });

    const VALID_FIRMS = ['McKinsey', 'Bain', 'BCG', 'Deloitte'];
    if (firm && !VALID_FIRMS.includes(firm)) {
      return res.status(400).json({ type: 'error', error: { message: 'Invalid firm value' } });
    }
    if (typeof focus === 'string' && focus.length > 500) {
      return res.status(400).json({ type: 'error', error: { message: 'Focus too long (max 500 chars)' } });
    }
    if (company && typeof company === 'string' && company.length > 200) {
      return res.status(400).json({ type: 'error', error: { message: 'Company name too long (max 200 chars)' } });
    }
    if (ctx && typeof ctx === 'string' && ctx.length > 2000) {
      return res.status(400).json({ type: 'error', error: { message: 'Context too long (max 2000 chars)' } });
    }

    const FRAMEWORK_INSTR = explainFrameworks
      ? `\n\nWhenever you mention a named consulting framework, model, or methodology, immediately follow it with a parenthetical plain-English definition in italics. Example: "BCG's Growth-Share Matrix *(a 2x2 tool that classifies products by market share and growth rate)*". One sentence max.`
      : '';

    // ── STEP 1: BUILD TAVILY SEARCH QUERIES ──────────────────────
    const year = new Date().getFullYear();
    const queries = buildQueries(company, industry, focus, year);

    // ── STEP 2: RUN TAVILY SEARCHES IN PARALLEL ──────────────────
    const searchResults = await Promise.allSettled(
      queries.map(q => tavilySearch(q, tavilyKey))
    );

    // Collect successful results + sources
    const sources = [];
    const searchContext = [];

    searchResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        const { results, query } = result.value;
        if (results && results.length > 0) {
          searchContext.push(`Search: "${query}"\n` + results.slice(0, 3).map(r =>
            `- ${r.title}: ${r.content?.slice(0, 300) || r.snippet?.slice(0, 300) || ''}`
          ).join('\n'));
          results.slice(0, 2).forEach(r => {
            if (r.url && r.title) {
              sources.push({ title: r.title, url: r.url });
            }
          });
        }
      }
    });

    // Deduplicate sources by URL
    const uniqueSources = sources.filter((s, i, arr) =>
      arr.findIndex(x => x.url === s.url) === i
    ).slice(0, 6);

    const searchSucceeded = searchResults.some(r => r.status === 'fulfilled' && r.value?.results?.length > 0);

    // ── STEP 3: BUILD CLAUDE PROMPT ──────────────────────────────
    const marketIntel = searchContext.length > 0
      ? `\n\nREAL-TIME MARKET INTELLIGENCE (use this to ground your analysis):\n${searchContext.join('\n\n')}`
      : '';

    const prompt = `You are a ${firm || 'McKinsey'} Senior Partner. Generate a focused strategy report on: "${focus}".
${ctx ? 'Client context: ' + ctx : ''}${marketIntel}

Respond with ONLY a valid JSON object — no markdown, no code fences, nothing before or after the JSON. Use exactly these keys:
{
  "executive_summary": "3–4 sentence overview",
  "key_findings": "3–4 specific bullet points (prefix each with - )",
  "strategic_recommendations": "3–4 actionable recommendations (prefix each with - )",
  "next_steps": "specific 30/60/90-day actions (prefix each with - )",
  "eli5_summary": "3 plain sentences explaining this to a 10-year-old"
}

Use **bold** for key terms. Where relevant, reference specific data points from the market intelligence.${FRAMEWORK_INSTR}`;

    // ── STEP 4: CALL CLAUDE ──────────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': anthropicKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();

    if (!claudeRes.ok || claudeData.type === 'error') {
      return res.status(claudeRes.status).json({
        type: 'error',
        error: { message: claudeData?.error?.message || `Claude error ${claudeRes.status}` }
      });
    }

    const text = claudeData.content?.[0]?.text;
    if (!text) return res.status(500).json({ type: 'error', error: { message: 'Empty response from Claude' } });

    // ── STEP 5: PARSE JSON SECTIONS + RETURN ─────────────────────
    const sections = parseReportJSON(text);

    const responsePayload = sections ? { sections, sources: uniqueSources } : { text, sources: uniqueSources };
    if (!searchSucceeded) {
      responsePayload.searchWarning = 'Live market data could not be retrieved. Report is based on model knowledge only.';
    }
    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error('BizWiz report error:', err);
    return res.status(500).json({ type: 'error', error: { message: err.message } });
  }
}

// Build targeted search queries from context
function buildQueries(company, industry, focus, year) {
  const queries = [];
  const co = company && company !== 'Your Company' ? company : null;
  const ind = industry || null;

  // Primary: focus + industry
  if (ind) {
    queries.push(`${focus} ${ind} trends ${year}`);
  } else {
    queries.push(`${focus} strategy trends ${year}`);
  }

  // Secondary: company-specific if we have a real company name
  if (co) {
    queries.push(`${co} ${focus.toLowerCase()} competitive landscape`);
  } else if (ind) {
    queries.push(`${ind} ${focus.toLowerCase()} market analysis ${year}`);
  }

  // Tertiary: broader market context
  if (ind) {
    queries.push(`${ind} market outlook ${year}`);
  }

  return queries.slice(0, 3);
}

// Tavily search helper
async function tavilySearch(query, apiKey) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 3,
      include_answer: false,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { query, results: data.results || [] };
}

// ── EXPORTED HELPERS (used by tests) ─────────────────────────
export function parseReportJSON(text) {
  try {
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(clean);
  } catch {
    console.warn('BizWiz: Claude did not return valid JSON, falling back to raw text');
    return null;
  }
}

export { buildQueries };
