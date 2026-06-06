# Victus Cloud Discord Bot

A next-generation Discord bot that functions as a full extension of the Victus Cloud platform.

## Features

- 🔐 **Secure Account Linking** - Link Discord to Victus Cloud account
- 🎮 **Server Management** - Start/stop/restart servers, send console commands
- 💳 **Billing Integration** - View services, invoices, billing status
- 🎫 **Ticketing System** - Create and manage support tickets
- 📢 **Announcements** - Admin broadcast system
- 🤖 **AI Support** - Context-aware support suggestions

## Setup

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and name it "Victus Cloud"
3. Go to "Bot" section and click "Add Bot"
4. Copy the bot token
5. Enable these Privileged Gateway Intents:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
6. Go to OAuth2 > URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Administrator` (or fine-tune as needed)
7. Use generated URL to invite bot to your server

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Register Slash Commands

```bash
npm run register
```

### 5. Start the Bot

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### Pterodactyl Deployment

Use these startup settings in the NodeJS egg:

```bash
MAIN_FILE=index.js
AUTO_UPDATE=1
```

The root `index.js` launcher builds `src/index.ts` into `dist/index.js` automatically when the compiled output is missing, then starts the bot. If you prefer a fully compiled startup, set the startup command to:

```bash
npm install && npm run build && npm start
```

Do not set `MAIN_FILE` to `index.js` unless this root launcher exists in the server files. The bot source entrypoint is `src/index.ts`, and the compiled production entrypoint is `dist/index.js`.

## Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/link` | Link Discord to Victus Cloud account |
| `/unlink` | Unlink your account |
| `/servers` | View your servers |
| `/server info` | View server details |
| `/server power` | Start/stop/restart server |
| `/server console` | Send console command |
| `/services` | View active services |
| `/invoices` | View your invoices |
| `/ask` | Ask the Victus Cloud AI assistant |
| `/ticket` | Create support ticket |
| `/help` | Show help |

### Groq AI Chat

The bot uses Groq's OpenAI-compatible chat API for Victus Cloud support answers.

```bash
GROQ_API_KEY=your_groq_api_key
GROQ_BASE_URL=https://api.groq.com/openai
GROQ_MODEL=llama-3.1-8b-instant
GROQ_TEMPERATURE=0.35
GROQ_MAX_TOKENS=700
VICTUS_AI_SYSTEM_PROMPT=
```

After changing AI env vars, restart the bot so it can reload configuration.

`GROQ_API_KEY` is the only required AI variable. The base URL and model already default to `https://api.groq.com/openai` and `llama-3.1-8b-instant`.

The bot also auto-syncs slash commands on startup unless `DISCORD_AUTO_REGISTER_COMMANDS=false`, so `/ask` should appear after restart. If `DISCORD_GUILD_ID` is set, commands update instantly for that guild; global commands can take up to 1 hour.

To make the AI answer normal messages in a support channel:

```bash
/config ai-channel channel:#ai-support
```

To disable automatic channel replies:

```bash
/config ai-disable
```

If your Pterodactyl panel shows `preg_match(): Unknown modifier '-'`, do not add regex validation rules for Groq values. Use plain `nullable|string` style validation, or only set `GROQ_API_KEY` and let the bot defaults handle the model/base URL.

### Admin Commands

| Command | Description |
|---------|-------------|
| `/admin search` | Search users |
| `/admin announce` | Broadcast announcement |
| `/admin link` | Force link accounts |
| `/admin sync` | Trigger system sync |

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Environment config
├── deploy-commands.ts    # Slash command registration
├── commands/             # Command handlers
├── events/               # Event handlers
├── components/           # Button/Modal handlers
├── services/             # API integrations
├── middleware/           # Command middleware
├── embeds/               # Embed builders
├── utils/                # Utilities
└── types/                # TypeScript types
```

## License

Proprietary - Victus Cloud
