const fs = require('fs');
const path = require('path');

const ECONOMY_DB_PATH = path.join(__dirname, 'economy.json');

function loadEconomyDB() {
    try {
        const data = fs.readFileSync(ECONOMY_DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Failed to load economy.json:', e.message);
        return {
            users: {},
            settings: {
                currency: 'coins',
                dailyReward: { min: 500, max: 1000, cooldown: 86400000 },
                huntReward: { min: 100, max: 500, cooldown: 60000 },
                startingBalance: 1000
            }
        };
    }
}

function saveEconomyDB(db) {
    try {
        fs.writeFileSync(ECONOMY_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Failed to save economy.json:', e.message);
        return false;
    }
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}h ${hours % 24}j`;
    if (hours > 0) return `${hours}j ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}d`;
    return `${seconds}d`;
}

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getUser(db, userId, name) {
    if (!db.users[userId]) {
        if (db.users[name]) {
            db.users[userId] = db.users[name];
            delete db.users[name];
        } else {
            db.users[userId] = {
                name: name,
                balance: 100,
                health: 100,
                maxHealth: 100,
                level: 0,
                exp: 0,
                armor: 0,
                inventory: [],
                lastDaily: null,
                lastHunt: null,
                lastAdventure: null,
                stats: { hunts: 0, dailies: 0 },
                createdAt: Date.now()
            };
        }
    }
    if (!db.users[userId].health) db.users[userId].health = 100;
    if (!db.users[userId].maxHealth) db.users[userId].maxHealth = 100;
    if (!db.users[userId].level) db.users[userId].level = 0;
    if (!db.users[userId].exp) db.users[userId].exp = 0;

    return db.users[userId];
}

function checkCooldown(lastTime, cooldownMs) {
    const now = Date.now();
    if (!lastTime) return { ready: true };
    const diff = now - lastTime;
    if (diff >= cooldownMs) return { ready: true };
    return { ready: false, timeLeft: cooldownMs - diff };
}

function addXp(user, amount) {
    if (!user.exp) user.exp = 0;
    if (!user.level) user.level = 0;

    user.exp += amount;

    const nextLevelXp = (user.level + 1) * 1000;
    let leveledUp = false;

    if (user.exp >= nextLevelXp) {
        user.level++;
        user.exp -= nextLevelXp;
        user.health = user.maxHealth || 100;
        user.balance += 1000 * user.level;
        leveledUp = true;
    }

    return leveledUp;
}

module.exports = {
    loadEconomyDB,
    saveEconomyDB,
    getUser,
    checkCooldown,
    addXp,
    formatTime,
    random
};
