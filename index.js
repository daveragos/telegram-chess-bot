require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Chess } = require('chess.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Initialize the bot with your Telegram Bot Token
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('Error: BOT_TOKEN not found in environment variables');
    console.error('Please create a .env file with your bot token');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: { autoStart: true, interval: 500 } });

// Game state storage - stores active games per channel
// Key: channelId (string), Value: { game, lastMove, players, whiteTeam, blackTeam, capturedPieces, resignVotes, drawVotes, moveHistory, channelMessageId, channelId, channelName }
const activeGames = new Map();

// Map of user chatId to channelId for quick lookup (private chats to channels)
const userToChannel = new Map();

// Piece values for captured pieces display
const pieceValues = {
    'p': 1, 'n': 3, 'b': 3, 'r': 5, 'q': 9, 'k': 0,
    'P': 1, 'N': 3, 'B': 3, 'R': 5, 'Q': 9, 'K': 0
};

const pieceSymbols = {
    'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
    'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔'
};

// Create temp directory for images
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Unicode chess pieces for SVG
const pieceUnicode = {
    'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
    'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔'
};

// Helper function to generate SVG chess board
function generateChessBoardSVG(game) {
    const board = game.board();
    const squareSize = 60;
    const boardSize = squareSize * 8;
    const padding = 40; 
    
    // Check if we should rotate the board (when it's Black's turn)
    const isBlackTurn = game.turn() === 'b';
    
    let svg = `<svg width="${boardSize + (padding * 2) + 80}" height="${boardSize + (padding * 2) + 80}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Background
    svg += `<rect width="${boardSize + (padding * 2) + 80}" height="${boardSize + (padding * 2) + 80}" fill="#f0d9b5"/>`;
    
    // Draw squares
    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            // Calculate display position (rotated if Black's turn)
            const displayRank = isBlackTurn ? (7 - rank) : rank;
            const displayFile = isBlackTurn ? (7 - file) : file;
            
            const isLight = (displayRank + displayFile) % 2 === 0;
            const color = isLight ? '#f0d9b5' : '#b58863';
            const x = file * squareSize + padding + 40;
            const y = rank * squareSize + padding + 40;
            
            svg += `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="${color}"/>`;
            
            // Add piece from the actual board position
            const square = board[displayRank][displayFile];
            if (square) {
                const pieceChar = pieceUnicode[square.color === 'w' ? square.type.toUpperCase() : square.type];
                svg += `<text x="${x + squareSize / 2}" y="${y + squareSize / 2}" font-size="${squareSize - 10}" fill="${square.color === 'w' ? 'white' : 'black'}" text-anchor="middle" dominant-baseline="central" style="text-shadow: 2px 2px 3px rgba(0,0,0,0.5);">${pieceChar}</text>`;
            }
            
            // Add coordinates on all 4 sides (adjusted for rotation)
            // Left side (ranks)
            if (file === 0) {
                const rankLabel = isBlackTurn ? (rank + 1) : (8 - rank);
                svg += `<text x="${padding + 10}" y="${y + squareSize / 2}" font-size="18" fill="#333" text-anchor="middle" dominant-baseline="central" font-weight="bold">${rankLabel}</text>`;
            }
            // Right side (ranks)
            if (file === 7) {
                const rankLabel = isBlackTurn ? (rank + 1) : (8 - rank);
                svg += `<text x="${padding + boardSize + 80}" y="${y + squareSize / 2}" font-size="18" fill="#333" text-anchor="middle" dominant-baseline="central" font-weight="bold">${rankLabel}</text>`;
            }
            // Top side (files)
            if (rank === 0) {
                const fileLabel = isBlackTurn ? String.fromCharCode(104 - file) : String.fromCharCode(97 + file);
                svg += `<text x="${x + squareSize / 2}" y="${padding + 10}" font-size="18" fill="#333" text-anchor="middle" dominant-baseline="central" font-weight="bold">${fileLabel}</text>`;
            }
            // Bottom side (files)
            if (rank === 7) {
                const fileLabel = isBlackTurn ? String.fromCharCode(104 - file) : String.fromCharCode(97 + file);
                svg += `<text x="${x + squareSize / 2}" y="${padding + boardSize + 70}" font-size="18" fill="#333" text-anchor="middle" dominant-baseline="central" font-weight="bold">${fileLabel}</text>`;
            }
        }
    }
    
    svg += `</svg>`;
    return svg;
}

// Helper function to create and send chess board with buttons
async function showGameStatus(chatId, gameState, username = '', withButtons = true) {
    const { game } = gameState;
    const isGameOver = game.isGameOver();
    const currentPlayer = game.turn() === 'w' ? 'White' : 'Black';
    
    let statusMessage = '';
    
    if (isGameOver) {
        if (game.isCheckmate()) {
            statusMessage = `🎯 Checkmate! ${currentPlayer === 'White' ? 'Black' : 'White'} wins!`;
        } else if (game.isDraw()) {
            statusMessage = `🤝 Game is a draw!`;
        } else if (game.isStalemate()) {
            statusMessage = `🤝 Stalemate!`;
        }
    } else {
        statusMessage = `Current turn: ${currentPlayer}`;
        if (game.isCheck()) {
            statusMessage += ' ⚠️ (Check!)';
        }
    }
    
    // Add captured pieces display
    if (gameState.capturedPieces) {
        const whiteCaptured = gameState.capturedPieces.white;
        const blackCaptured = gameState.capturedPieces.black;
        
        if (whiteCaptured.length > 0 || blackCaptured.length > 0) {
            statusMessage += `\n\n📥 Captured:`;
            
            // Calculate total values
            let whiteValue = 0;
            let blackValue = 0;
            
            whiteCaptured.forEach(piece => {
                whiteValue += pieceValues[piece] || 0;
            });
            blackCaptured.forEach(piece => {
                blackValue += pieceValues[piece] || 0;
            });
            
            // Display captured pieces
            if (whiteCaptured.length > 0) {
                const pieceDisplay = whiteCaptured.map(p => pieceSymbols[p]).join('');
                statusMessage += `\n⚪ White: ${pieceDisplay} (${whiteValue} pts)`;
            }
            if (blackCaptured.length > 0) {
                const pieceDisplay = blackCaptured.map(p => pieceSymbols[p]).join('');
                statusMessage += `\n⚫ Black: ${pieceDisplay} (${blackValue} pts)`;
            }
        }
    }
    
    // Add move history if available
    if (gameState.moveHistory && gameState.moveHistory.length > 0) {
        const totalMoves = gameState.moveHistory.length;
        const recentMoves = gameState.moveHistory.slice(-5); // Show last 5 moves
        const startNum = Math.max(1, totalMoves - recentMoves.length + 1);
        
        statusMessage += `\n\n📜 Recent moves (${totalMoves} total):`;
        recentMoves.forEach((move, index) => {
            const actualNum = startNum + index;
            let moveText = `${actualNum}. ${move.player}: ${move.move}`;
            if (move.captured) {
                moveText += ` captures ${move.captured}`;
            }
            statusMessage += `\n${moveText}`;
        });
        if (gameState.moveHistory.length > 5) {
            statusMessage += `\n... (${gameState.moveHistory.length - 5} earlier moves)`;
        }
    }
    
    // Generate board image
    const svg = generateChessBoardSVG(game);
    const imagePath = path.join(tempDir, `board_${chatId}.png`);
    
    // Convert SVG to PNG
    await sharp(Buffer.from(svg))
        .resize(720, 720)
        .png()
        .toFile(imagePath);
    
    // Create inline keyboard for legal moves
    const moves = game.moves({ verbose: true });
    const keyboard = [];
    
    if (moves.length > 0) {
        // Group moves into rows of 3 buttons
        for (let i = 0; i < moves.length; i += 3) {
            const row = [];
            for (let j = i; j < Math.min(i + 3, moves.length); j++) {
                const move = moves[j];
                const buttonText = `${move.from}→${move.to}`;
                const callbackData = `move_${move.from}${move.to}${move.promotion ? `=${move.promotion}` : ''}`;
                row.push({ text: buttonText, callback_data: callbackData });
            }
            keyboard.push(row);
        }
    }
    
    // Add control buttons
    keyboard.push([
        { text: '🏠 Home', callback_data: 'home' },
        { text: '🔄 Refresh', callback_data: 'refresh' }
    ]);
    
    // Add history button if there are moves
    if (gameState.moveHistory && gameState.moveHistory.length > 0) {
        keyboard.push([
            { text: '📜 Full History', callback_data: 'show_history' }
        ]);
    }
    
    // Add resign button
    keyboard.push([
        { text: '❌ Resign', callback_data: 'resign' }
    ]);
    
    const options = {
        caption: statusMessage
    };
    
    // Only add buttons if requested
    if (withButtons) {
        options.reply_markup = {
            inline_keyboard: keyboard
        };
        console.log('Buttons created for chatId:', chatId, 'Button count:', keyboard.length);
    } else {
        console.log('No buttons created (withButtons=false) for chatId:', chatId);
    }
    
    // Check if we need to update existing message (for channels)
    const imageStream = fs.createReadStream(imagePath);
    
    if (gameState.channelMessageId && chatId === gameState.channelId) {
        // Update existing message in channel
        try {
            await bot.editMessageMedia(
                {
                    type: 'photo',
                    media: imageStream,
                    caption: statusMessage
                },
                {
                    chat_id: chatId,
                    message_id: gameState.channelMessageId
                }
            );
        } catch (error) {
            // If update fails, send new message
            const sentMessage = await bot.sendPhoto(chatId, imageStream, options);
            gameState.channelMessageId = sentMessage.message_id;
        }
    } else {
        // Send new message
        const sentMessage = await bot.sendPhoto(chatId, imageStream, options);
        
        // If this is a channel message, store the message ID
        if (chatId < 0) { // Channel IDs are negative
            gameState.channelId = chatId;
            gameState.channelMessageId = sentMessage.message_id;
        }
    }
    
    // Clean up old image after sending
    setTimeout(() => {
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }, 1000);
}

// Handle callback queries (button clicks)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const username = callbackQuery.from.username || callbackQuery.from.first_name;
    
    console.log('Callback query received:', {
        username,
        chatId,
        data,
        messageChatId: msg.chat.id
    });
    
    // Acknowledge the callback
    bot.answerCallbackQuery(callbackQuery.id);
    
    // Handle start menu buttons
    if (data === 'start_newgame') {
        // Check if a game already exists
        if (activeGames.has(chatId)) {
            bot.sendMessage(chatId, 'There is already an active game. Click "Join Game" to join the current game.');
            return;
        }
        
        const newGame = new Chess();
        
        // Determine if this is a channel
        const isChannel = msg.chat.type === 'channel' || msg.chat.type === 'supergroup';
        const gameKey = isChannel ? String(chatId) : 'default';
        
        activeGames.set(gameKey, {
            game: newGame,
            lastMove: null,
            players: [],
            whiteTeam: [],
            blackTeam: [],
            capturedPieces: { white: [], black: [] },
            resignVotes: { white: [], black: [] },
            drawVotes: { white: [], black: [] },
            moveHistory: [],
            channelId: isChannel ? String(chatId) : null,
            channelMessageId: null
        });
        bot.sendMessage(chatId, `🎮 New game started by ${username}! Choose your side:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚪ Join White', callback_data: 'join_white' }],
                    [{ text: '⚫ Join Black', callback_data: 'join_black' }]
                ]
            }
        });
        return;
    }
    
    if (data === 'start_channel_game') {
        // Ask for channel username or ID
        bot.sendMessage(chatId, 
            `📺 Start Game in Channel\n\n` +
            `Please provide the channel username or ID:\n` +
            `• For public channels: @channelname\n` +
            `• For private channels: -1001234567890\n\n` +
            `Example: @ragoose_dumps or just paste the channel invite link`
        );
        
        // Store that we're waiting for channel info
        bot.once('message', async (channelMsg) => {
            if (channelMsg.chat.type !== 'private') return;
            
            const channelInput = channelMsg.text.trim();
            let targetChannelId = null;
            
            // Extract channel ID from various formats
            if (channelInput.startsWith('@')) {
                // Username format
                const channelUsername = channelInput.replace('@', '');
                try {
                    const chat = await bot.getChat('@' + channelUsername);
                    targetChannelId = chat.id;
                } catch (error) {
                    bot.sendMessage(chatId, 'Could not find that channel. Make sure the bot is an admin.');
                    return;
                }
            } else if (channelInput.startsWith('https://t.me/')) {
                // Handle invite link
                const parts = channelInput.split('/');
                const identifier = parts[parts.length - 1];
                
                if (identifier.startsWith('+')) {
                    bot.sendMessage(chatId, 
                        'Please share the channel username (e.g., @channelname) instead of the private invite link.\n' +
                        'Or ask the channel admin to add @shared_chess_bot as admin, then try starting the game from the channel.'
                    );
                    return;
                }
                
                try {
                    const chat = await bot.getChat('@' + identifier);
                    targetChannelId = chat.id;
                } catch (error) {
                    bot.sendMessage(chatId, 'Could not access that channel.');
                    return;
                }
            } else if (!isNaN(channelInput)) {
                // Numeric ID
                targetChannelId = channelInput.startsWith('-') ? channelInput : '-' + channelInput;
            }
            
            if (targetChannelId) {
                try {
                    const gameKey = String(targetChannelId);
                    const gameExists = activeGames.has(gameKey);
                    await startGameInChannel(targetChannelId, username);
                    
                    // Only send success message if a new game was started
                    if (!gameExists) {
                        bot.sendMessage(chatId, `✅ Game started in channel! Check it out.`);
                    }
                } catch (error) {
                    console.error('Error starting game in channel:', error);
                    bot.sendMessage(chatId, 
                        `❌ Error starting game: ${error.message}\n\n` +
                        `Make sure:\n` +
                        `• Bot is admin of the channel\n` +
                        `• Bot has "Post Messages" permission`
                    );
                }
            }
        });
        
        return;
    }
    
    if (data === 'start_join') {
        if (!activeGames.has(chatId)) {
            const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
            bot.sendMessage(chatId, 'No active game found.', {
                reply_markup: { inline_keyboard: keyboard }
            });
            return;
        }
        const gameState = activeGames.get(chatId);
        
        // Check if user already joined
        if (gameState.players.includes(username)) {
            bot.sendMessage(chatId, `You're already in the game!`);
            return;
        }
        
        // Show side selection
        bot.sendMessage(chatId, `Choose your side:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚪ Join White', callback_data: 'join_white' }],
                    [{ text: '⚫ Join Black', callback_data: 'join_black' }]
                ]
            }
        });
        return;
    }
    
    // Handle joining white team for channel game
    if (data.startsWith('join_channel_white_')) {
        const channelId = data.replace('join_channel_white_', '');
        if (!activeGames.has(channelId)) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        const gameState = activeGames.get(channelId);
        
        // Remove from black team if they were there
        gameState.blackTeam = gameState.blackTeam.filter(p => p !== username);
        
        // Add to white team if not already there
        if (!gameState.whiteTeam.includes(username)) {
            gameState.whiteTeam.push(username);
        }
        
        // Add to players list
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        
        // Store the connection
        userToChannel.set(String(chatId), channelId);
        
        // Add user to joinedUsers list to receive updates
        if (!gameState.joinedUsers.includes(chatId)) {
            gameState.joinedUsers.push(chatId);
        }
        
        bot.sendMessage(chatId, `⚪ ${username} joined the White team in the channel game!\nWhite: ${gameState.whiteTeam.join(', ')}\nBlack: ${gameState.blackTeam.join(', ') || 'None'}`);
        await showGameStatus(chatId, gameState, username);
        
        // Don't update channel board on join - keep channel clean
        return;
    }
    
    // Handle joining black team for channel game
    if (data.startsWith('join_channel_black_')) {
        const channelId = data.replace('join_channel_black_', '');
        if (!activeGames.has(channelId)) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        const gameState = activeGames.get(channelId);
        
        // Remove from white team if they were there
        gameState.whiteTeam = gameState.whiteTeam.filter(p => p !== username);
        
        // Add to black team if not already there
        if (!gameState.blackTeam.includes(username)) {
            gameState.blackTeam.push(username);
        }
        
        // Add to players list
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        
        // Store the connection
        userToChannel.set(String(chatId), channelId);
        
        // Add user to joinedUsers list to receive updates
        if (!gameState.joinedUsers.includes(chatId)) {
            gameState.joinedUsers.push(chatId);
        }
        
        bot.sendMessage(chatId, `⚫ ${username} joined the Black team in the channel game!\nWhite: ${gameState.whiteTeam.join(', ') || 'None'}\nBlack: ${gameState.blackTeam.join(', ')}`);
        await showGameStatus(chatId, gameState, username);
        
        // Don't update channel board on join - keep channel clean
        return;
    }
    
    // Handle joining white team
    if (data === 'join_white') {
        if (!activeGames.has(chatId)) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        const gameState = activeGames.get(chatId);
        
        // Remove from black team if they were there
        gameState.blackTeam = gameState.blackTeam.filter(p => p !== username);
        
        // Add to white team if not already there
        if (!gameState.whiteTeam.includes(username)) {
            gameState.whiteTeam.push(username);
        }
        
        // Add to players list
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        
        bot.sendMessage(chatId, `⚪ ${username} joined the White team!\nWhite: ${gameState.whiteTeam.join(', ')}\nBlack: ${gameState.blackTeam.join(', ') || 'None'}`);
        await showGameStatus(chatId, gameState, username);
        return;
    }
    
    // Handle joining black team
    if (data === 'join_black') {
        if (!activeGames.has(chatId)) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        const gameState = activeGames.get(chatId);
        
        // Remove from white team if they were there
        gameState.whiteTeam = gameState.whiteTeam.filter(p => p !== username);
        
        // Add to black team if not already there
        gameState.blackTeam.push(username);
        
        // Add to players list
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        
        bot.sendMessage(chatId, `⚫ ${username} joined the Black team!\nWhite: ${gameState.whiteTeam.join(', ') || 'None'}\nBlack: ${gameState.blackTeam.join(', ')}`);
        await showGameStatus(chatId, gameState, username);
        return;
    }
    
    if (data === 'start_help') {
        const keyboard = [
            [
                { text: '🎮 New Game', callback_data: 'start_newgame' },
                { text: '👥 Join Game', callback_data: 'start_join' }
            ],
            [
                { text: '📚 Help', callback_data: 'start_help' }
            ]
        ];
        
        bot.sendMessage(chatId,
            `📚 Chess Bot Commands:\n\n` +
            `Button Commands:\n` +
            `🎮 New Game - Start a new chess game\n` +
            `👥 Join Game - Join the current game or view status\n` +
            `📚 Help - Show this help message\n\n` +
            `Text Commands (also available):\n` +
            `/newgame - Start a new chess game\n` +
            `/join - Join the current game\n` +
            `/move <move> - Make a move (e.g., /move e2e4)\n` +
            `/resign - End the current game\n` +
            `/help - Show this help message\n\n` +
            `📖 How to play:\n` +
            `1. Click "New Game" to start\n` +
            `2. Click "Join Game" to join (anyone can play)\n` +
            `3. Make moves by clicking the buttons below the board\n` +
            `4. Moves are validated automatically`,
            {
                reply_markup: { inline_keyboard: keyboard }
            }
        );
        return;
    }
    
    // Handle game-related buttons (need active game)
    // Check if there's a game for this chatId or if user is connected to a channel game
    const hasGame = activeGames.has(chatId) || userToChannel.has(String(chatId));
    
    if (!hasGame) {
        // Only show no game message for refresh/resign, not for home
        if (data === 'refresh' || data === 'resign') {
            const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
            bot.sendMessage(chatId, 'No active game found.', {
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        return;
    }
    
    // Handle different button actions
    if (data === 'home') {
        const keyboard = [
            [
                { text: '🎮 New Game', callback_data: 'start_newgame' },
                { text: '👥 Join Game', callback_data: 'start_join' }
            ],
            [
                { text: '📚 Help', callback_data: 'start_help' }
            ]
        ];
        
        const options = {
            reply_markup: {
                inline_keyboard: keyboard
            }
        };
        
        bot.sendMessage(chatId, 
            `🏠 Main Menu\n\nChoose an option:`,
            options
        );
        return;
    }
    
    if (data === 'refresh') {
        // Get the game state - check if user is connected to a channel game first
        let targetGameState = null;
        if (userToChannel.has(String(chatId))) {
            const channelId = userToChannel.get(String(chatId));
            if (activeGames.has(channelId)) {
                targetGameState = activeGames.get(channelId);
            }
        } else if (activeGames.has(String(chatId))) {
            targetGameState = activeGames.get(String(chatId));
        }
        
        if (!targetGameState) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        
        await showGameStatus(chatId, targetGameState, username);
        return;
    }
    
    if (data === 'show_history') {
        // Get the game state - check if user is connected to a channel game first
        let targetGameState = null;
        if (userToChannel.has(String(chatId))) {
            const channelId = userToChannel.get(String(chatId));
            if (activeGames.has(channelId)) {
                targetGameState = activeGames.get(channelId);
            }
        } else if (activeGames.has(String(chatId))) {
            targetGameState = activeGames.get(String(chatId));
        }
        
        if (!targetGameState) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        
        if (!targetGameState.moveHistory || targetGameState.moveHistory.length === 0) {
            bot.sendMessage(chatId, 'No moves yet!');
            return;
        }
        
        let historyText = `📜 Full Move History (${targetGameState.moveHistory.length} moves):\n\n`;
        targetGameState.moveHistory.forEach((move) => {
            let moveText = `${move.number}. ${move.player}: ${move.move}`;
            if (move.captured) {
                moveText += ` captures ${move.captured}`;
            }
            historyText += moveText + '\n';
        });
        
        // Add team information
        historyText += `\n⚪ White Team: ${targetGameState.whiteTeam.join(', ') || 'None'}`;
        historyText += `\n⚫ Black Team: ${targetGameState.blackTeam.join(', ') || 'None'}`;
        
        bot.sendMessage(chatId, historyText);
        return;
    }
    
    if (data === 'resign') {
        // Get the game state - check if user is connected to a channel game first
        let gameState = null;
        let gameKey = null;
        
        if (userToChannel.has(String(chatId))) {
            const channelId = userToChannel.get(String(chatId));
            gameKey = channelId;
            if (activeGames.has(channelId)) {
                gameState = activeGames.get(channelId);
            }
        } else if (activeGames.has(String(chatId))) {
            gameKey = String(chatId);
            gameState = activeGames.get(String(chatId));
        }
        
        if (!gameState || !gameKey) {
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        
        // Determine which team the user is on
        let userTeam = null;
        let teamName = '';
        
        if (gameState.whiteTeam.includes(username)) {
            userTeam = gameState.resignVotes.white;
            teamName = 'White';
        } else if (gameState.blackTeam.includes(username)) {
            userTeam = gameState.resignVotes.black;
            teamName = 'Black';
        } else {
            bot.sendMessage(chatId, `❌ You must join a team first to vote!`);
            return;
        }
        
        // Add vote if not already voted
        if (!userTeam.includes(username)) {
            userTeam.push(username);
            
            // Count team members and votes
            const teamPlayers = teamName === 'White' ? gameState.whiteTeam.length : gameState.blackTeam.length;
            const voteCount = userTeam.length;
            const majorityNeeded = Math.ceil(teamPlayers / 2); // More than half
            
            if (voteCount >= majorityNeeded) {
                // Majority reached - end game
                activeGames.delete(gameKey);
                bot.sendMessage(chatId, `🏳️ ${teamName} team resigned (${voteCount}/${teamPlayers} votes). Game ended.`);
            } else {
                bot.sendMessage(chatId, `🖐️ ${username} voted to resign.\n${teamName} team: ${voteCount}/${majorityNeeded} votes needed (${teamPlayers} total players)`);
            }
        } else {
            bot.sendMessage(chatId, `You've already voted to resign.`);
        }
        return;
    }
    
    if (data.startsWith('move_')) {
        console.log('Entering move handler for:', data);
        
        // Only allow moves from private chats
        if (msg.chat.type !== 'private') {
            console.log('Rejected: not a private chat');
            bot.answerCallbackQuery(callbackQuery.id, { 
                text: 'Moves can only be made from private chat with the bot',
                show_alert: true 
            });
            return;
        }
        
        // Get the game state - check if user is connected to a channel game first
        let targetGameState = null;
        let targetGame = null;
        
        if (userToChannel.has(String(chatId))) {
            const channelId = userToChannel.get(String(chatId));
            if (activeGames.has(channelId)) {
                targetGameState = activeGames.get(channelId);
                targetGame = targetGameState.game;
            }
        } else if (activeGames.has(String(chatId))) {
            targetGameState = activeGames.get(String(chatId));
            targetGame = targetGameState.game;
        }
        
        if (!targetGameState || !targetGame) {
            console.log('No game found. userToChannel has user?', userToChannel.has(String(chatId)));
            bot.sendMessage(chatId, 'No active game found.');
            return;
        }
        
        console.log('Game found successfully');
        
        // Check if game is over
        if (targetGame.isGameOver()) {
            const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
            bot.sendMessage(chatId, 'Game is over.', {
                reply_markup: { inline_keyboard: keyboard }
            });
            return;
        }
        
        // Check if user has joined any team
        console.log('Move attempt - checking team membership:', {
            username,
            whiteTeam: targetGameState.whiteTeam,
            blackTeam: targetGameState.blackTeam,
            hasWhite: targetGameState.whiteTeam.includes(username),
            hasBlack: targetGameState.blackTeam.includes(username)
        });
        
        const hasJoinedTeam = targetGameState.whiteTeam.includes(username) || targetGameState.blackTeam.includes(username);
        if (!hasJoinedTeam) {
            console.log('User not found in any team');
            bot.sendMessage(chatId, `❌ You must join a team first! Use "Join Game" to choose White or Black.`);
            return;
        }
        
        // Check if user is on the correct team
        const currentSide = targetGame.turn() === 'w' ? 'white' : 'black';
        const team = currentSide === 'white' ? targetGameState.whiteTeam : targetGameState.blackTeam;
        
        if (!team.includes(username)) {
            const currentPlayer = currentSide === 'white' ? 'White' : 'Black';
            bot.sendMessage(chatId, `❌ It's ${currentPlayer}'s turn, but you're on the other team!`);
            await showGameStatus(chatId, targetGameState, username);
            return;
        }
        
        // Extract move notation
        const moveNotation = data.replace('move_', '');
        
        try {
            // Try to make the move
            const move = targetGame.move(moveNotation);
            
            if (!move) {
                bot.sendMessage(chatId, `❌ Invalid move: ${moveNotation}`);
                await showGameStatus(chatId, targetGameState, username);
                return;
            }
            
            // Move was successful
            targetGameState.lastMove = {
                player: username,
                move: moveNotation,
                timestamp: new Date()
            };
            
            // Track captured pieces
            if (move.captured) {
                const capturedPiece = move.captured;
                const capturingSide = move.color;
                const capturedSide = capturingSide === 'w' ? 'black' : 'white';
                targetGameState.capturedPieces[capturedSide].push(capturedPiece);
            }
            
            // Add move to history
            if (!targetGameState.moveHistory) {
                targetGameState.moveHistory = [];
            }
            targetGameState.moveHistory.push({
                number: targetGameState.moveHistory.length + 1,
                player: username,
                move: `${move.from} → ${move.to}`,
                captured: move.captured ? pieceSymbols[move.captured] : null
            });
            
            const moveDescription = move.captured ? 
                `${move.from} → ${move.to} captures ${pieceSymbols[move.captured]}` : 
                `${move.from} → ${move.to}`;
            
            // Notify about the move
            bot.sendMessage(chatId, `✅ ${username} played: ${moveDescription}`);
            
            // Show updated board in private chat
            await showGameStatus(chatId, targetGameState, username);
            
            // Also update channel board if this is a channel game
            if (targetGameState.channelId) {
                await showGameStatus(targetGameState.channelId, targetGameState, username, false);
            }
            
            // Send updates to all users who joined via deep link
            if (targetGameState.joinedUsers && targetGameState.joinedUsers.length > 0) {
                for (const userId of targetGameState.joinedUsers) {
                    if (userId !== chatId) { // Don't send to the player who made the move (already sent above)
                        try {
                            await showGameStatus(userId, targetGameState, '');
                        } catch (error) {
                            console.error(`Error sending update to user ${userId}:`, error);
                        }
                    }
                }
            }
            
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            await showGameStatus(chatId, targetGameState, username);
        }
    }
});

