'use strict';
/** Creates the database/tables and loads the 12 fictional seed donors. Use --reset to wipe first. */
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const { createDb } = require('../src/db');

const reset = process.argv.includes('--reset');

function statements(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

(async () => {
  const dbName = cfg.db.name;
  if (cfg.db.client === 'mysql') {
    if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('DB_NAME may only contain letters, digits and underscores.');
    const admin = await createDb({ ...cfg.db, name: '' });          // connect without a database to create it
    await admin.exec(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.close();
  }
  const db = await createDb(cfg.db);
  const schema = path.join(cfg.schemaDir, `schema.${cfg.db.client}.sql`);
  if (reset) {
    await db.exec('DROP TABLE IF EXISTS emergency_requests');
    await db.exec('DROP TABLE IF EXISTS donors');
    if (cfg.db.client === 'sqlite') await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('donors','emergency_requests')").catch(() => {});
  }
  for (const sql of statements(schema)) {
    if (/^(CREATE DATABASE|USE)\b/i.test(sql)) continue;           // handled above
    await db.exec(sql);
  }
  const seed = JSON.parse(fs.readFileSync(path.join(cfg.schemaDir, 'seed-donors.json'), 'utf8'));
  let added = 0;
  for (const d of seed) {
    const exists = await db.query('SELECT donor_id FROM donors WHERE phone = ?', [d.phone]);
    if (exists.length) continue;
    await db.run(
      'INSERT INTO donors (donor_id, name, blood_group, age, location, phone, status, registered_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [Number(d.id.replace('DON-', '')), d.name, d.bloodGroup, d.age, d.location, d.phone, d.status, d.registeredDate]);
    added++;
  }
  const total = (await db.query('SELECT COUNT(*) AS n FROM donors'))[0].n;
  console.log(`Database ready (${cfg.db.client}). Seeded ${added} new donor(s); ${total} total.`);
  await db.close();
})().catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
