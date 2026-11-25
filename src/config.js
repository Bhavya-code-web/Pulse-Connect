'use strict';
const fs = require('fs');
const path = require('path');

/** Minimal .env loader (no dependency). Real environment variables win. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

const e = process.env;
module.exports = {
  port: Number(e.PORT) || 3000,
  db: {
    client: (e.DB_CLIENT || 'mysql').toLowerCase(),
    host: e.DB_HOST || '127.0.0.1',
    port: Number(e.DB_PORT) || 3306,
    user: e.DB_USER || 'root',
    password: e.DB_PASSWORD || '',
    name: e.DB_NAME || 'pulseconnect',
    sqliteFile: path.resolve(__dirname, '..', e.SQLITE_FILE || './database/pulseconnect.sqlite')
  },
  corsOrigin: e.CORS_ORIGIN || '',
  adminToken: e.ADMIN_TOKEN || '',
  trustProxy: e.TRUST_PROXY === 'true',
  frontendDir: path.resolve(__dirname, '..', '..', 'frontend'),
  schemaDir: path.resolve(__dirname, '..', 'database')
};
