# NightCode Production Deployment Plan

Two goals:

1. **Server on a VPS.** Run the Hono API (`packages/server`) and Postgres on a VPS behind HTTPS, at e.g. `https://api.nightcode.dev`.
2. **CLI on npm.** Publish the CLI (`packages/cli`) to the npm registry so users can run `npm install -g <package>` (or `bun add -g`) and then `nightcode`.

---

## 0. Things that block a release (current state of the repo)

| # | Problem | Where | Fix |
|---|---------|-------|-----|
| 1 | The CLI loads `.env` from `../../../.env` relative to `bin/`. That path does not exist in an npm install. | `packages/cli/bin/nightcode` | Bake public config into the bundle at build time (see §2.2). |
| 2 | `API_URL` defaults to `http://localhost:3000`. | `cli/src/lib/api-client.ts:7`, `cli/src/lib/oauth.ts:40` | Inject the production URL at build time. Keep the `process.env` override for dev. |
| 3 | `CLERK_FRONTEND_API` and `CLERK_OAUTH_CLIENT_ID` come from env. | `cli/src/lib/oauth.ts:38-39` | Inject at build time. Both are public values in a PKCE flow. **Never** ship `CLERK_OAUTH_CLIENT_SECRET` or `CLERK_SECRET_KEY` in the CLI. |
| 4 | The CLI package is `"private": true` and depends on `workspace:*` packages. | `packages/cli/package.json` | Publish a bundled build with a separate, clean `package.json` (§2.3). |
| 5 | The bin uses `#!/usr/bin/env bun`, and OpenTUI needs the Bun runtime (`bun:ffi` plus native libs such as `@opentui/core-linux-x64`). | `packages/cli/bin/nightcode` | Phase A: require Bun. Phase B: ship compiled per-platform binaries (§2.5). |
| 6 | There are no Prisma migrations, only `prisma db push`. | `packages/database/prisma/` | Create a baseline migration and use `prisma migrate deploy` in prod (§1.4). |
| 7 | The server port is hardcoded to `3000`. | `server/src/index.ts` | Use `Number(process.env.PORT ?? 3000)`. |
| 8 | The package name `nightcode` may already be taken on npm. | — | Run `npm view nightcode`. If it is taken, use a scoped name such as `@irad-bouzidi/nightcode`. |

---

## 1. Server deployment (VPS)

### 1.1 Provision the VPS

- Ubuntu 24.04 LTS, at least 2 vCPU and 2–4 GB RAM (Hetzner, DigitalOcean, OVH, etc.).
- DNS: point an `A` record for `api.<your-domain>` at the VPS IP.
- Base hardening:
  ```bash
  adduser deploy && usermod -aG sudo deploy
  # copy your SSH key to deploy, then in /etc/ssh/sshd_config:
  #   PasswordAuthentication no
  #   PermitRootLogin no
  ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
  apt install -y fail2ban unattended-upgrades
  ```
- Install Docker Engine and the compose plugin.

### 1.2 Containerize the server

