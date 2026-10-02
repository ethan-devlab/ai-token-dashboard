import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRequest } from '../server/request-policy.mjs';

const config = { host: '127.0.0.1', port: 3333 };
function request(headers = {}, extra = {}) {
  const entries = Object.entries({ host: '127.0.0.1:3333', ...headers });
  return { method: 'GET', url: '/api/dashboard', headers: Object.fromEntries(entries), rawHeaders: entries.flat(), socket: { localAddress: '127.0.0.1' }, ...extra };
}
function denied(req, code, selected = config) { assert.throws(() => validateRequest(req, selected), error => error.code === code); }

test('admitted authorities preserve loopback and wildcard destinations with precise effective ports', () => {
  for (const host of ['127.0.0.1:3333', 'LOCALHOST:3333', '[::1]:3333']) assert.equal(validateRequest(request({ host }), config).pathname, '/api/dashboard');
  for (const host of ['evil.test:3333', 'localhost.:3333', '127.1:3333', '2130706433:3333', '127.0.0.1:3334', '127.0.0.1', 'localhost:0', 'localhost:65536', 'user@localhost:3333', 'localhost:3333,evil', '[bad]:3333', ' localhost:3333']) denied(request({ host }), 'INVALID_HOST');
  denied(request({ host: undefined }), 'INVALID_HOST');
  const duplicate = request(); duplicate.rawHeaders.push('Host', 'localhost:3333'); denied(duplicate, 'INVALID_HOST');
  for (const host of ['localhost', 'localhost:80']) assert.equal(validateRequest(request({ host, origin: 'http://localhost' }, { method: 'POST' }), { ...config, port: 80 }).origin, 'http://localhost');
  assert.equal(validateRequest(request({ host: '192.0.2.10:3333' }, { socket: { localAddress: '192.0.2.10' } }), { ...config, host: '0.0.0.0' }).host, '192.0.2.10:3333');
  denied(request({ host: '192.0.2.11:3333' }, { socket: { localAddress: '192.0.2.10' } }), 'INVALID_HOST', { ...config, host: '0.0.0.0' });
});

test('GET allows absent source and direct navigation but rejects explicit conflicting API evidence', () => {
  for (const headers of [{}, { origin: 'http://127.0.0.1:3333' }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }]) validateRequest(request(headers), config);
  for (const origin of ['null', '', 'https://127.0.0.1:3333', 'http://localhost:3333', 'http://127.1:3333', 'http://2130706433:3333', 'http://127.0.0.1:3334', 'http://127.0.0.1:3333/', 'http://user@127.0.0.1:3333', 'http://127.0.0.1:3333?x', 'http://127.0.0.1:3333#x', 'http://evil.test']) denied(request({ origin }), 'INVALID_ORIGIN');
  for (const site of ['cross-site', 'same-site', '', 'unknown', 'same-origin, none']) denied(request({ 'sec-fetch-site': site }), 'INVALID_FETCH_METADATA');
  denied(request({ origin: 'http://127.0.0.1:3333', 'sec-fetch-site': 'cross-site' }), 'INVALID_FETCH_METADATA');
  for (const header of ['origin', 'sec-fetch-site']) { const req = request({ [header]: header === 'origin' ? 'http://127.0.0.1:3333' : 'same-origin' }); req.rawHeaders.push(header, req.headers[header]); denied(req, header === 'origin' ? 'INVALID_ORIGIN' : 'INVALID_FETCH_METADATA'); }
  validateRequest(request({ origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' }, { url: '/' }), config);
});

test('POST requires exact origin while preserving direct tools and distrusts forwarded assertions', () => {
  for (const site of [undefined, 'same-origin']) validateRequest(request({ origin: 'http://127.0.0.1:3333', ...(site ? { 'sec-fetch-site': site } : {}) }, { method: 'POST' }), config);
  denied(request({}, { method: 'POST' }), 'INVALID_ORIGIN');
  denied(request({ origin: 'http://127.0.0.1:3333', 'sec-fetch-site': 'none' }, { method: 'POST' }), 'INVALID_FETCH_METADATA');
  denied(request({ origin: 'https://external.test', 'x-forwarded-host': 'external.test', 'x-forwarded-proto': 'https' }, { method: 'POST' }), 'INVALID_ORIGIN');
  denied(request({ host: 'external.test:3333', 'x-forwarded-host': '127.0.0.1:3333' }), 'INVALID_HOST');
});

test('request targets cannot replace the admitted authority', () => {
  for (const url of ['http://evil.test/api/dashboard', '//evil.test/api/dashboard', '/\\evil.test/api/dashboard', '/\t/evil.test/api/dashboard', '*']) denied(request({}, { url }), 'INVALID_REQUEST_TARGET');
  assert.equal(validateRequest(request({}, { url: '/api/dashboard?q=http%3A%2F%2Fexample.com' }), config).origin, 'http://127.0.0.1:3333');
});
