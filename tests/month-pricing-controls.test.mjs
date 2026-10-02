import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQueryStateToControls, createDashboardState, normalizeMonthValue, queryStateFromSearch, queryStateToSearch, readQueryState, requestParameters } from '../public/scripts/state.mjs';
import { pricingEntries } from '../public/scripts/pricing-table.mjs';
import { allowedRequestHost } from '../server/config.mjs';

test('Safari text-month input and restored URLs use a canonical month across query boundaries', () => {
  const query = { ...createDashboardState().query, monthValue: '2026-9' };
  const fields = { rangeMode: 'month', weekInput: '', monthInput: '2026-9', yearInput: '2026', customStart: '', customEnd: '', search: '', sort: 'recent', timezone: 'Asia/Taipei' };
  const controls = Object.fromEntries(Object.entries(fields).map(([id, value]) => [id, { value, dataset: {} }]));
  assert.equal(readQueryState(controls).monthValue, '2026-09');
  assert.equal(queryStateFromSearch(query, '?range=month&month=2026-9').monthValue, '2026-09');
  assert.equal(new URLSearchParams(queryStateToSearch(query)).get('month'), '2026-09');
  assert.equal(requestParameters(query).get('period'), '2026-09');
  applyQueryStateToControls(controls, query); assert.equal(controls.monthInput.value, '2026-09');
  for (const value of ['2026-0', '2026-13', '2026-009', '0000-9', '2026-', 'text']) assert.equal(normalizeMonthValue(value), value);
});

test('price search keeps exact rates and sorts higher numeric versions within each naming family', () => {
  const rates = { 'gpt-5.6-sol': { input: 4 }, 'gpt-6-sol': { input: 2 }, 'gpt-10-sol': { input: 3 }, 'gpt-6.1-sol': { input: 2 }, 'claude-sonnet-4-5': { input: 3 }, 'claude-sonnet-4-6': { input: 3 } };
  const before = structuredClone(rates);
  assert.deepEqual(pricingEntries(rates, ' GPT- ').map(([id]) => id), ['gpt-10-sol', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol']);
  assert.deepEqual(pricingEntries(rates, 'sonnet').map(([id]) => id), ['claude-sonnet-4-6', 'claude-sonnet-4-5']);
  assert.equal(pricingEntries(rates, 'gpt-6.1')[0][1], rates['gpt-6.1-sol']);
  assert.deepEqual(pricingEntries(rates, 'not-a-model'), []);
  assert.deepEqual(rates, before);
});

test('wildcard Host admission follows the socket destination and retains loopback aliases', () => {
  const config = { host: '0.0.0.0', port: 45678 };
  assert.equal(allowedRequestHost(config, '192.0.2.10:45678', '192.0.2.10'), true);
  for (const host of ['192.0.2.11:45678', '192.0.2.10:45679', 'example.com:45678', 'example.com', 'localhost:45678', '192.0.2.10:45678@evil.test']) assert.equal(allowedRequestHost(config, host, '192.0.2.10'), false, host);
  assert.equal(allowedRequestHost(config, '192.0.2.10:45678', undefined), false);
  assert.equal(allowedRequestHost({ ...config, host: '::' }, '[::1]:45678', '::1'), true);
  assert.equal(allowedRequestHost({ ...config, host: '::' }, '127.0.0.1:45678', '::ffff:127.0.0.1'), true);
  assert.equal(allowedRequestHost({ ...config, host: '127.0.0.1' }, 'localhost:45678', '127.0.0.1'), true);
  assert.equal(allowedRequestHost({ ...config, host: '127.0.0.1' }, 'evil.test:45678', '127.0.0.1'), false);
  assert.equal(allowedRequestHost({ ...config, host: '192.0.2.10' }, '127.0.0.1:45678', '127.0.0.1'), false);
});
