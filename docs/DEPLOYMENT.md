# AGORA OS — Deployment Guide

How to get the colony running publicly, persistently, and with the full Chronicler.

---

## Option A — Railway (recommended, ~15 min)

Railway gives you a Postgres database and a Node.js server in one project, free tier available.

### 1. Create the project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Connect your GitHub and select the `agora-os` repository

### 2. Add a Postgres database

In your Railway project dashboard:
- **New** → **Database** → **Add PostgreSQL**
- Railway will set `DATABASE_URL` automatically in your environment

### 3. Set environment variables

In Railway: **Variables** tab → paste these (fill in your actual keys):

```
PORT=3001
TICK_MS=800
SIM_SEED=agora-genesis
ANTHROPIC_API_KEY=sk-ant-...
CHRONICLER_MODEL=claude-opus-4-5-20251101
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
```

### 4. Set start command

In Railway: **Settings** → **Deploy** → **Start Command**:
```
pnpm db:migrate && pnpm start
```

### 5. Get your public URL

Railway will assign a URL like `https://agora-os-production.up.railway.app`. Update the `og:url` and Twitter card meta tags in your HTML files to match.

---

## Option B — Render (free tier)

1. [render.com](https://render.com) → New → **Web Service** → Connect GitHub repo
2. **Build command:** `pnpm install`
3. **Start command:** `pnpm db:migrate && pnpm start`
4. Add a **PostgreSQL** database service in Render
5. Set env vars in the Render dashboard (same list as Railway above)
6. Free tier spins down after inactivity — upgrade to Starter ($7/mo) for always-on

---

## Option C — VPS (DigitalOcean / Hetzner / Contabo)

For full control. Hetzner CX22 (~€4/mo) runs AGORA OS fine.

### 1. Provision server

```bash
# Ubuntu 24.04 LTS
apt update && apt upgrade -y
apt install -y curl git postgresql postgresql-contrib
```

### 2. Install Node.js + pnpm

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
npm install -g pnpm pm2
```

### 3. Set up Postgres

```bash
sudo -u postgres psql -c "CREATE DATABASE agora_os;"
sudo -u postgres psql -c "CREATE USER agora WITH PASSWORD 'yourpassword';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE agora_os TO agora;"
```

### 4. Clone and configure

```bash
git clone https://github.com/your-org/agora-os /opt/agora-os
cd /opt/agora-os
pnpm install
cp .env.example .env
nano .env  # fill in DATABASE_URL, API keys, etc.
```

### 5. Migrate and start with PM2

```bash
pnpm db:migrate

# Start with PM2 (auto-restart on crash)
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup   # follow the printed command to register with systemd
```

### 6. Nginx reverse proxy (optional, for HTTPS)

```bash
apt install -y nginx certbot python3-certbot-nginx

# /etc/nginx/sites-available/agora-os
server {
    listen 80;
    server_name agora-os.xyz;

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
        # Critical for SSE — disable buffering
        proxy_buffering    off;
        proxy_read_timeout 24h;
    }
}

certbot --nginx -d agora-os.xyz
```

---

## Setting up the Chronicler (Phase 4)

### 1. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Set `ANTHROPIC_API_KEY=sk-ant-...` in your environment

### 2. Create a Twitter/X developer app

1. Go to [developer.twitter.com](https://developer.twitter.com) → Projects → Add App
2. Under **User authentication settings**:
   - App permissions: **Read and Write**
   - Type: **Web App, Automated App or Bot**
   - Callback URL: `https://agora-os.xyz/callback` (anything, not used)
3. Copy:
   - API Key → `TWITTER_API_KEY`
   - API Secret → `TWITTER_API_SECRET`
4. Under **Keys and Tokens** → Generate **Access Token and Secret**:
   - Access Token → `TWITTER_ACCESS_TOKEN`
   - Access Token Secret → `TWITTER_ACCESS_SECRET`
5. Set all four in your environment

### 3. Verify it works

Start the server and watch the logs:

```bash
pnpm start
# After 60 ticks (~48 seconds at 800ms/tick), look for:
# [chronicler] cycle 1 dispatch:
#   "cycle 1. 50 agents entered the polis. 3 have already defaulted on their life tax."
# [chronicler] tweeted: https://twitter.com/i/web/status/...
```

If you see `ANTHROPIC_API_KEY not set`, the env var isn't loaded. Try:
```bash
export $(cat .env | grep -v '^#' | xargs) && pnpm start
```

---

## Database: Neon (free Postgres, no server needed)

If you don't want to manage Postgres yourself:

1. Go to [neon.tech](https://neon.tech) → Create project → Free tier
2. Copy the connection string (looks like `postgres://user:pass@ep-xxx.neon.tech/agora_os?sslmode=require`)
3. Set `DATABASE_URL=postgres://...` in your environment
4. Run `pnpm db:migrate` to apply the schema

---

## Environment variables reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3001` | HTTP port |
| `TICK_MS` | No | `800` | ms per simulation tick |
| `SIM_SEED` | No | `agora-genesis` | Deterministic simulation seed |
| `DATABASE_URL` | For persistence | — | Postgres connection string |
| `ANTHROPIC_API_KEY` | For Chronicler | — | Anthropic API key |
| `CHRONICLER_MODEL` | No | `claude-opus-4-5-20251101` | Model for Chronicler |
| `TWITTER_API_KEY` | For Twitter | — | Twitter app API key |
| `TWITTER_API_SECRET` | For Twitter | — | Twitter app API secret |
| `TWITTER_ACCESS_TOKEN` | For Twitter | — | Twitter account access token |
| `TWITTER_ACCESS_SECRET` | For Twitter | — | Twitter account access secret |

---

## Logs

With PM2:
```bash
pm2 logs agora-os            # all logs
pm2 logs agora-os --err      # errors only
pm2 logs agora-os --lines 50 # last 50 lines
pm2 monit                     # live dashboard
```

Without PM2:
```bash
pnpm start 2>&1 | tee logs/agora-os.log
```

---

## Troubleshooting

**Colony dies immediately**
Check `DATABASE_URL` is correct and `pnpm db:migrate` was run. Check `pnpm typecheck` passes.

**Chronicler not posting**
Check `ANTHROPIC_API_KEY` is set. Look for `[chronicler]` lines in logs. After 60 ticks the first dispatch fires — at 800ms/tick that's ~48 seconds after start.

**SSE connection drops**
If using Nginx, ensure `proxy_buffering off` and `proxy_read_timeout 24h` are set. SSE connections are long-lived — default proxy timeouts will kill them.

**viz.html shows SIM instead of LIVE**
The API server isn't reachable. Check it's running on the correct port and that CORS is configured if serving from a different origin.
