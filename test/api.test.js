'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

const root = path.resolve(__dirname, '..');
const cfg = { frontendDir: path.resolve(root, '..', 'frontend'), adminToken: 'secret-token', corsOrigin: '', trustProxy: false };
let db, server, base;

async function boot(limits) {
  const d = await createDb({ client: 'sqlite', sqliteFile: ':memory:' });
  const sql = fs.readFileSync(path.join(root, 'database', 'schema.sqlite.sql'), 'utf8').split('\n').filter(l => !l.startsWith('--')).join('\n');
  for (const s of sql.split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) await d.exec(s);
  for (const x of JSON.parse(fs.readFileSync(path.join(root, 'database', 'seed-donors.json'), 'utf8'))) {
    await d.run('INSERT INTO donors (donor_id,name,blood_group,age,location,phone,status,registered_date) VALUES (?,?,?,?,?,?,?,?)',
      [Number(x.id.slice(4)), x.name, x.bloodGroup, x.age, x.location, x.phone, x.status, x.registeredDate]);
  }
  const s = http.createServer(createApp(d, cfg, { limits }));
  await new Promise(r => s.listen(0, r));
  return { d, s, url: `http://127.0.0.1:${s.address().port}` };
}
const call = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body && typeof o.body !== 'string' ? JSON.stringify(o.body) : o.body });
const valid = { name: 'Test Donor', bloodGroup: 'O-', age: 30, location: 'Hyderabad, Telangana, India', phone: '+91 9000011111', status: 'Available' };

before(async () => { ({ d: db, s: server, url: base } = await boot()); });
after(async () => { server.close(); await db.close(); });

test('health reports database and donor count', async () => {
  const r = await call('/api/health'); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.status, 'ok'); assert.equal(b.donors, 12);
});

test('GET /api/donors returns the frontend donor shape', async () => {
  const b = await (await call('/api/donors')).json();
  assert.equal(b.length, 12);
  assert.deepEqual(Object.keys(b[0]).sort(), ['age', 'bloodGroup', 'id', 'location', 'name', 'phone', 'registeredDate', 'status']);
  assert.match(b[0].id, /^DON-\d+$/); assert.match(b[0].registeredDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('filters: bloodGroup, status, location and q', async () => {
  assert.equal((await (await call('/api/donors?bloodGroup=O%2B')).json()).length, 2);
  assert.equal((await (await call('/api/donors?location=chennai')).json()).length, 2);
  assert.equal((await (await call('/api/donors?q=priya')).json()).length, 1);
  assert.equal((await (await call('/api/donors?q=DON-1005')).json()).length, 1);
  assert.equal((await (await call('/api/donors?status=Unavailable')).json()).length, 0);
  assert.equal((await (await call('/api/donors?location=%25')).json()).length, 0, 'LIKE wildcards are escaped');
});

test('SQL injection attempts are treated as plain text', async () => {
  const r = await call("/api/donors?q=" + encodeURIComponent("' OR 1=1 --"));
  assert.equal((await r.json()).length, 0);
  assert.equal((await (await call('/api/health')).json()).donors, 12);
});

test('POST creates a donor with next ID, normalized phone and today as date', async () => {
  const r = await call('/api/donors', { method: 'POST', body: { ...valid, phone: '90000 11111' } });
  const b = await r.json();
  assert.equal(r.status, 201); assert.equal(b.id, 'DON-1013'); assert.equal(b.phone, '+91 9000011111');
  assert.equal(b.status, 'Available'); assert.equal(b.registeredDate.length, 10);
});

test('POST rejects duplicates (409) and invalid data (422)', async () => {
  assert.equal((await call('/api/donors', { method: 'POST', body: valid })).status, 409);
  for (const bad of [{ name: 'A' }, { ...valid, age: 17 }, { ...valid, age: 25.5 }, { ...valid, bloodGroup: 'Z+' },
    { ...valid, phone: '12345' }, { ...valid, name: '<script>alert(1)</script>', phone: '+91 9111122222' }, { ...valid, status: 'Maybe', phone: '+91 9111122222' }]) {
    const r = await call('/api/donors', { method: 'POST', body: bad });
    assert.equal(r.status, 422); const b = await r.json(); assert.ok(b.message && b.errors);
  }
});

test('malformed JSON gives 400 and oversized body gives 413', async () => {
  assert.equal((await call('/api/donors', { method: 'POST', body: '{bad json' })).status, 400);
  const big = await call('/api/donors', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(20000) }) }).catch(() => null);
  if (big) assert.equal(big.status, 413);
});

test('PATCH updates status, validates input and returns 404 for unknown IDs', async () => {
  let r = await call('/api/donors/DON-1001', { method: 'PATCH', body: { status: 'Unavailable' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).status, 'Unavailable');
  assert.equal((await call('/api/donors/DON-1001', { method: 'PATCH', body: { status: 'Nope' } })).status, 422);
  assert.equal((await call('/api/donors/DON-1001', { method: 'PATCH', body: {} })).status, 422);
  assert.equal((await call('/api/donors/DON-9999', { method: 'PATCH', body: { status: 'Available' } })).status, 404);
  assert.equal((await call('/api/donors/DON-1002', { method: 'PATCH', body: { phone: '9840223456' } })).status, 200, 'same number on same donor is fine');
  assert.equal((await call('/api/donors/DON-1002', { method: 'PATCH', body: { phone: '9811334567' } })).status, 409);
});

test('DELETE returns 204 then 404', async () => {
  assert.equal((await call('/api/donors/DON-1013', { method: 'DELETE' })).status, 204);
  assert.equal((await call('/api/donors/DON-1013', { method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/donors/abc', { method: 'DELETE' })).status, 404);
});

const emergency = { patient: 'Ramesh Kumar', bloodGroup: 'A+', units: 2, hospital: 'Apollo Hospital', city: 'Chennai', urgency: 'Critical', contactPhone: '+91 9840223456' };

test('emergency request is stored and counts compatible available donors', async () => {
  const r = await call('/api/emergency-requests', { method: 'POST', body: emergency }); const b = await r.json();
  assert.equal(r.status, 201); assert.match(b.id, /^REQ-5001$/);
  assert.equal(b.matchedDonors, 2, 'Priya (A+) and Aarthi (A-) are available in Chennai');
});

test('emergency validation and admin-only listing', async () => {
  assert.equal((await call('/api/emergency-requests', { method: 'POST', body: { ...emergency, units: 99 } })).status, 422);
  assert.equal((await call('/api/emergency-requests')).status, 401);
  const r = await call('/api/emergency-requests', { headers: { 'x-admin-token': 'secret-token' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).length, 1);
});

test('unknown routes, wrong methods', async () => {
  assert.equal((await call('/api/nothing')).status, 404);
  assert.equal((await call('/api/donors', { method: 'DELETE' })).status, 405);
});

test('serves the frontend and blocks path traversal', async () => {
  const r = await call('/'); assert.equal(r.status, 200); assert.match(await r.text(), /Pulse Connect/);
  assert.equal((await call('/app.js')).status, 200);
  assert.equal((await call('/..%2fbackend%2fpackage.json')).status, 404);
  assert.equal((await call('/%2e%2e/backend/src/app.js')).status, 404);
  assert.equal((await call('/')).headers.get('x-content-type-options'), 'nosniff');
});

test('rate limiting returns 429 with Retry-After', async () => {
  const t = await boot({ general: 3, write: 2 });
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(t.url + '/api/health')).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    assert.ok((await fetch(t.url + '/api/health')).headers.get('retry-after'));
  } finally { t.s.close(); await t.d.close(); }
});
