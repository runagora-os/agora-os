/**
 * PM2 process config for AGORA OS.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 *   pm2 logs agora-os
 *   pm2 monit
 */

const fs = require("fs");
const path = require("path");

// Parse .env file manually — no external dependencies
function loadEnv(envPath) {
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv(path.join(__dirname, ".env"));

module.exports = {
  apps: [
    {
      name: "agora-os",
      script: "node",
      args:   "--import tsx/esm api/server.ts",
      cwd:    __dirname,

      env_production: {
        NODE_ENV:     "production",
        PORT:         env.PORT         || "3001",
        TICK_MS:      env.TICK_MS      || "800",
        DATABASE_URL: env.DATABASE_URL,
        SIM_SEED:     env.SIM_SEED     || "agora-genesis",
        ANTHROPIC_API_KEY:     env.ANTHROPIC_API_KEY     || "",
        CHRONICLER_MODEL:      env.CHRONICLER_MODEL      || "",
        TWITTER_API_KEY:       env.TWITTER_API_KEY       || "",
        TWITTER_API_SECRET:    env.TWITTER_API_SECRET    || "",
        TWITTER_ACCESS_TOKEN:  env.TWITTER_ACCESS_TOKEN  || "",
        TWITTER_ACCESS_SECRET: env.TWITTER_ACCESS_SECRET || "",
      },

      autorestart:        true,
      watch:              false,
      max_memory_restart: "512M",
      restart_delay:      3000,

      out_file:        path.join(__dirname, "logs/agora-os.out.log"),
      error_file:      path.join(__dirname, "logs/agora-os.err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs:      true,
    },
  ],
};