// Helper function to format legal moves as a list (for text commands)
function getLegalMovesList(game) {
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) return 'No legal moves available.';
    
    return moves.map(move => 
        `${move.from}${move.to}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`
    ).join(', ');
}

// Helper function to handle new game in channel
async function startGameInChannel(channelId, username) {
    const gameKey = String(channelId);
    
    // Check if a game already exists - don't post to channel, just return
    if (activeGames.has(gameKey)) {
        return;
    }
    
    // Create a new game
    const newGame = new Chess();
    activeGames.set(gameKey, {
        game: newGame,
        lastMove: null,
        players: [],
        whiteTeam: [],
        blackTeam: [],
        joinedUsers: [], // Track users who joined via deep link
        capturedPieces: { white: [], black: [] },
        resignVotes: { white: [], black: [] },
        drawVotes: { white: [], black: [] },
        moveHistory: [],
        channelId: String(channelId),
        channelMessageId: null
    });
    
    // Show the board in channel
    await showGameStatus(channelId, activeGames.get(gameKey), username, false);
    
    // Send instructions with deep link
    const botInfo = await bot.getMe();
    const deepLink = `https://t.me/${botInfo.username}?start=channel_${channelId}`;
    
    await bot.sendMessage(channelId, 
        `🎮 Chess Game Started! 🎮\n\n` +
        `📱 To play, click the button below to join! 👇\n\n` +
        `⚪ White plays first!\n` +
        `👥 Anyone can join the game!`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 Join This Game', url: deepLink }]
                ]
            }
        }
    );
}

