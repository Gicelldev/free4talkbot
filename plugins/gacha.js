const economy = require('../economy.js');

module.exports = {
    commands: ['open', 'gacha'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {
        if (!args) return await sendMessage('❓ Format: !open <crate type> [jumlah]\nCrates: Common, Uncommon, Mythic, Legendary');

        const parts = args.split(' ');
        const crateType = parts[0].toLowerCase();
        let amount = parseInt(parts[1]) || 1;

        if (amount < 1) amount = 1;

        const validCrates = ['common', 'uncommon', 'mythic', 'legendary'];
        if (!validCrates.includes(crateType)) {
            return await sendMessage(`❌ Crate type salah! List: Common, Uncommon, Mythic, Legendary`);
        }

        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        const itemIndex = user.inventory ? user.inventory.findIndex(i => i.name.toLowerCase().includes(`${crateType} crate`)) : -1;
        const userCrates = user.inventory ? user.inventory.filter(i => i.name.toLowerCase().includes(`${crateType} crate`)).length : 0;

        if (userCrates < amount) {
            return await sendMessage(`❌ Kamu cuma punya ${userCrates} ${crateType} crate(s)!`);
        }

        let totalReward = { money: 0, xp: 0, potion: 0, diamond: 0 };
        let rareDrops = [];

        for (let k = 0; k < amount; k++) {
            const idx = user.inventory.findIndex(i => i.name.toLowerCase().includes(`${crateType} crate`));
            if (idx > -1) user.inventory.splice(idx, 1);

            if (crateType === 'common') {
                totalReward.money += Math.floor(Math.random() * 500);
                totalReward.xp += Math.floor(Math.random() * 100);
                if (Math.random() < 0.3) totalReward.potion += 1;
            }
            else if (crateType === 'uncommon') {
                totalReward.money += Math.floor(Math.random() * 2000);
                totalReward.xp += Math.floor(Math.random() * 300);
                if (Math.random() < 0.5) totalReward.potion += 2;
                if (Math.random() < 0.1) totalReward.diamond += 1;
            }
            else if (crateType === 'mythic') {
                totalReward.money += Math.floor(Math.random() * 10000);
                totalReward.xp += Math.floor(Math.random() * 1000);
                totalReward.potion += Math.floor(Math.random() * 5);
                totalReward.diamond += Math.floor(Math.random() * 3);
                if (Math.random() < 0.05) rareDrops.push('Legendary Crate');
            }
            else if (crateType === 'legendary') {
                totalReward.money += Math.floor(Math.random() * 50000);
                totalReward.xp += Math.floor(Math.random() * 10000);
                totalReward.potion += Math.floor(Math.random() * 10);
                totalReward.diamond += Math.floor(Math.random() * 10);
                if (Math.random() < 0.2) rareDrops.push('Pet Crate');
            }
        }

        user.balance += totalReward.money;
        user.exp += totalReward.xp;

        if (totalReward.potion > 0) {
            for (let i = 0; i < totalReward.potion; i++) user.inventory.push({ name: 'Potion', type: 'consumable', effect: { heal: 50 }, boughtAt: Date.now() });
        }

        if (rareDrops.length > 0) {
            rareDrops.forEach(drop => {
                user.inventory.push({ name: drop, type: 'gacha', effect: {}, boughtAt: Date.now() });
            });
        }

        economy.saveEconomyDB(db);

        let replyMsg = `📦 ${sender.name} opened ${amount} ${crateType} crate(s)!\n`;
        replyMsg += `💰 +${totalReward.money} coins\n`;
        replyMsg += `⭐ +${totalReward.xp} XP\n`;
        if (totalReward.potion > 0) replyMsg += `💊 +${totalReward.potion} Potions\n`;
        if (totalReward.diamond > 0) replyMsg += `💎 +${totalReward.diamond} Diamonds\n`;
        if (rareDrops.length > 0) replyMsg += `✨ RARE DROPS: ${rareDrops.join(', ')}`;

        await sendMessage(replyMsg.trim());
    }
};
