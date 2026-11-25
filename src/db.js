'use strict';
/**
 * Thin database adapter. Both drivers expose the same methods using "?"
 * placeholders, so every query in the app is parameterized (no SQL injection).
 *   query(sql, params) -> array of row objects
 *   run(sql, params)   -> { insertId, affectedRows }
 *   exec(sql)          -> run a single DDL statement
 */
async function createDb(cfg) {
  if (cfg.client === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(cfg.sqliteFile);
    return {
      client: 'sqlite',
      async query(sql, p = []) { return db.prepare(sql).all(...p).map(r => ({ ...r })); },
      async run(sql, p = []) {
        const r = db.prepare(sql).run(...p);
        return { insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) };
      },
      async exec(sql) { db.exec(sql); },
      async close() { db.close(); }
    };
  }
  if (cfg.client !== 'mysql') throw new Error(`Unsupported DB_CLIENT "${cfg.client}" (use mysql or sqlite).`);

  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: cfg.name || undefined,
    waitForConnections: true, connectionLimit: 10,
    dateStrings: true,            // DATE columns arrive as 'YYYY-MM-DD' strings
    charset: 'utf8mb4'
  });
  return {
    client: 'mysql',
    async query(sql, p = []) { const [rows] = await pool.execute(sql, p); return rows; },
    async run(sql, p = []) {
      const [r] = await pool.execute(sql, p);
      return { insertId: r.insertId, affectedRows: r.affectedRows };
    },
    async exec(sql) { await pool.query(sql); },
    async close() { await pool.end(); }
  };
}
module.exports = { createDb };