// Handle /start command
bot.onText(/\/start(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const param = match[1]?.trim(); // Get parameter from deep link
    
    console.log('/start command received', { chatId, username, param });
    
    // Check if this is a deep link to join a specific channel game
    if (param && param.startsWith('channel_')) {
        const targetChannelId = param.replace('channel_', '');
        
        if (activeGames.has(targetChannelId)) {
            const gameState = activeGames.get(targetChannelId);
            
            // Show side selection for this channel's game
            bot.sendMessage(chatId, `🎮 Join the channel game! Choose your side:`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⚪ Join White', callback_data: `join_channel_white_${targetChannelId}` }],
                        [{ text: '⚫ Join Black', callback_data: `join_channel_black_${targetChannelId}` }]
                    ]
                }
            });
            
            // Store the channel connection
            userToChannel.set(String(chatId), targetChannelId);
            
            return;
        } else {
            bot.sendMessage(chatId, '❌ Game not found. It may have ended or the link is invalid.');
            return;
        }
    }
    
    const keyboard = [
        [
            { text: '🎮 New Game', callback_data: 'start_newgame' },
            { text: '👥 Join Game', callback_data: 'start_join' }
        ],
        [
            { text: '📺 Start Channel Game', callback_data: 'start_channel_game' }
        ],
        [
            { text: '📚 Help', callback_data: 'start_help' }
        ]
    ];
    
    const options = {
        reply_markup: {
            inline_keyboard: keyboard
        }
    };
    
    // If there's an active game, auto-join the user
    if (activeGames.has(chatId)) {
        const gameState = activeGames.get(chatId);
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        bot.sendMessage(chatId, 
            `👋 Welcome back, ${username}!\n\nThere's an active game. Here's the current board:`,
            options
        );
        showGameStatus(chatId, gameState, username);
    } else {
        bot.sendMessage(chatId, 
            `👋 Welcome to Chess Bot, ${username}!\n\n` +
            `Choose an option from the buttons below to get started:`,
            options
        );
    }
});

