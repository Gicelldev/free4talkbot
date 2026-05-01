const economy = require('../economy.js');

module.exports = {
    commands: ['daily', 'balance', 'bal', 'give', 'leaderboard', 'lb'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        if (cmd === 'daily') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);
            const cooldownCheck = economy.checkCooldown(user.lastDaily, db.settings.dailyReward.cooldown);

            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`⏰ ${sender.name}, daily sudah diambil! Tunggu ${timeLeft} lagi.`);
            }

            let multiplier = 1;
            const luckyCharm = user.inventory.find(i => i.name.includes('Lucky Charm'));
            if (luckyCharm) multiplier = luckyCharm.effect.dailyBoost || 2;

            const baseReward = economy.random(db.settings.dailyReward.min, db.settings.dailyReward.max);
            const reward = Math.floor(baseReward * multiplier);

            user.balance += reward;
            user.lastDaily = Date.now();
            user.stats.dailies++;
            economy.saveEconomyDB(db);

            let rewardMsg = `💰 ${sender.name} mendapat daily reward: ${reward} ${db.settings.currency}!`;
            if (multiplier > 1) rewardMsg += `\n✨ Boosted by Lucky Charm (x${multiplier})`;
            rewardMsg += `\nBalance: ${user.balance} ${db.settings.currency}`;

            await sendMessage(rewardMsg);
        }

        else if (cmd === 'balance' || cmd === 'bal') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);
            await sendMessage(`💰 ${sender.name}'s Balance: ${user.balance} ${db.settings.currency}`);
        }

        else if (cmd === 'give') {
            if (!args) return await sendMessage('❓ Format: !give <nama/@mention> <jumlah>');

            const parts = args.split(' ');
            if (parts.length < 2) return await sendMessage('❓ Format: !give <nama/@mention> <jumlah>');

            const amount = parseInt(parts[parts.length - 1]);
            let targetName = parts.slice(0, -1).join(' ');

            if (targetName.startsWith('@')) targetName = targetName.substring(1);

            if (isNaN(amount) || amount <= 0) return await sendMessage('❌ Jumlah harus angka positif!');
            if (targetName.toLowerCase() === sender.name.toLowerCase()) return await sendMessage('❌ Tidak bisa give ke diri sendiri!');

            const senderUserId = sender.uid || userMap.get(sender.name) || sender.name;
            let targetUserId = userMap.get(targetName);

            if (!targetUserId) {
                const matchedName = Array.from(userMap.keys()).find(name =>
                    name.toLowerCase().includes(targetName.toLowerCase()) ||
                    targetName.toLowerCase().includes(name.toLowerCase())
                );
                if (matchedName) {
                    targetUserId = userMap.get(matchedName);
                    targetName = matchedName;
                } else {
                    targetUserId = targetName;
                }
            }

            const senderUser = economy.getUser(db, senderUserId, sender.name);
            const targetUser = economy.getUser(db, targetUserId, targetName);

            if (senderUser.balance < amount) {
                return await sendMessage(`❌ ${sender.name}, balance tidak cukup! (Balance: ${senderUser.balance} ${db.settings.currency})`);
            }

            senderUser.balance -= amount;
            targetUser.balance += amount;
            senderUser.stats.given += amount;
            targetUser.stats.received += amount;
            economy.saveEconomyDB(db);

            await sendMessage(`💸 ${sender.name} memberi ${amount} ${db.settings.currency} ke ${targetName}!\n${sender.name}: ${senderUser.balance} | ${targetName}: ${targetUser.balance}`);
        }

        else if (cmd === 'leaderboard' || cmd === 'lb' || cmd === 'top') {
            const users = Object.values(db.users);

            const topRich = [...users].sort((a, b) => b.balance - a.balance).slice(0, 10);

            const topStrong = [...users].sort((a, b) => b.level - a.level).slice(0, 5);

            let lbMsg = `🏆 **LEADERBOARD SERVER** 🏆\n\n`;

            lbMsg += `💰 **TOP SULTAN (Richest)**\n`;
            topRich.forEach((u, i) => {
                let rank = `${i + 1}.`;
                if (i === 0) rank = '🥇';
                if (i === 1) rank = '🥈';
                if (i === 2) rank = '🥉';

                lbMsg += `${rank} **${u.name}** — ${u.balance.toLocaleString()} ${db.settings.currency}\n`;
            });

            lbMsg += `\n💪 **TOP SEPUH (Highest Level)**\n`;
            topStrong.forEach((u, i) => {
                let rank = `${i + 1}.`;
                if (i === 0) rank = '🥇';
                if (i === 1) rank = '🥈';
                if (i === 2) rank = '🥉';

                lbMsg += `${rank} **${u.name}** — Lvl ${u.level} (${u.exp} XP)\n`;
            });

            lbMsg += `\n🔥 _Keep grinding to reach the top!_`;

            await sendMessage(lbMsg.trim());
        }
    }
};
