const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'games.db');

// Initialize database
function initDatabase() {
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Error opening database:', err);
        } else {
            console.log('Connected to SQLite database');
        }
    });

    // Create games table
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channelId TEXT UNIQUE,
            channelName TEXT,
            gameState TEXT,
            whiteTeam TEXT,
            blackTeam TEXT,
            moveCount INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS game_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gameId INTEGER,
            userId TEXT,
            username TEXT,
            team TEXT,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(gameId) REFERENCES games(id) ON DELETE CASCADE
        )`);
    });

    return db;
}

// Get all active games
function getActiveGames(db) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM games ORDER BY updated_at DESC`, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

// Get game by channelId
function getGameByChannelId(db, channelId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM games WHERE channelId = ?`, [channelId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// Save or update game
function saveGame(db, gameData) {
    return new Promise((resolve, reject) => {
        const { channelId, channelName, gameState, whiteTeam, blackTeam, moveCount } = gameData;
        
        // Convert arrays to JSON strings for storage
        const whiteTeamStr = JSON.stringify(whiteTeam || []);
        const blackTeamStr = JSON.stringify(blackTeam || []);
        const gameStateStr = JSON.stringify(gameState);

        db.run(`INSERT OR REPLACE INTO games 
            (channelId, channelName, gameState, whiteTeam, blackTeam, moveCount, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [channelId, channelName, gameStateStr, whiteTeamStr, blackTeamStr, moveCount],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            }
        );
    });
}

// Delete game
function deleteGame(db, channelId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM games WHERE channelId = ?`, [channelId], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
}

module.exports = {
    initDatabase,
    getActiveGames,
    getGameByChannelId,
    saveGame,
    deleteGame
};