// Handle /newgame command
bot.onText(/\/newgame/i, async (msg) => {
    console.log('Received /newgame command', { chatId: msg.chat.id, chatType: msg.chat.type, username: msg.from?.username });
    
    const chatId = msg.chat.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const isChannel = msg.chat.type === 'channel' || msg.chat.type === 'supergroup';
    const gameKey = isChannel ? String(chatId) : String(chatId);
    
    // Check if a game already exists
    if (activeGames.has(gameKey)) {
        bot.sendMessage(chatId, 'There is already an active game. Use /join to join the current game.');
        return;
    }
    
    // Create a new game
    const newGame = new Chess();
    activeGames.set(gameKey, {
        game: newGame,
        lastMove: null,
        players: [],
        whiteTeam: [],
        blackTeam: [],
        capturedPieces: { white: [], black: [] },
        resignVotes: { white: [], black: [] },
        drawVotes: { white: [], black: [] },
        moveHistory: [],
        channelId: isChannel ? String(chatId) : null,
        channelMessageId: null
    });
    
    if (isChannel) {
        // In channel - use helper function
        activeGames.delete(gameKey); // Clean up since we'll recreate in helper
        await startGameInChannel(chatId, username);
    } else {
        // In private chat - show with buttons
        bot.sendMessage(chatId, `🎮 New game started by ${username}! Choose your side:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚪ Join White', callback_data: 'join_white' }],
                    [{ text: '⚫ Join Black', callback_data: 'join_black' }]
                ]
            }
        });
        await showGameStatus(chatId, activeGames.get(gameKey), username);
    }
});

// Handle /join command
bot.onText(/\/join/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!activeGames.has(chatId)) {
        const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
        bot.sendMessage(chatId, 'No active game found.', {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }
    
    const gameState = activeGames.get(chatId);
    
    // Add player if not already in list
    if (!gameState.players.includes(username)) {
        gameState.players.push(username);
    }
    
    bot.sendMessage(chatId, 
        `👤 ${username} joined the game!\n` +
        `Players: ${gameState.players.join(', ')}`
    );
    
    showGameStatus(chatId, gameState, username);
});

// Handle /move command
bot.onText(/\/move (.+)/, (msg, match) => {
    // Only allow moves from private chats
    if (msg.chat.type !== 'private') {
        bot.sendMessage(msg.chat.id, '❌ Moves can only be made from your private chat with the bot. Start a conversation with me!');
        return;
    }
    
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!activeGames.has(chatId)) {
        const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
        bot.sendMessage(chatId, 'No active game found.', {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }
    
    const gameState = activeGames.get(chatId);
    const { game } = gameState;
    
    // Check if game is over
    if (game.isGameOver()) {
        const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
        bot.sendMessage(chatId, 'Game is over.', {
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }
    
    // Check if user has joined any team
    const hasJoinedTeam = gameState.whiteTeam.includes(username) || gameState.blackTeam.includes(username);
    if (!hasJoinedTeam) {
        bot.sendMessage(chatId, `❌ You must join a team first! Use /join to choose White or Black.`);
        return;
    }
    
    // Check if user is on the correct team
    const currentSide = game.turn() === 'w' ? 'white' : 'black';
    const team = currentSide === 'white' ? gameState.whiteTeam : gameState.blackTeam;
    
    if (!team.includes(username)) {
        const currentPlayer = currentSide === 'white' ? 'White' : 'Black';
        bot.sendMessage(chatId, `❌ It's ${currentPlayer}'s turn, but you're on the other team!`);
        return;
    }
    
    const moveNotation = match[1].trim();
    
    try {
        // Try to make the move
        const move = game.move(moveNotation);
        
        if (!move) {
            bot.sendMessage(chatId, 
                `❌ Invalid move: ${moveNotation}\n\n` +
                `Legal moves: ${getLegalMovesList(game)}`
            );
            return;
        }
        
        // Move was successful
        gameState.lastMove = {
            player: username,
            move: moveNotation,
            timestamp: new Date()
        };
        
        // Track captured pieces
        if (move.captured) {
            const capturedPiece = move.captured;
            const capturingSide = move.color;
            const capturedSide = capturingSide === 'w' ? 'black' : 'white';
            gameState.capturedPieces[capturedSide].push(capturedPiece);
        }
        
        // Add move to history
        if (!gameState.moveHistory) {
            gameState.moveHistory = [];
        }
        gameState.moveHistory.push({
            number: gameState.moveHistory.length + 1,
            player: username,
            move: `${move.from} → ${move.to}`,
            captured: move.captured ? pieceSymbols[move.captured] : null
        });
        
        const moveDescription = move.captured ? 
            `${move.from} → ${move.to} captures ${pieceSymbols[move.captured]}` : 
            `${move.from} → ${move.to}`;
        
        // Notify about the move
        bot.sendMessage(chatId, 
            `✅ ${username} played: ${moveDescription}`
        );
        
        // Show updated board
        showGameStatus(chatId, gameState, username);
        
    } catch (error) {
        bot.sendMessage(chatId, 
            `❌ Error: ${error.message}`
        );
    }
});

// Handle /resign command
bot.onText(/\/resign/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!activeGames.has(chatId)) {
        bot.sendMessage(chatId, `No active game to resign.`);
        return;
    }
    
    activeGames.delete(chatId);
    bot.sendMessage(chatId, `🏳️ ${username} resigned. Game ended.`);
});

