# Victus Cloud Discord Bot

A next-generation Discord bot that functions as a full extension of the Victus Cloud platform.

## Features

- **Curse-word moderation** - Optional multilingual profanity filter, warning logs, and escalation policy
- **Currency and Pricing Utilities** - `/currency` conversion GUI and `/pricing` website-synced catalog

- 🔐 **Secure Account Linking** - Link Discord to Victus Cloud account
- 🎮 **Server Management** - Start/stop/restart servers, send console commands
- 💳 **Billing Integration** - View services, invoices, billing status
- 🎫 **Ticketing System** - Create and manage support tickets
- 📢 **Announcements** - Admin broadcast system
- 🤖 **AI Support** - Context-aware support suggestions
- 🪙 **Community Coins** - Keep the bot in your Discord so Victus can verify member joins and reward COINS (`/community-coins` to publish)

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

### Player versus player games

Use `/rps opponent:@player amount:10`, `/tictactoe opponent:@player amount:10`, or `/connect4 opponent:@player amount:10`. `/battle opponent:@player wager:10` uses the same protected payment flow for pet battles.

The amount is the stake **per player**, from 1 to 5,000 COINS (pet battles start at 5). The opponent must accept before either balance is charged. Once both Paymenter deductions succeed, the match begins. A 10-coin match deducts 10 from each player and pays the winner 20; the winner gains 10 overall and the loser loses 10. Draws refund both stakes. There is no house fee or new coin reward.

RPS choices are hidden until the result. Board games enforce turns and reject old board buttons. Each player has 60 seconds to act; a missed turn or forfeit awards the pot to the opponent. If neither RPS player chooses, both are refunded. Unaccepted challenges expire after two minutes without deductions. Players can participate in one match at a time, across all servers, with a **10-second cooldown** after completion.

Matches and payment references are saved in `data/pvp-matches.json` before coin mutations. Preserve this file on persistent storage and run one active bot process. Startup and a five-second recovery worker resume confirmed funding, payouts, refunds, and expired matches. An ambiguous payment stays pending and retries the same reference. Account destinations are fixed at acceptance, so unlinking cannot redirect a refund or payout. Failed second-player funding refunds the confirmed first stake. The authoritative wallet is Paymenter; website mirrors and history are updated afterward.

### Mining, selling and raids

- `/mine` gives one drop immediately and leaves a reusable **Mine** button. The same one-second anti-spam guard applies to buttons, `/mine`, and `/rpg mine`. Fishing has a reusable button and a five-second interval.
- `/sell` opens a material picker. `/sell item:iron quantity:10` sells only the selected amount. Both `/sell` and `/rpg sell` support the same options. `category:common` sells coal, iron, and gold while preserving diamonds and netherite; `category:fish` keeps every ore. Selling all ores or everything requires an explicit category selection.
- Sales consume whole-coin lots, keeping fractional leftovers: requesting eight coal sells five for one coin and keeps three. The inventory shows progress toward equipment upgrades, and crafting cannot downgrade an existing tool.
- `/attack` and `/cast` share a persistent 15-second player cooldown across servers. A defeated or expired boss rests for one hour. Total rewards never exceed its displayed pool. Failed payouts remain pending and retry during raid maintenance, including after a later raid has started.

RPG sales reserve inventory in a durable journal before paying coins, using a stable payment reference for recovery. Keep the `data/` directory on persistent storage and run **one active bot process** for inventory operations. Do not delete `data/expansion-store.json` during deployment. Raid updates additionally use database compare-and-swap protection. Legacy raids stored locally with invalid database IDs are imported using valid UUIDs without resetting the raid's cooldown. Database outages stop game mutations instead of falling back to stale inventories or spawning a fresh boss.

### Official staff access

`DISCORD_SUPPORT_GUILD_ID` must identify the official Victus Cloud server. Platform admin commands, coin adjustments, resource reward approvals, GTN/Unscramble reward and event controls, staff AI, diagnostics, and sensitive announcement controls require a freshly fetched member of that server with an official staff/admin role (or its owner). Supported roles are the established Victus staff role, `DISCORD_STAFF_ROLE_IDS`, and the official server's `ticket_staff_role_ids` / `ticket_admin_role_ids` settings.

External server ownership, Discord Administrator permission, bot application ownership, or a website admin flag alone do not grant platform access. Missing support-server configuration or failed membership verification denies access. Buttons, modals, and economy confirmations recheck access, so removing a staff role revokes old panels too. Ordinary server moderation permissions remain server-local.

Build and verify with `npm test`. Deploy the source and compiled output together, retain `data/`, and restart the bot. Startup auto-registration publishes the new sell options unless `DISCORD_AUTO_REGISTER_COMMANDS=false`; in that case run `npm run register` as part of deployment.

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
| `/currency` | Open the currency conversion GUI |
| `/pricing` | View the live Victus Cloud service pricing catalog |
| `/ticket` | Create support ticket |
| `/community-coins` | Set up a Community Coins listing (shows this server's ID + publish steps) |
| `/level` | View your synchronized community XP, level, rank and progress |
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

### Server entitlement roles

The bot synchronizes Victus server entitlements with Discord on startup, account linking,
guild joins, and every five minutes. The defaults can be overridden with:

```bash
DISCORD_SUPPORT_GUILD_ID=your_victus_discord_server_id
DISCORD_FREE_USER_ROLE_ID=1531675572877525082
DISCORD_PAID_CLIENT_ROLE_ID=1340607431193137296
DISCORD_ENTITLEMENT_SYNC_MINUTES=5
```

The bot role must be above both managed roles and have **Manage Roles** permission. An active
paid service always takes precedence over a free server; expired or suspended entitlements
remove their corresponding role automatically.

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

To configure optional curse-word moderation, use the admin-only commands:

```text
/config moderation-logs channel:#moderation-logs
/config moderation-enable
```

Automatic moderation warns only for words in the profanity list. Ordinary phrases and AI conduct judgments do not create warnings. A profanity warning sends a short-lived Components V2 notice, a private DM, and a staff log. Three active warnings create a service suspension; three suspensions create a ban. Use `/warn remove` or `/warn reset` to manually correct a warning record. The website admin panel exposes the same settings.

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
