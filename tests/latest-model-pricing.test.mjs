import assert from 'node:assert/strict';
import test from 'node:test';
import { CLAUDE_PRICING, PRICING, createPricing, matchPricingRule } from '../server/pricing.mjs';
import { calculateCost, buildDashboardPayload } from '../server/dashboard-data.mjs';
import { pricingBasis, pricingFromBasis, pricingRevision } from '../server/pricing-basis.mjs';
import { parseClaudePricingMarkdown } from '../server/claude-pricing-refresh.mjs';
import { zeroUsage } from '../server/usage.mjs';

const event = (inputTokens) => ({ model: 'claude-haiku-5-5-20261001', timestamp: '2026-10-14T00:00:00Z', pricingModifiers: { inferenceGeo: 'global', speed: 'standard', serviceTier: 'standard' }, usage: { ...zeroUsage(), inputTokens, uncachedInputTokens: inputTokens, outputTokens: 1000, totalTokens: inputTokens + 1000 } });

test('latest model identities and cache prices match the retained official table', () => {
  assert.equal(matchPricingRule(PRICING, 'gpt-6.1-sol').rates.cachedInput, 0.1);
  assert.equal(matchPricingRule(PRICING, 'gpt-6-astra').rates.output, 50);
  assert.equal(matchPricingRule(CLAUDE_PRICING, 'claude-opus-5-5').rates.cachedInput, 0.2);
  assert.equal(matchPricingRule(CLAUDE_PRICING, 'claude-fable-5.1').rates.cachedInput, 0.25);
});

test('Haiku 5.5 uses the 100000-input-token boundary and preserves tiered archive identity', () => {
  const short = calculateCost(CLAUDE_PRICING, [event(100000)]);
  const long = calculateCost(CLAUDE_PRICING, [event(100001)]);
  assert.ok(Math.abs(short.total - 0.0105) < 1e-12);
  assert.ok(Math.abs(long.total - 0.0525005) < 1e-12);
  const basis = pricingBasis(CLAUDE_PRICING);
  assert.equal(pricingRevision(pricingFromBasis(basis)), pricingRevision(CLAUDE_PRICING));
  const changed = structuredClone(basis); changed.rules.find(rule => rule.id === 'claude-haiku-5.5').rates.contextTier.rates.output = 3;
  assert.notEqual(pricingRevision(pricingFromBasis(changed)), pricingRevision(CLAUDE_PRICING));
  assert.throws(() => createPricing({ ...basis, rules: [{ ...basis.rules[0], rates: { ...basis.rules[0].rates, contextTier: { aboveInputTokens: -1, rates: {} } } }] }), /context tier/);
  const summary = { provider: 'claude', pricing: CLAUDE_PRICING, errors: [], sessions: [{ sessionKey: 'tier', sessionId: 'tier', model: 'claude-haiku-5.5', reconciliation: {}, invalidLineCount: 0, usageEvents: [event(100001)] }] };
  const payload = buildDashboardPayload(summary, { range: { mode: 'all', timezone: 'UTC', fromMs: null, toMs: null }, q: '', sort: 'recent', offset: 0, limit: 100, filters: { models: [], workspaces: [], pricingStatus: [], usageSource: [], cliVersion: [], originator: [], executionType: [], quality: [] } }, {});
  assert.equal(payload.cost.total, long.total);
  assert.equal(payload.trend.points[0].cost, long.total);
  assert.equal(payload.models[0].cost, long.total);
});

test('current Claude markdown footnotes and tier rows parse without accepting duplicate base rows', () => {
  const header = '| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |\n|---|---|---|---|---|---|';
  const rows = ['Claude Fable 5.1', 'Claude Mythos 5.1', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Opus 5', 'Claude Sonnet 5', 'Claude Haiku 4.5'].map(name => `| ${name} | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok<sup>2</sup> | $10 / MTok |`);
  rows.push('| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |', '| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |');
  const markdown = header + '\n' + rows.join('\n');
  const rates = parseClaudePricingMarkdown(markdown);
  assert.equal(rates['claude-opus-5.5'].cachedInput, 0.1);
  assert.equal(rates['claude-haiku-5.5'].contextTier.rates.output, 2.5);
  assert.throws(() => parseClaudePricingMarkdown(markdown + '\n' + rows[0]), /Duplicate/);
});
