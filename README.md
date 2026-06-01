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
| `/ticket` | Create support ticket |
| `/help` | Show help |

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
