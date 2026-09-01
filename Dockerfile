# Production image for the EduGrowth OS backend (Express + Socket.IO).
# Built for Amazon ECS Express Mode, but works on any container platform
# that gives it env vars and a reachable MongoDB.
FROM node:22-alpine

WORKDIR /app

# Install deps first so this layer is cached across builds that only
# change application code, not package.json/package-lock.json.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Only used when STORAGE_DRIVER=local (the default) — irrelevant once
# STORAGE_DRIVER=s3, but harmless to always create. On ECS, local disk is
# ephemeral per task, so STORAGE_DRIVER=s3 is the right choice for
# anything beyond a single always-on task.
RUN mkdir -p uploads/recordings

EXPOSE 5000

# server.js already exposes GET /api/health — ECS Express Mode's health
# check hits this by default.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]
