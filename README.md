# EduGrowth OS — Backend (Admin API)

A scoped Express + MongoDB implementation of the Admin console slice from the
EduGrowth OS Architecture & System Design doc: auth, student management,
course management, mentor management, and the admin profile/settings.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # edit MONGO_URI / JWT_SECRET as needed
npm run seed            # creates a default admin + sample data
npm run dev              # starts on http://localhost:5000
```

Default login after seeding:
- **Email:** admin@brightprep.edu
- **Password:** admin123

## API

Auth uses an **httpOnly cookie** set on login — the browser sends it automatically,
so no `Authorization` header is needed from the frontend. API clients that can't
rely on cookies (Postman, scripts) can still use `Authorization: Bearer <token>`;
`/api/auth/login` returns the token in the response body for that purpose too.
All routes below except `/api/auth/login` and `/api/auth/logout` require one of
the two.

| Method | Route | Purpose |
|---|---|---|
| POST | /api/auth/login | Admin sign-in, sets auth cookie + returns JWT (rate-limited: 10 attempts / 15 min) |
| POST | /api/auth/logout | Clears the auth cookie |
| GET | /api/auth/me | Current admin profile |
| PUT | /api/auth/profile | Update name/email/phone/institute/bio, and company profile fields (`about`, `website`, `location`, `employeeCount`, `gstRegistered`, `gstNumber`) |
| POST | /api/auth/avatar | Upload profile photo / DP (multipart, field `avatar`) |
| POST | /api/auth/cover | Upload cover/banner photo (multipart, field `cover`) |
| PUT | /api/auth/password | Change password |
| GET | /api/students | List students |
| POST | /api/students | Add student `{ name, course, status?, joinedVia? }` |
| DELETE | /api/students/:id | Remove student |
| GET | /api/courses | List courses (with mentor + enrolled count) |
| POST | /api/courses | Add course `{ title, mentor, mode }` |
| DELETE | /api/courses/:id | Remove course (cascades its students) |
| GET | /api/mentors | List mentors (with batch + student counts) |
| POST | /api/mentors | Add mentor `{ name, subject, color? }` |
| DELETE | /api/mentors/:id | Remove mentor |
| GET | /api/stats | Home screen totals |
| GET | /api/feedback | List feedback entries |
| POST | /api/feedback | Add feedback `{ name, role, course?, rating?, message }` |
| DELETE | /api/feedback/:id | Remove feedback |
| GET | /api/schedule | List class schedule / time table entries (sorted by day, then start time) |
| POST | /api/schedule | Add schedule entry `{ course, day, startTime, endTime, room?, notes? }` |
| DELETE | /api/schedule/:id | Remove schedule entry |
| GET | /api/recorded-sessions | List recorded sessions (newest first) |
| POST | /api/recorded-sessions | Add recorded session `{ title, course, videoUrl, date, notes? }` |
| DELETE | /api/recorded-sessions/:id | Remove recorded session |
| POST | /api/mentors/:id/resend-invite | Re-issue and re-send a mentor's set-password invite (only while still "invited") |

### Mentor portal (separate session, `eg_mentor_token` cookie)

| Method | Route | Purpose |
|---|---|---|
| POST | /api/mentor-auth/invite/request-otp | `{ token }` — validates an invite link, emails a fresh 6-digit OTP |
| POST | /api/mentor-auth/invite/set-password | `{ token, otp, password }` — verifies the OTP, sets password, activates the mentor, logs them in |
| POST | /api/mentor-auth/login | `{ email, password }` — mentor sign-in (rate-limited: 10 attempts / 15 min) |
| POST | /api/mentor-auth/logout | Clears the mentor auth cookie |
| GET | /api/mentor-auth/me | Current mentor profile (requires mentor session) |
| GET | /api/mentor/overview | This mentor's batch/student/recording counts |
| GET | /api/mentor/courses | This mentor's assigned courses, each with its schedule |
| GET | /api/mentor/students | Students enrolled across this mentor's courses |
| GET | /api/mentor/recorded-sessions | Recorded sessions across this mentor's courses |

All `/api/mentor/*` routes are scoped server-side to `req.mentor` from the
session — there's no `:id` param, so a mentor can never fetch another
mentor's data by editing a URL.

## Notes

- Passwords are hashed with bcrypt; JWTs expire per `JWT_EXPIRES_IN` and are
  delivered via an httpOnly cookie (not readable from JS) rather than
  localStorage.
- Avatar/cover uploads are restricted to PNG/JPEG/WEBP/GIF (SVG is rejected —
  it can carry inline scripts), and the previous file is deleted whenever a
  new one is uploaded. Storage location follows `STORAGE_DRIVER` (see
  `.env.example`): local disk under `/uploads` served statically (default),
  or an S3 bucket under an `avatars/` key prefix when `STORAGE_DRIVER=s3` —
  served back out through a public `GET /api/uploads/avatar/:filename`
  proxy in that mode, since the bytes aren't on this server's disk to serve
  statically. Same bucket/IAM setup as live-class recordings; see the main
  README's "S3 storage" section.
- Deleting a **course** cascades to its students, schedule entries, and
  recorded sessions. Deleting a **mentor** cascades to its courses, and from
  there to their students, schedule entries, and recorded sessions —
  nothing is left pointing at a deleted record.
- Every controller is wrapped in `asyncHandler` and routed through a
  centralized error handler in `server.js`, so a bad request (invalid id,
  validation failure, duplicate email, etc.) returns a clean JSON error
  instead of crashing the process.
- The server validates required env vars (`JWT_SECRET`, `MONGO_URI`) at boot
  and exits with a clear message if they're missing, instead of failing
  confusingly on the first request that needs them.
- This is a single-tenant MVP slice of the full multi-tenant microservices
  architecture described in the design doc — swap `models/` for tenant-scoped
  schemas and split into services when moving past a single-institute pilot.
