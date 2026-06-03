# 🚀 Deployment Guide: Victus Cloud Discord Bot

This guide explains how to host the Victus Cloud Discord bot on an external server (VPS, Pterodactyl, or container platform).

## 📋 Prerequisites
- **Node.js**: v18 or higher (if hosting directly)
- **Docker & Docker Compose** (if using containerization)
- **Supabase Project**: Ensure your database is initialized and your `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are ready.
- **Discord Bot**: Created in the Developer Portal with necessary Gateway Intents (Guilds, Members, Messages).

---

## 🐳 Option 1: Hosting with Docker (Recommended)
Docker is the most stable and easiest way to ensure the bot runs exactly as intended.

### 1. Prepare Environment
Copy `.env.example` to `.env` and fill in your production credentials:
```bash
cp .env.example .env
# Edit .env and fill in values
```

### 2. Launch with Docker Compose
Run the following command to build and start the bot in the background:
```bash
docker-compose up -d --build
```

### 3. Check Logs
Monitor the bot to ensure it connects successfully:
```bash
docker-compose logs -f
```

---

## 🛠️ Option 2: Hosting Directly (Node.js)
If you prefer not to use Docker, follow these steps:

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Bot
Compile the TypeScript code to JavaScript:
```bash
npm run build
```

### 3. Start in Production
Use `pm2` or a similar process manager to keep the bot running:
```bash
# Using PM2
pm2 start dist/index.js --name victus-bot

# Using Node directly
npm start
```

---

## 🔄 Updating the Bot
When you push updates to your server:

1. **Docker**: `docker-compose up -d --build` (it will rebuild the `dist` folder inside the container).
2. **Node**: `npm run build` followed by a process restart.

## 📁 File Structure for Production
The following files are essential for your production server:
- `package.json` & `package-lock.json`
- `tsconfig.json`
- `src/` (required for Docker builds)
- `dist/` (if hosting directly without Docker)
- `.env`
# Pterodactyl Startup

For the standard Pterodactyl NodeJS egg, set:

```bash
MAIN_FILE=index.js
AUTO_UPDATE=1
```

The repository includes a root `index.js` launcher for Pterodactyl. It checks for `dist/index.js`, runs `npm run build` if the compiled output is missing, and then imports the compiled bot.

If you use a custom startup command instead, use:

```bash
npm install && npm run build && npm start
```

Common crash:

```text
Error: Cannot find module './index.js'
```

That means the panel is trying to boot a root `index.js` that was not present, or the server files are out of date. Pull the latest repository files and restart.
