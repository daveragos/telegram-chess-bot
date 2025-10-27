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

const bot = new TelegramBot(token, { polling: true });

// Game state storage - stores active games per chat
// Key: chatId, Value: { game, lastMove, players, lastMessageId, moveHistory }
const activeGames = new Map();

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
async function showGameStatus(chatId, gameState, username = '') {
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
    
    // Add move history if available
    if (gameState.moveHistory && gameState.moveHistory.length > 0) {
        const recentMoves = gameState.moveHistory.slice(-5); // Show last 5 moves
        statusMessage += `\n\n📜 Recent moves:`;
        recentMoves.forEach((move, index) => {
            statusMessage += `\n${move.number}. ${move.player}: ${move.move}`;
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
        { text: '🔄 Refresh', callback_data: 'refresh' },
        { text: '❌ Resign', callback_data: 'resign' }
    ]);
    
    const options = {
        reply_markup: {
            inline_keyboard: keyboard
        },
        caption: statusMessage
    };
    
    // Send the board image with buttons
    const imageStream = fs.createReadStream(imagePath);
    bot.sendPhoto(chatId, imageStream, options);
    
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
        activeGames.set(chatId, {
            game: newGame,
            lastMove: null,
            players: [username],
            moveHistory: []
        });
        bot.sendMessage(chatId, `🎮 New game started by ${username}!`);
        await showGameStatus(chatId, activeGames.get(chatId), username);
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
        if (!gameState.players.includes(username)) {
            gameState.players.push(username);
        }
        bot.sendMessage(chatId, `👤 ${username} joined the game!\nPlayers: ${gameState.players.join(', ')}`);
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
    if (!activeGames.has(chatId)) {
        // Only show no game message for refresh/resign, not for home
        if (data === 'refresh' || data === 'resign') {
            const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
            bot.sendMessage(chatId, 'No active game found.', {
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        return;
    }
    
    const gameState = activeGames.get(chatId);
    const { game } = gameState;
    
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
        await showGameStatus(chatId, gameState, username);
        return;
    }
    
    if (data === 'resign') {
        activeGames.delete(chatId);
        bot.sendMessage(chatId, `🏳️ ${username} resigned. Game ended.`);
        return;
    }
    
    if (data.startsWith('move_')) {
        // Check if game is over
        if (game.isGameOver()) {
            const keyboard = [[{ text: '🎮 Start New Game', callback_data: 'start_newgame' }]];
            bot.sendMessage(chatId, 'Game is over.', {
                reply_markup: { inline_keyboard: keyboard }
            });
            return;
        }
        
        // Extract move notation
        const moveNotation = data.replace('move_', '');
        
        try {
            // Try to make the move
            const move = game.move(moveNotation);
            
            if (!move) {
                bot.sendMessage(chatId, `❌ Invalid move: ${moveNotation}`);
                await showGameStatus(chatId, gameState, username);
                return;
            }
            
            // Move was successful
            gameState.lastMove = {
                player: username,
                move: moveNotation,
                timestamp: new Date()
            };
            
            // Add move to history
            if (!gameState.moveHistory) {
                gameState.moveHistory = [];
            }
            gameState.moveHistory.push({
                number: gameState.moveHistory.length + 1,
                player: username,
                move: `${move.from} → ${move.to}`
            });
            
            const moveDescription = `${move.from} → ${move.to}`;
            
            // Notify about the move
            bot.sendMessage(chatId, `✅ ${username} played: ${moveDescription}`);
            
            // Show updated board
            await showGameStatus(chatId, gameState, username);
            
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            await showGameStatus(chatId, gameState, username);
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

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
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
bot.onText(/\/newgame/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Check if a game already exists
    if (activeGames.has(chatId)) {
        bot.sendMessage(chatId, 'There is already an active game. Use /join to join the current game.');
        return;
    }
    
    // Create a new game
    const newGame = new Chess();
    activeGames.set(chatId, {
        game: newGame,
        lastMove: null,
        players: [username],
        moveHistory: []
    });
    
    bot.sendMessage(chatId, `🎮 New game started by ${username}!`);
    showGameStatus(chatId, activeGames.get(chatId), username);
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
        
        // Add move to history
        if (!gameState.moveHistory) {
            gameState.moveHistory = [];
        }
        gameState.moveHistory.push({
            number: gameState.moveHistory.length + 1,
            player: username,
            move: `${move.from} → ${move.to}`
        });
        
        const moveDescription = `${move.from} → ${move.to}`;
        
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

console.log('🤖 Chess Bot is running...');

