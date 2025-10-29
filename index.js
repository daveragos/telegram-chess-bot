require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Chess } = require('chess.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { initDatabase, getActiveGames, getGameByChannelId, saveGame, deleteGame } = require('./database');

// Initialize database
const db = initDatabase();

// Initialize the bot with your Telegram Bot Token
const token = process.env.BOT_TOKEN || process.env.bot_token || process.env.token;
if (!token) {
    console.error('Error: BOT_TOKEN not found in environment variables');
    console.error('Please set BOT_TOKEN in your environment variables');
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.toLowerCase().includes('bot') || k.toLowerCase().includes('token')));
    process.exit(1);
}
console.log('Bot token loaded successfully (length:', token.length, ')');

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

// Unicode chess pieces for SVG - using UTF-8 encoding
const pieceUnicode = {
    'p': '\u265F', // ♟ black pawn
    'n': '\u265E', // ♞ black knight
    'b': '\u265D', // ♝ black bishop
    'r': '\u265C', // ♜ black rook
    'q': '\u265B', // ♛ black queen
    'k': '\u265A', // ♚ black king
    'P': '\u2659', // ♙ white pawn
    'N': '\u2658', // ♘ white knight
    'B': '\u2657', // ♗ white bishop
    'R': '\u2656', // ♖ white rook
    'Q': '\u2655', // ♕ white queen
    'K': '\u2654'  // ♔ white king
};

// Helper function to check if enough time has passed since the last move
function canMakeMove(gameState) {
    if (!gameState.moveDelay || !gameState.moveDelay.enabled) {
        return true; // No delay, can move immediately
    }
    
    const moveNumber = gameState.moveNumber || 0;
    
    // If round is in progress (odd moveNumber = only one side moved), allow immediate move
    // moveNumber 0 = game start (white can move)
    // moveNumber 1 = white moved (black can move immediately)
    // moveNumber 2 = both moved (round 1 complete, timer starts)
    if (moveNumber % 2 === 1) {
        return true; // Round in progress, second player can move immediately
    }
    
    // Round is complete (both sides moved), check timer
    if (!gameState.roundEndTime) {
        return true; // No timer set yet (shouldn't happen, but safe fallback)
    }
    
    // Check if timer has expired
    const timeSinceRoundEnd = (Date.now() - gameState.roundEndTime) / 1000; // in seconds
    const roundNumber = Math.floor(moveNumber / 2);
    // First round (roundNumber=1) gets baseDelay only, subsequent rounds add increment
    const requiredDelay = gameState.moveDelay.baseDelay + (gameState.moveDelay.increment * (roundNumber - 1));
    
    return timeSinceRoundEnd >= requiredDelay;
}

// Helper function to get remaining delay time
function getRemainingDelay(gameState) {
    if (!gameState.moveDelay || !gameState.moveDelay.enabled) {
        return 0;
    }
    
    const moveNumber = gameState.moveNumber || 0;
    
    // If round is in progress (odd moveNumber), no delay needed
    if (moveNumber % 2 === 1) {
        return 0; // Round in progress, second player can move immediately
    }
    
    // Round is complete, check timer
    if (!gameState.roundEndTime) {
        return 0;
    }
    
    const roundNumber = Math.floor(moveNumber / 2);
    const timeSinceRoundEnd = (Date.now() - gameState.roundEndTime) / 1000;
    // First round (roundNumber=1) gets baseDelay only, subsequent rounds add increment
    const requiredDelay = gameState.moveDelay.baseDelay + (gameState.moveDelay.increment * (roundNumber - 1));
    const remaining = Math.max(0, requiredDelay - timeSinceRoundEnd);
    
    return Math.ceil(remaining);
}

// Helper function to format time nicely (seconds to days/hours/minutes)
function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 && days === 0) parts.push(`${minutes}m`); // Only show minutes if less than a day
    if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs}s`); // Only show seconds if less than an hour
    
    return parts.join(' ') || `${seconds}s`;
}

// Helper function to generate empty board if needed
function generateEmptyBoard() {
    const squareSize = 60;
    const boardSize = squareSize * 8;
    const padding = 40;
    let svg = `<svg width="${boardSize + (padding * 2) + 80}" height="${boardSize + (padding * 2) + 80}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="${boardSize + (padding * 2) + 80}" height="${boardSize + (padding * 2) + 80}" fill="#f0d9b5"/>`;
    
    // Draw empty board
    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const isLight = (rank + file) % 2 === 0;
            const color = isLight ? '#f0d9b5' : '#b58863';
            const x = file * squareSize + padding + 40;
            const y = rank * squareSize + padding + 40;
            svg += `<rect x="${x}" y="${y}" width="${squareSize}" height="${squareSize}" fill="${color}"/>`;
        }
    }
    svg += `</svg>`;
    return svg;
}

