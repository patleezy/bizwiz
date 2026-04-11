import { describe, it, expect } from 'vitest';
import { buildQueries, parseReportJSON } from './report.js';

// ── buildQueries ───────────────────────────────────────────────

describe('buildQueries', () => {
  const YEAR = 2026;

  it('returns 1 query when no industry and no company', () => {
    const q = buildQueries(null, null, 'Growth Strategy', YEAR);
    expect(q).toHaveLength(1);
    expect(q[0]).toBe('Growth Strategy strategy trends 2026');
  });

  it('uses industry in primary query when provided', () => {
    const q = buildQueries(null, 'SaaS', 'Pricing', YEAR);
    expect(q[0]).toBe('Pricing SaaS trends 2026');
  });

  it('returns up to 3 queries with company + industry', () => {
    const q = buildQueries('Acme Corp', 'Manufacturing', 'Supply Chain', YEAR);
    expect(q).toHaveLength(3);
    expect(q[0]).toBe('Supply Chain Manufacturing trends 2026');
    expect(q[1]).toBe('Acme Corp supply chain competitive landscape');
    expect(q[2]).toBe('Manufacturing market outlook 2026');
  });

  it('treats "Your Company" as no company name', () => {
    const q = buildQueries('Your Company', 'Retail', 'Expansion', YEAR);
    // no company-specific query — secondary uses industry fallback
    expect(q.some(x => x.includes('Your Company'))).toBe(false);
    expect(q[1]).toBe('Retail expansion market analysis 2026');
  });

  it('lowercases focus in the secondary query', () => {
    const q = buildQueries('Wonka Co', 'Consumer Goods', 'BRAND GROWTH', YEAR);
    expect(q[1]).toContain('brand growth');
  });

  it('never exceeds 3 queries', () => {
    const q = buildQueries('Co', 'Industry', 'Focus', YEAR);
    expect(q.length).toBeLessThanOrEqual(3);
  });

  it('returns 3 queries with industry but no company', () => {
    const q = buildQueries(null, 'Fintech', 'Risk Management', YEAR);
    // primary + secondary (industry fallback) + tertiary (market outlook)
    expect(q).toHaveLength(3);
    expect(q[0]).toBe('Risk Management Fintech trends 2026');
    expect(q[1]).toBe('Fintech risk management market analysis 2026');
    expect(q[2]).toBe('Fintech market outlook 2026');
  });
});

// ── parseReportJSON ────────────────────────────────────────────

describe('parseReportJSON', () => {
  const VALID = {
    executive_summary: 'Summary text',
    key_findings: '- Finding 1\n- Finding 2',
    strategic_recommendations: '- Rec 1',
    next_steps: '- 30 days: do X',
    eli5_summary: 'Plain English here',
  };

  it('parses clean JSON string', () => {
    const result = parseReportJSON(JSON.stringify(VALID));
    expect(result).toEqual(VALID);
  });

  it('strips leading/trailing markdown code fences', () => {
    const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
    expect(parseReportJSON(fenced)).toEqual(VALID);
  });

  it('strips plain ``` code fences', () => {
    const fenced = '```\n' + JSON.stringify(VALID) + '\n```';
    expect(parseReportJSON(fenced)).toEqual(VALID);
  });

  it('returns null for invalid JSON', () => {
    expect(parseReportJSON('not json at all')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseReportJSON('')).toBeNull();
  });

  it('returns null for partial/truncated JSON', () => {
    expect(parseReportJSON('{"executive_summary": "truncated')).toBeNull();
  });
});
