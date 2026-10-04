# Sathsangath Backend (REST API)

Node.js + Express + TypeScript + Prisma + PostgreSQL. One API serves the website today and the Android / iOS apps later:
stateless JWT auth (`Authorization: Bearer <token>`), JSON everywhere, versioned under `/api/v1`, no cookies, no CORS needed for native apps.

## Run

```bash
npm install
npm run setup      # generate client, create PostgreSQL tables, seed admin + demo data
npm run dev        # http://localhost:4000/api/v1
```

Database: PostgreSQL. Copy `.env.example` to `.env`, set `DB_*` and the matching `DATABASE_URL` (Prisma reads `DATABASE_URL`), create the database once, then `npm run setup` creates tables and seeds demo data.
Change `JWT_SECRET` and the admin password before going live.

## Demo logins (seed)

| Who | Login | Password |
|---|---|---|
| Admin | admin@sathsangath.in | Admin@12345 |
| Members SS-1001 … SS-1020 | 9000000001 … 9000000020 or SS-10xx | Demo@1234 |

## Endpoints (`/api/v1`)

- **public**: `POST /public/biodata` (multipart, `photo` + `biodata` files), `POST /public/intake-webhook` (Google Form, header `x-webhook-secret`), `POST /public/contact`
- **auth**: `POST /auth/login`, `POST /auth/change-password`, `POST /auth/admin/login`, `GET /auth/admin/me`
- **member** (token, approved members only): `GET /member/me`, `PATCH /member/me`, `GET /member/matches?page=`, `GET /member/profiles/:id`, `PUT|DELETE /member/likes/:id`, `GET /member/likes`, `POST /member/introductions`, `GET|POST /member/photos`, `PATCH /member/photos/:id/main`, `DELETE /member/photos/:id`, `GET /member/notifications`, `GET /member/announcements`
- **admin** (token): dashboard, members (list/filter/export.csv/edit), approve / correction / reject / suspend / reactivate / resend-credentials, tags, visibility overrides, likes, introductions, mutual-like notifications, announcements, messages, activity log (all roles), staff

Errors: `{ "error": "message", "fields": { "phone": "..." } }` (HTTP 422 for validation).

## Rules enforced on the server

- Members only ever receive `toPublicProfile()` (no name, phone, email, family contacts, DOB, document). Masking is not a CSS trick.
- Members cannot message each other. The only action is Like, then "Request introduction" which goes to the admin.
- Matching = opposite gender + approved + viewer's preferences vs admin tags (Community, City) + age range, with admin SHOW/HIDE overrides.
- Passwords hashed with bcrypt, login rate-limited, duplicate phone/email rejected, temporary password forced to change.

## Before go-live

- `src/lib/notify.ts`: plug in a real SMS (MSG91/Twilio) and email provider. Today it logs to the console.
- Serve behind HTTPS, set strong `JWT_SECRET`, restrict `CORS_ORIGINS` to the real website domain.
- Google Form: add an Apps Script `onFormSubmit` that POSTs the answers to `/public/intake-webhook`.
- Media lives in object storage behind `src/lib/storage` (Cloudflare R2 by default; change `storage.provider` in `src/lib/config.ts` to `s3` for AWS S3, add a driver for GCS). Photos are served via short-lived signed URLs. Vercel caps request bodies at 4.5 MB.
