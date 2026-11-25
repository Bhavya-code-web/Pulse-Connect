'use strict';
const http = require('http');
const cfg = require('./config');
const { createDb } = require('./db');
const { createApp } = require('./app');

(async () => {
  const db = await createDb(cfg.db);
  try { await db.query('SELECT 1 FROM donors LIMIT 1'); }
  catch (e) {
    console.error(`\nCannot read the "donors" table (${e.message}).\nRun "npm run db:init" first and check your .env database settings.\n`);
    process.exit(1);
  }
  const server = http.createServer(createApp(db, cfg));
  server.listen(cfg.port, () => console.log(`Pulse Connect running at http://localhost:${cfg.port}  (database: ${db.client})`));
  const stop = () => server.close(async () => { await db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