// Handle /help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const keyboard = [
        [
            { text: '🎮 New Game', callback_data: 'start_newgame' },
            { text: '👥 Join Game', callback_data: 'start_join' }
        ],
        [
            { text: '📚 Help', callback_data: 'start_help' }
        ]
    ];
    
    bot.sendMessage(chatId,
        `📚 Chess Bot Commands:\n\n` +
        `Button Commands:\n` +
        `🎮 New Game - Start a new chess game\n` +
        `👥 Join Game - Join the current game or view status\n` +
        `📚 Help - Show this help message\n\n` +
        `Text Commands (also available):\n` +
        `/newgame - Start a new chess game\n` +
        `/join - Join the current game\n` +
        `/move <move> - Make a move (e.g., /move e2e4)\n` +
        `/resign - End the current game\n` +
        `/help - Show this help message\n\n` +
        `📖 How to play:\n` +
        `1. Click "New Game" to start\n` +
        `2. Click "Join Game" to join (anyone can play)\n` +
        `3. Make moves by clicking the buttons below the board\n` +
        `4. Moves are validated automatically`,
        {
            reply_markup: { inline_keyboard: keyboard }
        }
    );
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Listen to all messages for debugging and game triggers
bot.on('message', async (msg) => {
    // Log all messages for debugging
    console.log('Message received:', { 
        chatId: msg.chat.id, 
        chatType: msg.chat.type,
        chatTitle: msg.chat.title || msg.chat.username,
        hasText: !!msg.text,
        from: msg.from?.username || 'Unknown'
    });
    
    if (!msg.text) return;
    
    const text = msg.text.toLowerCase();
    const chatId = msg.chat.id;
    const username = msg.from?.username || msg.from?.first_name || 'Unknown';
    const isChannel = msg.chat.type === 'channel' || msg.chat.type === 'supergroup';
    
    // Check if message contains "new game" or "start game" in channels
    if (isChannel && (text.includes('new game') || text.includes('start game'))) {
        console.log(`Received game start request in channel ${chatId} from ${username}`);
        try {
            await startGameInChannel(chatId, username);
        } catch (error) {
            console.error('Error starting game in channel:', error);
        }
    }
});

console.log('🤖 Chess Bot is running...');