// Helper function to generate SVG chess board
function generateChessBoardSVG(game) {
    const board = game.board();
    
    // Ensure board is valid 8x8
    if (!board || board.length !== 8) {
        console.error('Invalid board state:', board);
        return generateEmptyBoard();
    }
    
    const squareSize = 60;
    const boardSize = squareSize * 8;
    const padding = 40; 
    
    // Check if we should rotate the board (when it's Black's turn)
    const isBlackTurn = game.turn() === 'b';
    
    const totalWidth = boardSize + (padding * 2) + 80;
    const totalHeight = boardSize + (padding * 2) + 80;
    
    // Create SVG with proper XML declaration and encoding
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`;
    
    // Add style for proper Unicode rendering
    svg += `<defs><style type="text/css">
        <![CDATA[
        .chess-piece {
            font-family: 'Arial Unicode MS', 'DejaVu Sans', 'Segoe UI Symbol', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif;
            font-weight: normal;
            font-style: normal;
        }
        ]]>
    </style></defs>`;
    
    // Background
    svg += `<rect width="${boardSize + (padding * 2) + 80}" height="${boardSize + (padding * 2) + 80}" fill="#f0d9b5"/>`;
    
    // Draw squares - ensure exactly 8x8
    for (let rank = 0; rank < 8; rank++) {
        if (!board[rank] || board[rank].length !== 8) {
            console.error(`Invalid rank ${rank}:`, board[rank]);
            continue;
        }
        
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
            const square = board[displayRank] && board[displayRank][displayFile];
            if (square && square.type && square.color) {
                const pieceKey = square.color === 'w' ? square.type.toUpperCase() : square.type;
                const pieceChar = pieceUnicode[pieceKey];
                
                if (pieceChar) {
                    // Use class for proper font rendering and add stroke for better visibility
                    svg += `<text class="chess-piece" x="${x + squareSize / 2}" y="${y + squareSize / 2 + 5}" font-size="${squareSize - 8}" fill="${square.color === 'w' ? '#ffffff' : '#000000'}" stroke="${square.color === 'w' ? '#000000' : '#ffffff'}" stroke-width="1" text-anchor="middle" dominant-baseline="central">${pieceChar}</text>`;
                }
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
        
        // Add timer status display
        if (gameState.moveDelay && gameState.moveDelay.enabled) {
            const moveNumber = gameState.moveNumber || 0;
            const remaining = getRemainingDelay(gameState);
            const isRoundInProgress = moveNumber % 2 === 1;
            
            if (isRoundInProgress) {
                // Round in progress - second player can move immediately (no timer)
                const roundNumber = Math.floor(moveNumber / 2) + 1;
                const waitingPlayer = currentPlayer === 'White' ? 'Black' : 'White';
                statusMessage += `\n\n⏱️ Round ${roundNumber}: ${waitingPlayer} can move immediately (no timer during round)`;
            } else if (remaining > 0) {
                // Round complete, waiting for timer before next round
                const roundNumber = Math.floor(moveNumber / 2);
                const formattedTime = formatTime(remaining);
                statusMessage += `\n\n⏳ Round ${roundNumber} complete. Timer: ${formattedTime} remaining before next round`;
                statusMessage += `\n⏸️ Waiting for timer to expire...`;
            } else if (moveNumber > 0 && moveNumber % 2 === 0) {
                // Timer expired, ready for next round
                const roundNumber = Math.floor(moveNumber / 2) + 1;
                statusMessage += `\n\n✅ Timer expired! Ready for round ${roundNumber}`;
            }
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
    
    // Convert SVG to PNG - ensure UTF-8 encoding
    const svgBuffer = Buffer.from(svg, 'utf8');
    
    // Log for debugging
    const boardState = game.board();
    console.log('Generating board image, SVG length:', svg.length, 'Board size check:', boardState ? boardState.length : 'null');
    
    await sharp(svgBuffer, {
        density: 144, // Higher DPI for better quality
        limitInputPixels: false // Allow larger images
    })
    .resize(720, 720, {
        fit: 'contain',
        background: { r: 240, g: 217, b: 181, alpha: 1 } // Match board background
    })
    .png({
        quality: 100,
        compressionLevel: 1
    })
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
    
    // Add buttons if requested, or if this is a channel post (to show join link)
    if (withButtons || gameState.channelId) {
        // If this is a channel post and we don't have buttons yet, add just a join link
        if (gameState.channelId && !withButtons) {
            // Get bot username for deep link
            const botInfo = await bot.getMe();
            const deepLink = `https://t.me/${botInfo.username}?start=channel_${gameState.channelId}`;
            options.reply_markup = {
                inline_keyboard: [
                    [{ text: '🎮 Join & Play', url: deepLink }]
                ]
            };
            console.log('Added join link button for channel:', gameState.channelId);
        } else if (withButtons) {
            options.reply_markup = {
                inline_keyboard: keyboard
            };
            console.log('Buttons created for chatId:', chatId, 'Button count:', keyboard.length);
        }
    } else {
        console.log('No buttons created (withButtons=false) for chatId:', chatId);
    }
    
    // Check if we need to update existing message (for channels)
    const imageStream = fs.createReadStream(imagePath);
    
    if (gameState.channelMessageId && chatId === gameState.channelId) {
        // Update existing message in channel
        try {
            const editOptions = {
                chat_id: chatId,
                message_id: gameState.channelMessageId
            };
            
            // Add reply_markup if we have it
            if (options.reply_markup) {
                editOptions.reply_markup = options.reply_markup;
            }
            
            await bot.editMessageMedia(
                {
                    type: 'photo',
                    media: imageStream,
                    caption: statusMessage
                },
                editOptions
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

// Helper function to handle joining a game
async function handleGameJoin(channelId, chatId, username, team) {
    let gameState = activeGames.get(channelId);
    
    if (!gameState) {
        bot.sendMessage(chatId, 'Game not found in memory. Please try again.');
        return;
    }
    
    // Check if user is already in a team
    const isInWhiteTeam = gameState.whiteTeam.includes(username);
    const isInBlackTeam = gameState.blackTeam.includes(username);
    
    if (isInWhiteTeam || isInBlackTeam) {
        const currentTeam = isInWhiteTeam ? 'White' : 'Black';
        bot.sendMessage(chatId, `✅ You're already joined on the ${currentTeam} team!\n\nRefreshing board...`);
        await showGameStatus(chatId, gameState, username);
        return;
    }
    
    // Add user to the selected team
    if (team === 'white') {
        gameState.blackTeam = gameState.blackTeam.filter(p => p !== username);
        if (!gameState.whiteTeam.includes(username)) {
            gameState.whiteTeam.push(username);
        }
    } else if (team === 'black') {
        gameState.whiteTeam = gameState.whiteTeam.filter(p => p !== username);
        if (!gameState.blackTeam.includes(username)) {
            gameState.blackTeam.push(username);
        }
    }
    
    // Add to players list
    if (!gameState.players) {
        gameState.players = [];
    }
    if (!gameState.players.includes(username)) {
        gameState.players.push(username);
    }
    
    // Store the connection
    userToChannel.set(String(chatId), channelId);
    
    // Add user to joinedUsers list
    if (!gameState.joinedUsers) {
        gameState.joinedUsers = [];
    }
    if (!gameState.joinedUsers.includes(chatId)) {
        gameState.joinedUsers.push(chatId);
    }
    
    // Update the database
    await saveGame(db, {
        channelId: gameState.channelId,
        channelName: gameState.channelName,
        gameState: { fen: gameState.game.fen() },
        whiteTeam: gameState.whiteTeam,
        blackTeam: gameState.blackTeam,
        moveCount: gameState.game.history().length
    });
    
    const teamIcon = team === 'white' ? '⚪' : '⚫';
    bot.sendMessage(chatId, `${teamIcon} ${username} joined the ${team === 'white' ? 'White' : 'Black'} team!\nWhite: ${gameState.whiteTeam.join(', ')}\nBlack: ${gameState.blackTeam.join(', ') || 'None'}`);
    await showGameStatus(chatId, gameState, username);
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
            channelMessageId: null,
            moveDelay: {
                enabled: true,
                baseDelay: 900, // 15 minutes
                increment: 900  // +15 minutes per round
            },
            moveNumber: 0,
            lastMoveTime: null,
            roundEndTime: null
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
        // First check if there's a local game
        if (activeGames.has(chatId)) {
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
        
        // Query database for active games
        getActiveGames(db).then(games => {
            const keyboard = [];
            
            if (games.length === 0) {
                keyboard.push([{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]);
                bot.sendMessage(chatId, 'No active games found.', {
                    reply_markup: { inline_keyboard: keyboard }
                });
                return;
            }
            
            // Remove duplicates based on channelId
            const uniqueGames = games.filter((game, index, self) => 
                index === self.findIndex((g) => g.channelId === game.channelId)
            );
            
            // Show active games
            let message = `🎮 Active Games (${uniqueGames.length}):\n\n`;
            
            uniqueGames.forEach((game, index) => {
                const whiteTeam = JSON.parse(game.whiteTeam || '[]');
                const blackTeam = JSON.parse(game.blackTeam || '[]');
                const channelName = game.channelName || `Game ${game.id}`;
                
                message += `${index + 1}. ${channelName}\n`;
                message += `   ⚪ White: ${whiteTeam.length} player(s)\n`;
                message += `   ⚫ Black: ${blackTeam.length} player(s)\n`;
                message += `   🎯 Moves: ${game.moveCount}\n\n`;
                
                // Create button for each game
                keyboard.push([{ 
                    text: `${index + 1}. ${channelName}`, 
                    callback_data: `join_game_${game.channelId}` 
                }]);
            });
            
            // Add back button
            keyboard.push([{ text: '🔙 Back', callback_data: 'home' }]);
            
            bot.sendMessage(chatId, message, {
                reply_markup: { inline_keyboard: keyboard }
            });
        }).catch(error => {
            console.error('Error getting active games:', error);
            bot.sendMessage(chatId, 'Error loading games. Please try again.');
        });
        return;
    }
    
    // Handle joining a specific game from the list
    if (data.startsWith('join_game_')) {
        const channelId = data.replace('join_game_', '');
        
        // Try to get game from active games
        let gameState = activeGames.get(channelId);
        
        // If not in active games, try to load from database
        if (!gameState) {
            getGameByChannelId(db, channelId).then(dbGame => {
                if (!dbGame) {
                    bot.sendMessage(chatId, 'Game not found.');
                    return;
                }
                
                // Load the game state from database
                const gameStateData = JSON.parse(dbGame.gameState);
                const game = new Chess();
                game.load(gameStateData.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                
                // Reconstruct full game state with all required fields
                const whiteTeam = JSON.parse(dbGame.whiteTeam || '[]');
                const blackTeam = JSON.parse(dbGame.blackTeam || '[]');
                
                // Initialize move delay system
                const baseDelay = 900; // Start with 15 minutes delay between rounds
                const increment = 900; // Increase by 15 minutes each round (900 seconds = 15 minutes)
                
                gameState = {
                    game: game,
                    lastMove: null,
                    players: [...whiteTeam, ...blackTeam],
                    whiteTeam: whiteTeam,
                    blackTeam: blackTeam,
                    joinedUsers: [],
                    capturedPieces: { white: [], black: [] },
                    resignVotes: { white: [], black: [] },
                    drawVotes: { white: [], black: [] },
                    moveHistory: [],
                    channelId: dbGame.channelId,
                    channelName: dbGame.channelName,
                    channelMessageId: null,
                    moveDelay: {
                        enabled: true,
                        baseDelay: baseDelay,
                        increment: increment
                    },
                    lastMoveTime: null,
                    moveNumber: 0,
                    roundEndTime: null
                };
                
                // Store in active games
                activeGames.set(channelId, gameState);
                
                // Show side selection
                bot.sendMessage(chatId, 
                    `🎮 Joining: ${dbGame.channelName || `Game ${dbGame.id}`}\n\nChoose your side:`, 
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⚪ Join White', callback_data: `join_game_white_${channelId}` }],
                                [{ text: '⚫ Join Black', callback_data: `join_game_black_${channelId}` }]
                            ]
                        }
                    }
                );
            }).catch(error => {
                console.error('Error loading game from database:', error);
                bot.sendMessage(chatId, 'Error loading game.');
            });
            return;
        }
        
        // Game is in active games, show side selection
        bot.sendMessage(chatId, 
            `🎮 Joining: ${gameState.channelName || channelId}\n\nChoose your side:`, 
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⚪ Join White', callback_data: `join_game_white_${channelId}` }],
                        [{ text: '⚫ Join Black', callback_data: `join_game_black_${channelId}` }]
                    ]
                }
            }
        );
        return;
    }
    
    // Handle joining white team for a selected game
    if (data.startsWith('join_game_white_')) {
        const channelId = data.replace('join_game_white_', '');
        console.log('Attempting to join white team:', { channelId, chatId, username });
        
        // Check if game is in active games
        if (!activeGames.has(channelId)) {
            bot.sendMessage(chatId, 'Game not found in memory. Loading from database...');
            
            // Try to load from database
            getGameByChannelId(db, channelId).then(dbGame => {
                if (!dbGame) {
                    bot.sendMessage(chatId, 'Game not found.');
                    return;
                }
                
                const gameStateData = JSON.parse(dbGame.gameState);
                const game = new Chess();
                game.load(gameStateData.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                
                const whiteTeam = JSON.parse(dbGame.whiteTeam || '[]');
                const blackTeam = JSON.parse(dbGame.blackTeam || '[]');
                
                // Initialize time control
                const initialTime = 300;
                const increment = 3;
                
                const gameState = {
                    game: game,
                    lastMove: null,
                    players: [...whiteTeam, ...blackTeam],
                    whiteTeam: whiteTeam,
                    blackTeam: blackTeam,
                    joinedUsers: [],
                    capturedPieces: { white: [], black: [] },
                    resignVotes: { white: [], black: [] },
                    drawVotes: { white: [], black: [] },
                    moveHistory: [],
                    channelId: dbGame.channelId,
                    channelName: dbGame.channelName,
                    channelMessageId: null,
                    timeControl: {
                        enabled: true,
                        initialSeconds: initialTime,
                        incrementSeconds: increment
                    },
                    timeRemaining: {
                        white: initialTime,
                        black: initialTime
                    },
                    timerInterval: null
                };
                
                activeGames.set(channelId, gameState);
                
                // Now join
                handleGameJoin(channelId, chatId, username, 'white');
            }).catch(error => {
                console.error('Error loading game:', error);
                bot.sendMessage(chatId, 'Error loading game.');
            });
            return;
        }
        
        handleGameJoin(channelId, chatId, username, 'white');
        return;
    }
    
    // Handle joining black team for a selected game
    if (data.startsWith('join_game_black_')) {
        const channelId = data.replace('join_game_black_', '');
        console.log('Attempting to join black team:', { channelId, chatId, username });
        
        // Check if game is in active games
        if (!activeGames.has(channelId)) {
            bot.sendMessage(chatId, 'Game not found in memory. Loading from database...');
            
            // Try to load from database
            getGameByChannelId(db, channelId).then(dbGame => {
                if (!dbGame) {
                    bot.sendMessage(chatId, 'Game not found.');
                    return;
                }
                
                const gameStateData = JSON.parse(dbGame.gameState);
                const game = new Chess();
                game.load(gameStateData.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                
                const whiteTeam = JSON.parse(dbGame.whiteTeam || '[]');
                const blackTeam = JSON.parse(dbGame.blackTeam || '[]');
                
                // Initialize time control
                const initialTime = 300;
                const increment = 3;
                
                const gameState = {
                    gameэффици: game,
                    lastMove: null,
                    players: [...whiteTeam, ...blackTeam],
                    whiteTeam: whiteTeam,
                    blackTeam: blackTeam,
                    joinedUsers: [],
                    capturedPieces: { white: [], black: [] },
                    resignVotes: { white: [], black: [] },
                    drawVotes: { white: [], black: [] },
                    moveHistory: [],
                    channelId: dbGame.channelId,
                    channelName: dbGame.channelName,
                    channelMessageId: null,
                    timeControl: {
                        enabled: true,
                        initialSeconds: initialTime,
                        incrementSeconds: increment
                    },
                    timeRemaining: {
                        white: initialTime,
                        black: initialTime
                    },
                    timerInterval: null
                };
                
                activeGames.set(channelId, gameState);
                
                // Now join
                handleGameJoin(channelId, chatId, username, 'black');
            }).catch(error => {
                console.error('Error loading game:', error);
                bot.sendMessage(chatId, 'Error loading game.');
            });
            return;
        }
        
        handleGameJoin(channelId, chatId, username, 'black');
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
        
        // Check if user is already in a team
        const isInWhiteTeam = gameState.whiteTeam.includes(username);
        const isInBlackTeam = gameState.blackTeam.includes(username);
        
        if (isInWhiteTeam || isInBlackTeam) {
            const currentTeam = isInWhiteTeam ? 'White' : 'Black';
            bot.sendMessage(chatId, `✅ You're already joined on the ${currentTeam} team!\n\nRefreshing board...`);
            
            // Make sure userToChannel is set for existing players
            if (!userToChannel.has(String(chatId))) {
                userToChannel.set(String(chatId), channelId);
            }
            
            // Make sure user is in joinedUsers list
            if (!gameState.joinedUsers) {
                gameState.joinedUsers = [];
            }
            if (!gameState.joinedUsers.includes(chatId)) {
                gameState.joinedUsers.push(chatId);
            }
            
            await showGameStatus(chatId, gameState, username);
            return;
        }
        
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
        if (!gameState.joinedUsers) {
            gameState.joinedUsers = [];
        }
        if (!gameState.joinedUsers.includes(chatId)) {
            gameState.joinedUsers.push(chatId);
        }
        
        // Save to database
        await saveGame(db, {
            channelId: gameState.channelId,
            channelName: gameState.channelName || gameState.channelId,
            gameState: { fen: gameState.game.fen() },
            whiteTeam: gameState.whiteTeam,
            blackTeam: gameState.blackTeam,
            moveCount: gameState.game.history().length
        });
        
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
        
        // Check if user is already in a team
        const isInWhiteTeam = gameState.whiteTeam.includes(username);
        const isInBlackTeam = gameState.blackTeam.includes(username);
        
        if (isInWhiteTeam || isInBlackTeam) {
            const currentTeam = isInWhiteTeam ? 'White' : 'Black';
            bot.sendMessage(chatId, `✅ You're already joined on the ${currentTeam} team!\n\nRefreshing board...`);
            
            // Make sure userToChannel is set for existing players
            if (!userToChannel.has(String(chatId))) {
                userToChannel.set(String(chatId), channelId);
            }
            
            // Make sure user is in joinedUsers list
            if (!gameState.joinedUsers) {
                gameState.joinedUsers = [];
            }
            if (!gameState.joinedUsers.includes(chatId)) {
                gameState.joinedUsers.push(chatId);
            }
            
            await showGameStatus(chatId, gameState, username);
            return;
        }
        
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
        if (!gameState.joinedUsers) {
            gameState.joinedUsers = [];
        }
        if (!gameState.joinedUsers.includes(chatId)) {
            gameState.joinedUsers.push(chatId);
        }
        
        // Save to database
        await saveGame(db, {
            channelId: gameState.channelId,
            channelName: gameState.channelName || gameState.channelId,
            gameState: { fen: gameState.game.fen() },
            whiteTeam: gameState.whiteTeam,
            blackTeam: gameState.blackTeam,
            moveCount: gameState.game.history().length
        });
        
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
            `📖 How to play:\n` +
            `1. Click "New Game" to start\n` +
            `2. Click "Join Game" to join (anyone can play)\n` +
            `3. Make moves by clicking the buttons below the board\n` +
            `4. Moves are validated automatically\n\n` +
            `⏱️ Timer System:\n` +
            `• Round in progress: After first player moves, second can move immediately\n` +
            `• Round complete: After both move, timer starts (15 min round 1, +15 min each round)\n` +
            `• Both teams must wait for timer to expire before next round starts\n` +
            `• Check the board for timer countdown and current status`,
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
                
                // Delete from database if it's a channel game
                if (gameState.channelId) {
                    await deleteGame(db, gameState.channelId);
                }
                
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
        
        // Check if enough time has passed since last round ended
        if (!canMakeMove(targetGameState)) {
            const remaining = getRemainingDelay(targetGameState);
            const formattedTime = formatTime(remaining);
            const moveNumber = targetGameState.moveNumber || 0;
            const roundNumber = Math.floor(moveNumber / 2);
            bot.sendMessage(chatId, 
                `⏳ Timer is still counting down!\n\n` +
                `Round ${roundNumber} is complete. Please wait ${formattedTime} for the timer to expire before starting round ${roundNumber + 1}.\n\n` +
                `(Both sides must wait after completing a round)`
            );
            await showGameStatus(chatId, targetGameState, username);
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
            
            // Update move tracking
            targetGameState.lastMoveTime = Date.now();
            targetGameState.moveNumber = (targetGameState.moveNumber || 0) + 1;
            
            // If round is complete (both sides moved), start the timer
            // moveNumber is now even (2, 4, 6...) = both sides have moved
            if (targetGameState.moveNumber % 2 === 0) {
                targetGameState.roundEndTime = Date.now();
            }
            
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
            
            // Save to database if this is a channel game
            if (targetGameState.channelId) {
                await saveGame(db, {
                    channelId: targetGameState.channelId,
                    channelName: targetGameState.channelName || targetGameState.channelId,
                    gameState: { fen: targetGame.fen() },
                    whiteTeam: targetGameState.whiteTeam,
                    blackTeam: targetGameState.blackTeam,
                    moveCount: targetGame.history().length
                });
                
                // If game is over, delete from database
                if (targetGame.isGameOver()) {
                    await deleteGame(db, targetGameState.channelId);
                }
            }
            
            // Notify about the move
            let moveNotification = `✅ ${username} played: ${moveDescription}`;
            
            // If round just completed (both sides moved), inform players timer has started
            if (targetGameState.moveNumber % 2 === 0 && targetGameState.moveDelay && targetGameState.moveDelay.enabled) {
                const roundNumber = Math.floor(targetGameState.moveNumber / 2);
                // First round (roundNumber=1) gets baseDelay only, subsequent rounds add increment
                const timeLimit = targetGameState.moveDelay.baseDelay + (targetGameState.moveDelay.increment * (roundNumber - 1));
                const formattedTime = formatTime(timeLimit);
                moveNotification += `\n\n⏰ Round ${roundNumber} complete! Timer started: ${formattedTime} before next round`;
            }
            
            bot.sendMessage(chatId, moveNotification);
            
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
    // Initialize move delay system
    const baseDelay = 900; // Start with 15 minutes delay between rounds
    const increment = 900; // Increase by 15 minutes each round (900 seconds = 15 minutes)
    
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
        channelMessageId: null,
        moveDelay: {
            enabled: true,
            baseDelay: baseDelay,
            increment: increment
        },
        lastMoveTime: null,
        moveNumber: 0,
        roundEndTime: null
    });
    
    // Get channel name for database
    let channelName = channelId;
    try {
        const chat = await bot.getChat(channelId);
        channelName = chat.title || chat.username || channelId;
        activeGames.get(gameKey).channelName = channelName;
    } catch (error) {
        console.error('Error getting channel info:', error);
    }
    
    // Save to database
    await saveGame(db, {
        channelId: String(channelId),
        channelName: channelName,
        gameState: { fen: newGame.fen() },
        whiteTeam: [],
        blackTeam: [],
        moveCount: 0
    });
    
    // Show the board in channel
    await showGameStatus(channelId, activeGames.get(gameKey), username, false);
    
    // Send instructions with deep link
    const botInfo = await bot.getMe();
    const deepLink = `https://t.me/${botInfo.username}?start=channel_${channelId}`;
    
    await bot.sendMessage(channelId, 
        `🎮 Chess Game Started! 🎮\n\n` +
        `📱 Click "Join & Play" on the board above to start playing! 👆\n\n` +
        `⚪ White plays first!\n` +
        `👥 Anyone can join the game!\n\n` +
        `⏱️ Timer System:\n` +
        `• During rounds: Players can move immediately (no waiting)\n` +
        `• After both move: 15 min timer starts (increases each round)\n` +
        `• Both teams wait for timer to expire before next round`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 Join & Play', url: deepLink }]
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
            `Choose an option from the buttons below to get started.\n\n` +
            `⏱️ Timer System:\n` +
            `• During a round: Players can move immediately (no waiting)\n` +
            `• After both sides move: Timer starts (15 min for round 1, increases each round)\n` +
            `• Both teams wait until timer expires before next round begins`,
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

