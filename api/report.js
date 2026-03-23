export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!anthropicKey) return res.status(500).json({ type: 'error', error: { message: 'ANTHROPIC_API_KEY not configured' } });
  if (!tavilyKey) return res.status(500).json({ type: 'error', error: { message: 'TAVILY_API_KEY not configured' } });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { company, industry, focus, firm, ctx } = body;

    if (!focus) return res.status(400).json({ type: 'error', error: { message: 'Missing report focus' } });

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

    // ── STEP 3: BUILD CLAUDE PROMPT ──────────────────────────────
    const marketIntel = searchContext.length > 0
      ? `\n\nREAL-TIME MARKET INTELLIGENCE (use this to ground your analysis):\n${searchContext.join('\n\n')}`
      : '';

    const prompt = `You are a ${firm || 'McKinsey'} Senior Partner. Generate a focused strategy report on: "${focus}".
${ctx ? 'Client context: ' + ctx : ''}${marketIntel}

Use EXACTLY these 5 section headers on their own lines, nothing else before them:

EXECUTIVE SUMMARY
KEY FINDINGS
STRATEGIC RECOMMENDATIONS
NEXT STEPS
ELI5 SUMMARY

Keep each section tight and punchy. EXECUTIVE SUMMARY: 3–4 sentences. KEY FINDINGS: 3–4 specific bullet points grounded in the market data above. STRATEGIC RECOMMENDATIONS: 3–4 specific actionable recommendations. NEXT STEPS: specific 30/60/90-day actions. ELI5 SUMMARY: 3 plain sentences. Use **bold** for key terms. Where relevant, reference specific data points from the market intelligence.`;

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
        max_tokens: 1500,
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

    // ── STEP 5: RETURN TEXT + SOURCES ────────────────────────────
    return res.status(200).json({ text, sources: uniqueSources });

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
