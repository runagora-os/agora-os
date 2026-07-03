FROM node:22-slim

# Install pnpm directly (avoids corepack version range issues)
RUN npm install -g pnpm@11

WORKDIR /app

# Copy manifest + lockfile + workspace config (needed for allowBuilds)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 3001

CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
