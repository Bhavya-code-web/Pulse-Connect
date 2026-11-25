'use strict';
const fs = require('fs');
const path = require('path');
const { COMPATIBLE_DONORS, validateDonor, validateDonorPatch, validateEmergency } = require('./validate');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
const DONOR_SELECT = 'SELECT donor_id, name, blood_group, age, location, phone, status, registered_date FROM donors';
const PATCH_COLUMNS = { name: 'name', bloodGroup: 'blood_group', age: 'age', location: 'location', phone: 'phone', status: 'status' };

class HttpError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

const toDonor = r => ({
  id: `DON-${r.donor_id}`, name: r.name, bloodGroup: r.blood_group, age: Number(r.age),
  location: r.location, phone: r.phone, registeredDate: String(r.registered_date).slice(0, 10), status: r.status
});
const parseDonorId = raw => {
  const m = /^DON-(\d{1,9})$/.exec(raw || '');
  if (!m) throw new HttpError(404, 'Donor not found.');
  return Number(m[1]);
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const likeValue = s => `%${s.replace(/[!%_]/g, '!$&')}%`;           // escape LIKE wildcards (ESCAPE '!')
const isDuplicate = e => e && (e.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(e.message || ''));

function createApp(db, cfg, opts = {}) {
  const limits = { general: 300, write: 40, windowMs: 60_000, ...(opts.limits || {}) };
  const hits = new Map();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, limits.windowMs);
  sweep.unref();

  function rateLimit(req, res, isWrite) {
    const fwd = cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = fwd || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [bucket, max] of [['g', limits.general], ...(isWrite ? [['w', limits.write]] : [])]) {
      const key = `${bucket}:${ip}`;
      let h = hits.get(key);
      if (!h || h.reset < now) { h = { count: 0, reset: now + limits.windowMs }; hits.set(key, h); }
      if (++h.count > max) {
        res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
        throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
      }
    }
  }

  function send(res, status, body) {
    if (status === 204) { res.writeHead(204); return res.end(); }
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > 10_000) { reject(new HttpError(413, 'Request body is too large.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve({});
        try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, 'Request body must be valid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  const fail = (errors) => new HttpError(422, Object.values(errors)[0], errors);

  async function findDonor(numId) {
    const rows = await db.query(`${DONOR_SELECT} WHERE donor_id = ?`, [numId]);
    if (!rows.length) throw new HttpError(404, 'Donor not found.');
    return toDonor(rows[0]);
  }

  // ----- Donor handlers ----------------------------------------------------
  async function listDonors(url) {
    const where = [], params = [];
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const bg = url.searchParams.get('bloodGroup'), st = url.searchParams.get('status');
    const loc = (url.searchParams.get('location') || '').trim().slice(0, 100);
    if (bg) { where.push('blood_group = ?'); params.push(bg); }
    if (st) { where.push('status = ?'); params.push(st); }
    if (loc) { where.push("location LIKE ? ESCAPE '!'"); params.push(likeValue(loc)); }
    if (q) {
      const idm = /^DON-(\d{1,9})$/i.exec(q);
      where.push(idm ? '(donor_id = ? OR name LIKE ? ESCAPE \'!\')' : "(name LIKE ? ESCAPE '!' OR location LIKE ? ESCAPE '!')");
      params.push(...(idm ? [Number(idm[1]), likeValue(q)] : [likeValue(q), likeValue(q)]));
    }
    const sql = `${DONOR_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY donor_id DESC LIMIT 5000`;
    return (await db.query(sql, params)).map(toDonor);
  }

  async function createDonor(body) {
    const { value, errors } = validateDonor(body);
    if (Object.keys(errors).length) throw fail(errors);
    try {
      const r = await db.run(
        'INSERT INTO donors (name, blood_group, age, location, phone, status, registered_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [value.name, value.bloodGroup, value.age, value.location, value.phone, value.status, today()]);
      return await findDonor(r.insertId);
    } catch (e) {
      if (isDuplicate(e)) throw new HttpError(409, 'A donor with this phone number is already registered.', { phone: 'Already registered.' });
      throw e;
    }
  }

  async function patchDonor(numId, body) {
    await findDonor(numId);
    const { value, errors } = validateDonorPatch(body);
    if (Object.keys(errors).length) throw fail(errors);
    const keys = Object.keys(value);
    const sets = keys.map(k => `${PATCH_COLUMNS[k]} = ?`);          // column names come from a fixed whitelist
    try {
      await db.run(`UPDATE donors SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE donor_id = ?`, [...keys.map(k => value[k]), numId]);
    } catch (e) {
      if (isDuplicate(e)) throw new HttpError(409, 'Another donor already uses this phone number.', { phone: 'Already registered.' });
      throw e;
    }
    return findDonor(numId);
  }

  // ----- Emergency requests ------------------------------------------------
  async function createEmergency(body) {
    const { value, errors } = validateEmergency(body);
    if (Object.keys(errors).length) throw fail(errors);
    const groups = COMPATIBLE_DONORS[value.bloodGroup];
    const rows = await db.query(
      `SELECT COUNT(*) AS n FROM donors WHERE status = 'Available' AND blood_group IN (${groups.map(() => '?').join(',')}) AND location LIKE ? ESCAPE '!'`,
      [...groups, likeValue(value.city)]);
    const matched = Number(rows[0].n);
    const r = await db.run(
      'INSERT INTO emergency_requests (patient_name, blood_group, units, hospital, city, urgency, contact_phone, matched_donors) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [value.patient, value.bloodGroup, value.units, value.hospital, value.city, value.urgency, value.contactPhone, matched]);
    return {
      id: `REQ-${r.insertId}`, status: 'Open', bloodGroup: value.bloodGroup, urgency: value.urgency,
      matchedDonors: matched, message: `Emergency request recorded. ${matched} compatible available donor(s) found in ${value.city}.`
    };
  }

  async function listEmergency(req) {
    if (!cfg.adminToken) throw new HttpError(403, 'Listing emergency requests is disabled. Set ADMIN_TOKEN to enable it.');
    if (req.headers['x-admin-token'] !== cfg.adminToken) throw new HttpError(401, 'Invalid or missing admin token.');
    const rows = await db.query('SELECT * FROM emergency_requests ORDER BY request_id DESC LIMIT 200');
    return rows.map(r => ({
      id: `REQ-${r.request_id}`, patient: r.patient_name, bloodGroup: r.blood_group, units: Number(r.units), hospital: r.hospital,
      city: r.city, urgency: r.urgency, contactPhone: r.contact_phone, matchedDonors: Number(r.matched_donors),
      status: r.status, createdAt: String(r.created_at)
    }));
  }

  // ----- API router --------------------------------------------------------
  async function handleApi(req, res, url) {
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    rateLimit(req, res, isWrite);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const [resource, id] = parts;
    const m = req.method;

    if (resource === 'health' && !id) {
      if (m !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const r = await db.query('SELECT COUNT(*) AS n FROM donors');
      return send(res, 200, { status: 'ok', database: db.client, donors: Number(r[0].n) });
    }
    if (resource === 'donors') {
      if (!id) {
        if (m === 'GET') return send(res, 200, await listDonors(url));
        if (m === 'POST') return send(res, 201, await createDonor(await readJson(req)));
        throw new HttpError(405, 'Method not allowed.');
      }
      if (parts.length === 2) {
        const numId = parseDonorId(id);
        if (m === 'GET') return send(res, 200, await findDonor(numId));
        if (m === 'PATCH' || m === 'PUT') return send(res, 200, await patchDonor(numId, await readJson(req)));
        if (m === 'DELETE') {
          const r = await db.run('DELETE FROM donors WHERE donor_id = ?', [numId]);
          if (!r.affectedRows) throw new HttpError(404, 'Donor not found.');
          return send(res, 204);
        }
        throw new HttpError(405, 'Method not allowed.');
      }
    }
    if (resource === 'emergency-requests' && !id) {
      if (m === 'POST') return send(res, 201, await createEmergency(await readJson(req)));
      if (m === 'GET') return send(res, 200, await listEmergency(req));
      throw new HttpError(405, 'Method not allowed.');
    }
    throw new HttpError(404, 'Route not found.');
  }

  // ----- Static frontend ---------------------------------------------------
  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad request.'); }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad request.');
    const file = path.resolve(cfg.frontendDir, '.' + (rel === '/' ? '/index.html' : rel));
    if (file !== cfg.frontendDir && !file.startsWith(cfg.frontendDir + path.sep)) throw new HttpError(404, 'Not found.');
    let data;
    try { data = await fs.promises.readFile(file); } catch { throw new HttpError(404, 'Not found.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (cfg.corsOrigin) {
          res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
          res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
          res.setHeader('Vary', 'Origin');
          if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        }
        return await handleApi(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { message: err.message, ...(err.errors ? { errors: err.errors } : {}) });
      console.error('Unhandled error:', err);
      return send(res, 500, { message: 'Internal server error.' });
    }
  };
}
module.exports = { createApp };