Add `packages/server/Dockerfile`. Build it from the repo root because the server needs the workspace packages:

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/cli/package.json packages/cli/
COPY packages/database/prisma packages/database/prisma
COPY packages/database/prisma.config.ts packages/database/
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY package.json ./
COPY packages/server packages/server
COPY packages/shared packages/shared
COPY packages/database packages/database
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER bun
CMD ["bun", "run", "packages/server/src/index.ts"]
```

Notes:
- `postinstall` runs `prisma generate`. Make sure `packages/database/generated/` is not excluded from the final image. Add a `.dockerignore` that excludes `.env`, `node_modules`, `**/dist`, and `.git`.
- Optional: run `bun build --target bun` on the server to get a smaller image. Running from source is simpler and works because workspace packages export `src/*.ts`.
- Add a `GET /health` route (unauthenticated, keep it chained) for health checks.

### 1.3 Production compose stack

Add `deploy/docker-compose.prod.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nightcode
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: nightcode
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nightcode -d nightcode"]
      interval: 5s
      retries: 10
    # no "ports:" section, so Postgres is never exposed publicly

  server:
    image: ghcr.io/irad-bouzidi/nightcode-server:${TAG:-latest}
    restart: unless-stopped
    env_file: .env.production
    depends_on:
      postgres: { condition: service_healthy }
    expose: ["3000"]

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [server]

volumes: { pgdata: {}, caddy_data: {} }
```

`deploy/Caddyfile` (Caddy gets and renews Let's Encrypt certificates automatically):

```
api.<your-domain> {
    reverse_proxy server:3000 {
        flush_interval -1          # don't buffer streamed chat responses (SSE)
        transport http {
            read_timeout 300s      # matches idleTimeout: 255 on long tool round-trips
        }
    }
}
```

`/opt/nightcode/.env.production` on the VPS (mode 0600, never committed):

```
DATABASE_URL=postgresql://nightcode:<POSTGRES_PASSWORD>@postgres:5432/nightcode
CLERK_FRONTEND_API=https://<prod-instance>.clerk.accounts.dev
CLERK_OAUTH_CLIENT_ID=...
CLERK_OAUTH_CLIENT_SECRET=...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
JWT_SECRET=<openssl rand -hex 32>
API_URL=https://api.<your-domain>
```

### 1.4 Database migrations

1. Locally, against a fresh DB, create a baseline migration:
   ```bash
   cd packages/database
   bunx --bun prisma migrate dev --name init
   ```
   Commit `prisma/migrations/`.
2. In prod, run migrations before each deploy:
   ```bash
   docker compose run --rm server sh -c "cd packages/database && bunx --bun prisma migrate deploy"
   ```
3. From now on, make schema changes with `migrate dev` and stop using `db push`.

### 1.5 Clerk production setup

- Create a **production** Clerk instance with live keys and a custom domain if needed.
- Recreate the OAuth application (see README) and set its redirect URI to `https://api.<your-domain>/auth/callback`.
- The local CLI callback port still travels in `state`, so no other redirect URIs are needed.

### 1.6 CI/CD for the server (GitHub Actions)

`.github/workflows/server.yml`, triggered on pushes to `main` that touch `packages/{server,shared,database}/**`:

1. `bun install --frozen-lockfile`
2. `bunx tsc --noEmit -p packages/server` (and `shared`, `database`)
3. Build the Docker image and push it to `ghcr.io/irad-bouzidi/nightcode-server:{sha,latest}`.
4. SSH deploy (`appleboy/ssh-action`, using the `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY` secrets):
   ```bash
   cd /opt/nightcode
   export TAG=<sha>
   docker compose -f docker-compose.prod.yml pull server
   docker compose -f docker-compose.prod.yml run --rm server sh -c "cd packages/database && bunx --bun prisma migrate deploy"
   docker compose -f docker-compose.prod.yml up -d server
   curl -fsS https://api.<your-domain>/health
   ```
5. Rollback: redeploy the previous `TAG`.

### 1.7 Operations

- **Backups:** a nightly cron job runs `docker compose exec -T postgres pg_dump -U nightcode nightcode | gzip > /backups/nc-$(date +%F).sql.gz` and syncs it off-box (S3, B2, or a Hetzner Storage Box). Keep 14 days. Test a restore once.
- **Logs:** set `docker compose logs` rotation in `/etc/docker/daemon.json` (`"log-opts": {"max-size": "10m", "max-file": "5"}`).
- **Monitoring:** an uptime check on `/health` (UptimeRobot or Better Stack). Optionally Sentry in `app.onError`.
- **Security:** user AI keys arrive in the `x-nightcode-provider-key` header. Never log request headers, and keep TLS mandatory. Consider basic rate limiting on `/chat` and `/auth`.

---

## 2. CLI distribution (npm)

### 2.1 Choose the package name and npm account

- Run `npm view nightcode`. If the name is free, use `nightcode`. Otherwise use `@irad-bouzidi/nightcode` (scoped public packages need `--access public`).
- Create an npm account, enable 2FA, and create a **granular automation token** limited to this package. Store it as the `NPM_TOKEN` GitHub secret. Better: use npm **Trusted Publishing** (OIDC from GitHub Actions), which needs no token and adds provenance.

### 2.2 Bake production config into the build

Replace the runtime `.env` loading with build-time defines. Add `packages/cli/src/lib/env.ts`:

```ts
// Build-time values (replaced by bun build --define); env vars still override for local dev.
declare const __API_URL__: string;
declare const __CLERK_FRONTEND_API__: string;
declare const __CLERK_OAUTH_CLIENT_ID__: string;

export const env = {
  apiUrl: process.env.API_URL ?? (typeof __API_URL__ !== "undefined" ? __API_URL__ : "http://localhost:3000"),
  clerkFrontendApi: process.env.CLERK_FRONTEND_API ?? (typeof __CLERK_FRONTEND_API__ !== "undefined" ? __CLERK_FRONTEND_API__ : undefined),
  clerkClientId: process.env.CLERK_OAUTH_CLIENT_ID ?? (typeof __CLERK_OAUTH_CLIENT_ID__ !== "undefined" ? __CLERK_OAUTH_CLIENT_ID__ : undefined),
};
```

Use `env` in `api-client.ts` and `oauth.ts`. Add a production build script:

```json
"build:prod": "bun build src/index.tsx --outdir dist --target bun --minify --external @opentui/core --external @opentui/react --define __API_URL__='\"https://api.<your-domain>\"' --define __CLERK_FRONTEND_API__='\"https://<prod>.clerk.accounts.dev\"' --define __CLERK_OAUTH_CLIENT_ID__='\"<client-id>\"'"
```

(In CI, read these from repository variables instead of hardcoding them.)

Keep `@opentui/*` **external**. They load platform-specific native libraries (`@opentui/core-<os>-<arch>`) through optional dependencies, and npm must resolve those on the user's machine. Bundle everything else, including `@nightcode/shared`, so no `workspace:*` dependency reaches npm.

### 2.3 Publishable package layout

Create a publish directory such as `packages/cli/npm/`, assembled by a script:

```
npm/
  package.json
  bin/nightcode        # #!/usr/bin/env bun  ->  import "../dist/index.js"
  dist/index.js        # bundled output
  README.md
  LICENSE
```

`npm/package.json`:

```json
{
  "name": "nightcode",
  "version": "0.1.0",
  "description": "Terminal-based AI coding agent",
  "type": "module",
  "bin": { "nightcode": "bin/nightcode" },
  "files": ["bin", "dist", "README.md", "LICENSE"],
  "engines": { "bun": ">=1.2.0" },
  "dependencies": {
    "@opentui/core": "^0.1.97",
    "@opentui/react": "^0.1.97",
    "react": "^19.2.4"
  },
  "repository": { "type": "git", "url": "git+https://github.com/irad-bouzidi/night-code.git" },
  "license": "MIT",
  "keywords": ["ai", "cli", "coding-agent", "terminal"]
}
```

The new `bin/nightcode` must not load dotenv or reference the repo `.env`:

```js
#!/usr/bin/env bun
import "../dist/index.js";
```

Add a friendly check for users who run it without Bun. Ship a tiny Node shim as the bin instead: it checks for `bun` on `PATH`, prints install instructions if it is missing, and otherwise spawns `bun dist/index.js` with inherited stdio.

### 2.4 Phase A release (requires Bun)

1. `bun run build:prod`, then assemble `npm/`.
2. Smoke test locally:
   ```bash
   cd packages/cli/npm && npm pack
   npm install -g ./nightcode-0.1.0.tgz
   cd /tmp && nightcode        # login, /provider, send a prompt, run a tool
   ```
3. Publish:
   ```bash
   npm publish --access public --provenance
   ```
4. User install docs:
   ```bash
   curl -fsSL https://bun.sh/install | bash   # prerequisite
   npm install -g nightcode                   # or: bun add -g nightcode
   nightcode
   ```

### 2.5 Phase B: standalone binaries (no Bun needed)

Use the esbuild/Biome pattern:

- `bun build --compile --target=bun-<os>-<arch>` for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `windows-x64`, each in a CI matrix on a native runner so OpenTUI's native library is embedded correctly. Verify that OpenTUI's native lib loads from a compiled binary first. If it doesn't, ship the `.so`/`.dylib` next to the binary.
- Publish one package per platform, e.g. `@nightcode/cli-linux-x64`, each with `"os"`/`"cpu"` fields and holding only the binary.
- The main `nightcode` package lists them as `optionalDependencies`. Its bin is a small Node script that resolves the matching platform package and `execFileSync`s the binary.
- Also attach the binaries to GitHub Releases, and optionally add a `curl | sh` installer and a Homebrew tap.

### 2.6 Release automation

`.github/workflows/release-cli.yml`, triggered on tags `cli-v*`:

1. Checkout, `oven-sh/setup-bun`, `bun install --frozen-lockfile`.
2. `bunx tsc --noEmit -p packages/cli`.
3. `build:prod` with defines from repository **variables** (`PROD_API_URL`, `PROD_CLERK_FRONTEND_API`, `PROD_CLERK_OAUTH_CLIENT_ID`).
4. Assemble `npm/` and set `version` from the tag.
5. `actions/setup-node` with `registry-url: https://registry.npmjs.org`, then `npm publish --access public --provenance` (with `id-token: write` permission for trusted publishing).
6. Create a GitHub Release with a changelog.

Versioning: semver, starting at `0.x` while the API is unstable. Optionally use Changesets.

### 2.7 Client/server compatibility

Once the CLI is public, old versions stay in the wild:
- Make server changes backward-compatible, or version the routes.
- Have the CLI send an `x-nightcode-version` header. The server can return `426 Upgrade Required` below a minimum version, and the CLI shows "run `npm i -g nightcode@latest`".
- Optionally check `https://registry.npmjs.org/nightcode/latest` on startup (cached daily) and show an update toast.

---

## 3. Order of execution (checklist)

**Prep (code changes)**
- [ ] `PORT` env in `server/src/index.ts` and a `/health` route
- [ ] Baseline Prisma migration committed
- [ ] `cli/src/lib/env.ts` with build-time defines; `api-client.ts` and `oauth.ts` use it
- [ ] `build:prod` script and an npm package assembly script
- [ ] New production bin without dotenv
- [ ] `Dockerfile`, `.dockerignore`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`
- [ ] LICENSE and a user-facing README for npm

**Infra**
- [ ] VPS provisioned and hardened, Docker installed
- [ ] DNS `api.<domain>` → VPS
- [ ] Clerk production instance and OAuth app with the prod redirect URI
- [ ] `/opt/nightcode/.env.production` created (0600)
- [ ] First deploy: `migrate deploy` → `up -d` → `curl https://api.<domain>/health`
- [ ] Backups cron and an uptime monitor

**CI/CD**
- [ ] GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`; variables: `PROD_*`
- [ ] `server.yml` workflow (build → GHCR → SSH deploy)
- [ ] npm account with 2FA and a trusted publisher configured for the repo
- [ ] `release-cli.yml` workflow

**Release**
- [ ] `npm pack` smoke test against the prod API from a clean machine/container
- [ ] Tag `cli-v0.1.0` → published to npm
- [ ] Verify `npm install -g nightcode && nightcode` end-to-end (login, `/provider`, chat, tool calls in BUILD mode)
- [ ] Phase B: compiled per-platform binaries
