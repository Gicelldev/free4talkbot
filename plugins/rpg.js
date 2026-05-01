const economy = require('../economy.js');

module.exports = {
    commands: ['hunt', 'heal', 'adventure', 'adv'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        if (cmd === 'hunt') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);
            const cooldownCheck = economy.checkCooldown(user.lastHunt, db.settings.huntReward.cooldown);

            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`⏰ ${sender.name}, hunt masih cooldown! Tunggu ${timeLeft} lagi.`);
            }

            if (user.health !== undefined && user.health < 20) {
                return await sendMessage(`⚠️ ${sender.name}, HP kamu tinggal ${user.health}! Heal dulu pake !heal atau !use potion`);
            }

            let multiplier = 1;
            const sword = user.inventory ? user.inventory.find(i => i.name.includes('Sword')) : null;
            if (sword) {
                multiplier = 1.2;
            }

            const luckyCharm = user.inventory ? user.inventory.find(i => i.name.includes('Lucky Charm')) : null;
            if (luckyCharm) {
                multiplier += 0.5;
            }

            const baseReward = economy.random(db.settings.huntReward.min, db.settings.huntReward.max);
            const reward = Math.floor(baseReward * multiplier);

            let damage = Math.floor(Math.random() * 10) + 5;
            if (sword) damage = Math.max(1, damage - 2);

            const xpGain = Math.floor((Math.random() * 50 + 20) * multiplier);

            user.balance += reward;
            user.lastHunt = Date.now();
            user.stats.hunts++;

            if (user.health !== undefined) user.health -= damage;

            const leveledUp = economy.addXp(user, xpGain);

            economy.saveEconomyDB(db);

            const animals = ['🦊', '🐰', '🦌', '🐗', '🦅', '🐺', '🦁'];
            const animal = animals[Math.floor(Math.random() * animals.length)];

            let resultMsg = `🏹 ${sender.name} berburu ${animal}!\n`;
            resultMsg += `💰 +${reward} ${db.settings.currency}`;
            if (multiplier > 1) resultMsg += ` (Boosted!)`;
            resultMsg += `\n❤️ -${damage} HP | ⭐ +${xpGain} XP`;

            if (leveledUp) {
                resultMsg += `\n🎉 LEVEL UP! Level ${user.level} (Full Heal + Bonus Coins)`;
            }

            resultMsg += `\nBalance: ${user.balance}`;

            await sendMessage(resultMsg);
        }

        else if (cmd === 'heal') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);

            const potionIndex = user.inventory ? user.inventory.findIndex(i => i.name.toLowerCase().includes('potion')) : -1;

            if (potionIndex === -1 && user.balance < 500) {
                return await sendMessage(`❌ Gak punya Potion dan uang kurang dari 500!`);
            }

            let healAmount = 50;
            let costMsg = "";

            if (potionIndex !== -1) {
                user.inventory.splice(potionIndex, 1);
                costMsg = "menggunakan Potion";
            } else {
                user.balance -= 500;
                costMsg = "membayar 500 coins";
            }

            user.health = Math.min((user.health || 0) + healAmount, user.maxHealth || 100);
            economy.saveEconomyDB(db);

            await sendMessage(`💊 ${sender.name} ${costMsg} untuk heal!\n❤️ HP: ${user.health}/${user.maxHealth}`);
        }

        else if (cmd === 'adventure' || cmd === 'adv') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);

            const cooldownCheck = economy.checkCooldown(user.lastAdventure, 300000);
            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`⏰ ${sender.name}, istirahat dulu! Tunggu ${timeLeft} lagi.`);
            }

            if (user.health !== undefined && user.health < 50) {
                return await sendMessage(`⚠️ ${sender.name}, HP minimal 50 untuk adventure! HP: ${user.health}`);
            }

            const locations = ['Hutan Terlarang', 'Goa Naga', 'Pulau Hantu', 'Castle Dark', 'Dungeon Bawah Tanah'];
            const loc = locations[Math.floor(Math.random() * locations.length)];

            let hpLoss = Math.floor(Math.random() * 30) + 20;

            const armor = user.inventory ? user.inventory.find(i => i.name.includes('Armor')) : null;
            if (armor) {
                hpLoss = Math.max(5, hpLoss - 15);
            }

            const coinGain = Math.floor(Math.random() * 1000) + 500;
            const xpGain = Math.floor(Math.random() * 150) + 100;

            user.balance += coinGain;
            user.health -= hpLoss;
            user.lastAdventure = Date.now();

            const leveledUp = economy.addXp(user, xpGain);

            economy.saveEconomyDB(db);

            let advMsg = `🗺️ ${sender.name} berpetualang ke ${loc}!\n❤️ -${hpLoss} HP\n💰 +${coinGain} coins\n⭐ +${xpGain} XP`;

            if (leveledUp) {
                advMsg += `\n🎉 LEVEL UP! Level ${user.level} (Full Heal + Bonus Coins)`;
            }

            await sendMessage(advMsg);
        }
    }
};
