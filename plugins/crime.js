const economy = require('../economy.js');

module.exports = {
    commands: ['rob', 'rampok', 'bankrob'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        if (cmd === 'rob' || cmd === 'rampok') {
            if (!args) return await sendMessage('❓ Targetnya siapa? Format: !rob <nama/@mention>');

            const hasMask = user.inventory ? user.inventory.find(i => i.name.toLowerCase().includes('topeng')) : false;

            const cooldownCheck = economy.checkCooldown(user.lastRob, 600000);
            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`🚓 Polisi lagi patroli! Tunggu ${timeLeft} lagi.`);
            }

            let targetName = args.split(' ')[0];
            if (targetName.startsWith('@')) targetName = targetName.substring(1);
            if (targetName.toLowerCase() === sender.name.toLowerCase()) return await sendMessage('❌ Gak bisa ngerampok diri sendiri, aneh lu.');

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

            const targetUser = economy.getUser(db, targetUserId, targetName);

            if (targetName.toLowerCase().includes('gilang') || targetName.toLowerCase().includes('raja')) {
                return await sendMessage(`😡 **WOI!** Masa lu mau nge-rob Developer?! Gak tau diri banget! Auto kualat lu.`);
            }

            if (targetUser.balance < 100) return await sendMessage(`❌ ${targetName} miskin banget, gak tega ngerampoknya.`);

            let successChance = 0.3;
            if (hasMask) successChance += 0.2;

            user.lastRob = Date.now();

            if (Math.random() < successChance) {
                const percent = (Math.random() * 0.2) + 0.05;
                const stolen = Math.floor(targetUser.balance * percent);

                targetUser.balance -= stolen;
                user.balance += stolen;
                user.stats.robSuccess = (user.stats.robSuccess || 0) + 1;

                economy.saveEconomyDB(db);
                await sendMessage(`🥷 SUKSES! ${sender.name} berhasil merampok ${stolen} coin dari ${targetName}! Kaburrr! 🏃`);
            } else {
                const fine = 500;
                user.balance = Math.max(0, user.balance - fine);
                user.stats.robFail = (user.stats.robFail || 0) + 1;

                economy.saveEconomyDB(db);
                await sendMessage(`🚓 GAGAL! ${sender.name} ketangkep polisi saat mau ngerampok ${targetName}! Didenda ${fine} coin.`);
            }
        }

        else if (cmd === 'bankrob') {
            const hasLockpick = user.inventory ? user.inventory.find(i => i.name.toLowerCase().includes('lockpick')) : false;
            if (!hasLockpick) return await sendMessage(`❌ Lu butuh **Lockpick** buat bobol bank! Beli di shop.`);

            const cooldownCheck = economy.checkCooldown(user.lastBankRob, 3600000);
            if (!cooldownCheck.ready) {
                const timeLeft = economy.formatTime(cooldownCheck.timeLeft);
                return await sendMessage(`🏦 Bank lagi dijaga ketat! Tunggu ${timeLeft} lagi.`);
            }

            const itemIdx = user.inventory.findIndex(i => i.name.toLowerCase().includes('lockpick'));
            user.inventory.splice(itemIdx, 1);
            user.lastBankRob = Date.now();

            if (Math.random() < 0.5) {
                const stolen = Math.floor(Math.random() * 5000) + 2000;
                user.balance += stolen;
                economy.addXp(user, 500);

                economy.saveEconomyDB(db);
                await sendMessage(`🤑 JACKPOT! ${sender.name} berhasil bobol brankas bank! Dapat ${stolen} coin + 500 XP!`);
            } else {
                user.health = 1;
                const fine = Math.floor(user.balance * 0.1);
                user.balance -= fine;

                economy.saveEconomyDB(db);
                await sendMessage(`🚑 WEEE OOO WEEE OOO! Alarm bunyi! ${sender.name} digebukin satpam sampai sekarat (HP: 1) dan didenda ${fine} coin!`);
            }
        }
    }
};
