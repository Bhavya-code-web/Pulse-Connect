'use strict';
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUSES = ['Available', 'Unavailable'];
const URGENCIES = ['Critical', 'Urgent', 'Standard'];

// Recipient -> donor groups that can give to them (same table as the frontend).
const COMPATIBLE_DONORS = {
  'A+': ['A+', 'A-', 'O+', 'O-'], 'A-': ['A-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'], 'B-': ['B-', 'O-'],
  'AB+': BLOOD_GROUPS, 'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'O+': ['O+', 'O-'], 'O-': ['O-']
};

/** Accepts "9840223456", "+91 98402 23456", "091-9840223456" ... returns "+91 9840223456" or null. */
function normalizePhone(value) {
  let d = String(value ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91 ${d}` : null;
}

const str = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

const rules = {
  name: v => {
    const s = str(v);
    if (s.length < 3 || s.length > 50) return ['', 'Name must be 3 to 50 characters.'];
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(s)) return ['', 'Name may contain only letters, spaces, dots, apostrophes and hyphens.'];
    return [s];
  },
  bloodGroup: v => BLOOD_GROUPS.includes(v) ? [v] : ['', 'Blood group must be one of ' + BLOOD_GROUPS.join(', ') + '.'],
  age: v => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isInteger(n) && n >= 18 && n <= 65 ? [n] : ['', 'Age must be a whole number from 18 to 65.'];
  },
  location: v => {
    const s = str(v);
    return s.length >= 2 && s.length <= 100 ? [s] : ['', 'Location must be 2 to 100 characters.'];
  },
  phone: v => { const p = normalizePhone(v); return p ? [p] : ['', 'Enter a valid 10-digit Indian mobile number (starts with 6-9).']; },
  status: v => STATUSES.includes(v) ? [v] : ['', 'Status must be Available or Unavailable.']
};

function check(input, fields, requireAll) {
  const value = {}, errors = {};
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  for (const f of fields) {
    if (body[f] === undefined) { if (requireAll) errors[f] = `${f} is required.`; continue; }
    const [v, err] = rules[f](body[f]);
    if (err) errors[f] = err; else value[f] = v;
  }
  return { value, errors };
}

const DONOR_FIELDS = ['name', 'bloodGroup', 'age', 'location', 'phone', 'status'];

function validateDonor(input) {
  return check({ status: 'Available', ...(input || {}) }, DONOR_FIELDS, true);
}
function validateDonorPatch(input) {
  const r = check(input, DONOR_FIELDS, false);
  if (!Object.keys(r.value).length && !Object.keys(r.errors).length) r.errors.body = 'Provide at least one field to update.';
  return r;
}
function validateEmergency(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = {}, value = {};
  const n = rules.name(b.patient);          if (n[1]) errors.patient = n[1]; else value.patient = n[0];
  const g = rules.bloodGroup(b.bloodGroup); if (g[1]) errors.bloodGroup = g[1]; else value.bloodGroup = g[0];
  const u = Number(b.units);
  if (Number.isInteger(u) && u >= 1 && u <= 10) value.units = u; else errors.units = 'Units must be a whole number from 1 to 10.';
  const h = str(b.hospital);
  if (h.length >= 2 && h.length <= 100) value.hospital = h; else errors.hospital = 'Hospital must be 2 to 100 characters.';
  const c = rules.location(b.city);         if (c[1]) errors.city = 'City must be 2 to 100 characters.'; else value.city = c[0];
  if (URGENCIES.includes(b.urgency)) value.urgency = b.urgency; else errors.urgency = 'Urgency must be Critical, Urgent or Standard.';
  const p = rules.phone(b.contactPhone);    if (p[1]) errors.contactPhone = p[1]; else value.contactPhone = p[0];
  return { value, errors };
}

module.exports = { BLOOD_GROUPS, COMPATIBLE_DONORS, normalizePhone, validateDonor, validateDonorPatch, validateEmergency };
