# How to Add the Bot to Your Telegram Channel

## Prerequisites
1. You must be an admin of the Telegram channel

## Step-by-Step Instructions

### 1. Add Bot to Channel
1. Open your Telegram channel
2. Click on the channel name at the top
3. Click "Administrators" or "Manage Channel"
4. Click "Add Administrator"
5. Search for bot username (`@shared_chess_bot`)
6. Select your bot
7. **Important:** Grant these permissions:
   - ✅ **Post Messages** (Required)
   - ✅ **Edit Messages** (Recommended - for automatic board updates)
   - ✅ **Delete Messages** (Optional)
8. Click "Done"

### 2. Start a Game in the Channel
1. In your channel, type: `/newgame`
2. The bot will post the chess board image to the channel
3. The board appears as a read-only image in the channel
4. Users in the channel can see the game status

### 3. Users Join and Play the Game

**In the Channel (Read-Only View):**
- Users can see the board with pieces, move history, captured pieces
- Users can see which team it's currently their turn
- Board updates automatically after each move

**In Private Chat with Bot (Play Actions):**
1. Users open their **private chat** with the bot
2. Users type: `/start` 
3. Click "Join Game" button
4. Choose their team: ⚪ Join White or ⚫ Join Black
5. Users are now part of that team
6. When it's their team's turn, users can see move buttons
7. Users click the move buttons to make moves
8. Bot automatically updates the channel board after each move

### 4. How the Game Works

**Game Flow:**
- Channel shows the game board (read-only for spectators)
- Private chats allow players to make moves
- When it's your team's turn, you'll see available move buttons
- Make a move by clicking the button (e.g., "e2→e4")
- Bot posts move notification and updates channel board
- Game continues with alternating turns

**Team System:**
- Multiple players can join each team (White or Black)
- Any team member can make a move when it's their team's turn
- Recent moves show which player made each move
- Teams can see captured pieces and point values

**Resigning:**
- Click "Resign" button when it's your team's turn
- Requires majority vote from your team to resign
- Bot shows vote count: "White team: 2/3 votes needed"

### 5. Bot Updates the Channel
- After each move, bot **edits** the existing message in the channel
- Board updates show new piece positions
- Move history updates (last 5 moves shown)
- Captured pieces track updates
- All channel members see the latest game state

## Important Notes

⚠️ **Key Rules:**
- The bot **must be an admin** with "Post Messages" permission
- Users **can only make moves** from their private chat with the bot
- Channel board is **read-only** (viewing only, no buttons work there)
- Only **one active game per channel** at a time
- Players **must choose a team** before they can move
- Move buttons **only appear when it's your team's turn**
- Multiple players can join the same team
- Each team needs **majority vote** to resign

## Quick Test Guide

1. ✅ Add your bot to a test channel as admin
2. ✅ Type `/newgame` in the channel - board should appear
3. ✅ Open private chat with bot, type `/start`
4. ✅ Click "Join Game" → Choose a team
5. ✅ Try clicking a move button - bot updates channel!

## Troubleshooting

### Bot can't post in channel:
- ❌ Check bot is added as admin (not just member)
- ❌ Verify "Post Messages" permission is enabled
- ❌ Make sure you typed `/newgame` in the **channel** (not private chat)
- ❌ Try removing and re-adding the bot as admin

### Can't make moves:
- ❌ Use **private chat** with the bot (not channel or group chat)
- ❌ Type `/start` first to see the game menu
- ❌ Choose a team (White or Black) before trying to move
- ❌ Wait for your team's turn - buttons only appear when it's your turn
- ❌ Check you're clicking buttons, not typing commands in channel

### Board not updating in channel:
- ❌ Make sure bot has "Edit Messages" permission
- ❌ Check if the bot message got deleted or edited by someone else
- ❌ Try starting a new game with `/newgame`

### Team already has player error:
- This is expected - multiple people can join the same team
- The team with the most players will have more votes if resign is needed

## Commands Reference

**In Channel:**
- `/newgame` - Start a new game (requires admin)

**In Private Chat with Bot:**
- `/start` - Show main menu
- `/join` - Join current game
- `/move e2e4` - Make a move (text command alternative)
- `/resign` - Vote to resign (need team majority)
- `/help` - Show help

## Features

✅ **Visual Board** - Beautiful image-based chess board  
✅ **Interactive Buttons** - Click to make moves (no typing needed!)  
✅ **Team System** - Join White or Black team  
✅ **Move History** - See last 5 moves, full history available  
✅ **Captured Pieces** - Track captures with point values  
✅ **Majority Voting** - Teams vote to resign  
✅ **Auto-Rotation** - Board flips perspective for Black's turn  
✅ **Multiple Channels** - Support for multiple channels with separate games  
✅ **Real-time Updates** - Channel board updates after every move  

## Need Help?

If you encounter issues not covered here:
1. Check that your bot token is correct in `.env` file
2. Restart the bot: `npm start` in your terminal
3. Make sure bot is running with `node index.js`
4. Check bot logs for error messages

