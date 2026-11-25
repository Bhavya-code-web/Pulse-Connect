# Pulse Connect: Blood Donor Registry (Frontend + Backend + Database)

```
PulseConnect/
├── frontend/            index.html, style.css, app.js (unchanged, calls /api)
└── backend/
    ├── src/             server.js, app.js (routes), db.js, validate.js, config.js
    ├── database/        schema.mysql.sql, seed.mysql.sql, schema.sqlite.sql, seed-donors.json
    ├── scripts/init-db.js
    └── test/api.test.js
```

One Node.js process serves the API **and** the frontend, so `BASE_URL: "/api"` in the frontend works with no changes.

## Quick start A: MySQL (the intended database)
Requires Node 22.13+ and MySQL 8 (or MariaDB 10.5+).
```bash
cd backend
npm install
cp .env.example .env        # set DB_USER / DB_PASSWORD
npm run db:init             # creates DB + tables + 12 fictional donors
npm start                   # http://localhost:3000
```
Prefer Workbench? Run `database/schema.mysql.sql`, then `database/seed.mysql.sql`.

## Quick start B: SQLite (no MySQL, no npm install)
```bash
cd backend
DB_CLIENT=sqlite npm run db:init      # Windows PowerShell: $env:DB_CLIENT="sqlite"; npm run db:init
DB_CLIENT=sqlite npm start
```
`npm run db:reset` drops the tables and reloads the demo data. `npm test` runs the API tests (SQLite in memory).

## Database design
| Table | Purpose | Key points |
|---|---|---|
| `donors` | One row per donor | `donor_id` starts at 1001 (API shows `DON-1001`); `phone` is UNIQUE; ENUMs for blood group and status; CHECK age 18-65; indexes on (blood_group, status) and location |
| `emergency_requests` | Every emergency broadcast | `request_id` starts at 5001 (`REQ-5001`); stores urgency, units, hospital, and how many compatible donors were available at the time |

## REST API
| Method & path | Description | Success |
|---|---|---|
| `GET /api/health` | Database check and donor count | 200 |
| `GET /api/donors` | All donors, newest first. Optional `?q=&bloodGroup=&status=&location=` | 200 |
| `GET /api/donors/:id` | One donor | 200 |
| `POST /api/donors` | Register (`name, bloodGroup, age, location, phone, status`) | 201 |
| `PATCH /api/donors/:id` | Update any of those fields (the UI uses `{status}`) | 200 |
| `DELETE /api/donors/:id` | Remove a donor | 204 |
| `POST /api/emergency-requests` | Save a request (`patient, bloodGroup, units, hospital, city, urgency, contactPhone`) | 201 |
| `GET /api/emergency-requests` | List requests. Needs `ADMIN_TOKEN` set and header `x-admin-token` | 200 |

Errors are `{ "message": "...", "errors": { field: "..." } }` with 400 (bad JSON), 404, 405, 409 (duplicate phone), 413, 422 (validation), 429 (rate limit) or 500.

## Security built in
- Every query is parameterized; column names in updates come from a fixed whitelist; LIKE wildcards are escaped.
- Server-side validation (the browser checks are not trusted): name, age 18-65, blood group, Indian mobile numbers normalized to `+91 XXXXXXXXXX`.
- Rate limiting (300 requests/min per IP, 40 writes/min), 10 KB body limit, `nosniff`/`X-Frame-Options` headers, static path-traversal protection.
- Emergency responses return only a match **count**, never donor phone numbers.

## Known limitations (read before real-world use)
- **No user login.** Anyone who can reach the server can read the donor list and delete records, because the frontend has no login screen. For anything beyond a college demo, add authentication and roles, HTTPS, and a consent/privacy policy for donor data.
- The emergency request is **stored**; it does not send SMS or email yet. A notification service (e.g. Twilio) is the natural next step.
- Tested here with SQLite and a mock-free HTTP suite; the MySQL path (`mysql2`) uses the same parameterized queries but was not run against a live MySQL server in this environment, so do the quick start A once and run through register / toggle / delete.
- `node:sqlite` needs Node 22.13+ and prints an "experimental" notice in SQLite mode only.
- Demo data is fictional.

## Viva notes
- **Why a backend?** The frontend keeps data only in memory, so records vanished on refresh. The database makes them permanent and shared.
- **Why parameterized queries?** They stop SQL injection because input is sent as data, never as SQL text.
- **Why validate on the server too?** Anyone can bypass browser checks with `curl`.
- **Why a UNIQUE phone column?** The database itself guarantees no duplicate donors, even under concurrent requests.
# Pulse-Connect
