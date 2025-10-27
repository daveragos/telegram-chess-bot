# Telegram Chess Bot

A Telegram bot that allows users to play chess on a shared board. Any user can start a game, join an existing game, and make moves from available legal moves.

## Features

- 🎮 Start new chess games
- 👥 Multiple players can join and play
- ✅ Automatic move validation
- 📊 Beautiful image-based board visualization
- 🎯 Interactive buttons for all legal moves
- 🔄 Refresh button to update the board
- ❌ Resign option to end games
- 🎯 Check detection and game-over detection
- 📝 Turn-based gameplay

## Prerequisites

- Node.js (v14 or higher)
- A Telegram account
- npm (comes with Node.js)

## Setup

### 1. Get a Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the bot token you receive

### 2. Install Dependencies

The packages are already installed, but if you need to reinstall:

```bash
npm install
```

### 3. Configure Environment Variables

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and paste your bot token:
   ```
   BOT_TOKEN=your_bot_token_here
   ```

### 4. Run the Bot

```bash
node index.js
```

You should see: `🤖 Chess Bot is running...`

## Usage

1. Open Telegram and find your bot
2. Send `/start` to see available commands
3. In a group chat, send `/newgame` to start a game
4. Anyone can use `/join` to join the game
5. **Make moves by clicking the buttons** - All legal moves are shown as clickable buttons!
6. Click 🔄 to refresh the board or ❌ to resign
7. You can still use `/move` command if you prefer (e.g., `/move e2e4`)

## Commands

- `/start` - Welcome message and command list
- `/newgame` - Start a new chess game
- `/join` - Join the current game or view status
- `/move <move>` - Make a move (e.g., `/move e2e4`)
- `/resign` - End the current game
- `/help` - Show help message

## Move Notation

- Use standard notation: from-square to-square
- Example: `e2e4` moves from e2 to e4
- For pawn promotion: `e7e8q` (promotes to queen)

## Technologies Used

- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) - Telegram Bot API
- [chess.js](https://github.com/jhlywa/chess.js) - Chess game logic and validation
- [sharp](https://github.com/lovell/sharp) - Image processing for chess board rendering
- dotenv - Environment variable management

## How It Works

1. The bot uses `node-telegram-bot-api` to listen for messages
2. Game state is stored in a `Map` (in-memory storage)
3. `chess.js` handles all chess rules and validation
4. The board is converted to emoji representation for easy display
5. Each chat maintains its own independent game

## Learning Notes

For a mobile developer learning JavaScript:

- **require()**: Similar to imports in other languages; loads modules
- **Map**: JavaScript's key-value data structure
- **Arrow Functions**: `() => {}` syntax for function declarations
- **Template Literals**: Backtick strings with `${variable}` interpolation
- **Array Methods**: `.forEach()`, `.map()`, `.includes()` are common array operations
- **Event Listeners**: `.onText()` listens for specific message patterns
- **async/await**: For handling asynchronous operations (used by the bot library)

## License

ISC

