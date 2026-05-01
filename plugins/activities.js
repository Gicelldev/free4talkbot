const economy = require('../economy.js');

module.exports = {
    commands: ['fish', 'mancing', 'mine', 'nambang'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        if (cmd === 'fish' || cmd === 'mancing') {
            const hasRod = user.inventory ? user.inventory.find(i => i.name.toLowerCase().includes('fishing rod')) : false;
            if (!hasRod) return await sendMessage(`❌ Kamu butuh **Fishing Rod** buat mancing! Beli di !shop dulu.`);

            const cooldownCheck = economy.checkCooldown(user.lastFishing, 120000);
            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`⏰ Ikan lagi bobo, tunggu ${timeLeft} lagi!`);
            }

            const fishTypes = [
                { name: '🐟 Ikan Teri', price: 50, xp: 5, chance: 0.4 },
                { name: '🐠 Ikan Nemo', price: 100, xp: 10, chance: 0.3 },
                { name: '🐡 Ikan Buntal', price: 200, xp: 15, chance: 0.15 },
                { name: '🦈 Ikan Hiu', price: 500, xp: 50, chance: 0.05 },
                { name: '👟 Sepatu Bekas', price: 0, xp: 1, chance: 0.1 }
            ];

            if (hasRod) {
                fishTypes[2].chance += 0.05;
                fishTypes[3].chance += 0.05;
                fishTypes[4].chance -= 0.05;
            }

            const rand = Math.random();
            let catchItem = fishTypes[fishTypes.length - 1];
            let cumulative = 0;

            for (let fish of fishTypes) {
                cumulative += fish.chance;
                if (rand <= cumulative) {
                    catchItem = fish;
                    break;
                }
            }

            user.balance += catchItem.price;
            user.lastFishing = Date.now();
            const leveledUp = economy.addXp(user, catchItem.xp);

            economy.saveEconomyDB(db);

            let msg = `🎣 ${sender.name} mancing dapet: **${catchItem.name}**\n`;
            if (catchItem.price > 0) msg += `💰 +${catchItem.price} coins\n`;
            msg += `⭐ +${catchItem.xp} XP`;

            if (leveledUp) msg += `\n🎉 LEVEL UP! Level ${user.level}`;

            await sendMessage(msg);
        }

        else if (cmd === 'mine' || cmd === 'nambang') {
            const hasPickaxe = user.inventory ? user.inventory.find(i => i.name.toLowerCase().includes('pickaxe')) : false;
            if (!hasPickaxe) return await sendMessage(`❌ Kamu butuh **Pickaxe** buat nambang! Beli di !shop dulu.`);

            const cooldownCheck = economy.checkCooldown(user.lastMining, 300000);
            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`⏰ Tenaga habis, tunggu ${timeLeft} lagi!`);
            }

            if (user.health < 10) return await sendMessage(`⚠️ HP kamu sekarat (${user.health})! Heal dulu biar kuat nambang.`);

            const ores = [
                { name: '🪨 Batu', price: 10, xp: 2, chance: 0.4 },
                { name: '🔩 Iron Ore', price: 50, xp: 10, chance: 0.3 },
                { name: '📀 Gold Ore', price: 150, xp: 30, chance: 0.15 },
                { name: '💎 Diamond', price: 500, xp: 100, chance: 0.05 },
                { name: '🧨 ZONK', price: 0, xp: 0, chance: 0.1 }
            ];

            const rand = Math.random();
            let mineItem = ores[ores.length - 1];
            let cumulative = 0;

            for (let ore of ores) {
                cumulative += ore.chance;
                if (rand <= cumulative) {
                    mineItem = ore;
                    break;
                }
            }

            const hpLoss = Math.floor(Math.random() * 5) + 5;
            user.health -= hpLoss;
            user.balance += mineItem.price;
            user.lastMining = Date.now();
            const leveledUp = economy.addXp(user, mineItem.xp);

            economy.saveEconomyDB(db);

            let msg = `⛏️ ${sender.name} nambang dapet: **${mineItem.name}**\n`;
            if (mineItem.name === '🧨 ZONK') msg = `⛏️ ${sender.name} nambang tapi longsor! 🧨 ZONK!\n`;

            if (mineItem.price > 0) msg += `💰 +${mineItem.price} coins\n`;
            msg += `⭐ +${mineItem.xp} XP\n❤️ -${hpLoss} HP`;

            if (leveledUp) msg += `\n🎉 LEVEL UP! Level ${user.level}`;

            await sendMessage(msg);
        }
    }
};
