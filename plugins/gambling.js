const economy = require('../economy.js');

module.exports = {
    commands: ['gamble', 'judi', 'slot', 'slots', 'flip', 'coinflip'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        const getChipCount = () => {
            if (!user.inventory) return 0;
            return user.inventory.filter(i => i.name.includes('Chip')).length;
        };

        const removeChips = (amount) => {
            for (let k = 0; k < amount; k++) {
                const idx = user.inventory.findIndex(i => i.name.includes('Chip'));
                if (idx > -1) user.inventory.splice(idx, 1);
            }
        };

        const addChips = (amount) => {
            for (let i = 0; i < amount; i++) {
                user.inventory.push({ name: 'Chip', type: 'currency', effect: {}, boughtAt: Date.now() });
            }
        };

        if (cmd === 'slot' || cmd === 'slots') {
            const bet = parseInt(args);
            if (isNaN(bet) || bet < 1) return await sendMessage('🎰 Format: !slot <jumlah chip>');

            const currentChips = getChipCount();
            if (currentChips < bet) return await sendMessage(`❌ Chip kurang! Kamu punya ${currentChips}, mau bet ${bet}. Beli di !shop.`);

            const slots = ['🍒', '🍋', '🍇', '🍉', '🔔', '💎', '7️⃣'];
            const reel1 = slots[Math.floor(Math.random() * slots.length)];
            const reel2 = slots[Math.floor(Math.random() * slots.length)];
            const reel3 = slots[Math.floor(Math.random() * slots.length)];

            removeChips(bet);

            let winMultiplier = 0;

            if (reel1 === reel2 && reel2 === reel3) {
                if (reel1 === '7️⃣') winMultiplier = 50;
                else if (reel1 === '💎') winMultiplier = 20;
                else if (reel1 === '🔔') winMultiplier = 15;
                else winMultiplier = 10;
            } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
                winMultiplier = 2;
            }

            const winAmount = Math.floor(bet * winMultiplier);
            if (winAmount > 0) addChips(winAmount);

            economy.saveEconomyDB(db);

            let slotMsg = `🎰 **SLOTS** 🎰\n\n`;
            slotMsg += `[ ${reel1} | ${reel2} | ${reel3} ]\n\n`;

            if (winMultiplier > 0) {
                if (winMultiplier === 50) slotMsg += `🎉 **JACKPOT!!!** 🎉\n`;
                slotMsg += `✅ Menang! Dapet ${winAmount} Chip! (Total: ${getChipCount()})`;
            } else {
                slotMsg += `❌ Kalah! Chip hangus. (Sisa: ${getChipCount()})`;
            }

            await sendMessage(slotMsg);
        }

        else if (cmd === 'flip' || cmd === 'coinflip') {
            const parts = args.split(' ');
            if (parts.length < 2) return await sendMessage('🪙 Format: !flip <jumlah chip> <head/tail>');

            const bet = parseInt(parts[0]);
            const choice = parts[1].toLowerCase();

            if (isNaN(bet) || bet < 1) return await sendMessage('❌ Jumlah chip harus angka!');
            if (!['head', 'tail', 'kpl', 'ekr'].includes(choice)) return await sendMessage('❌ Pilih: head / tail');

            const currentChips = getChipCount();
            if (currentChips < bet) return await sendMessage(`❌ Chip kurang! Kamu punya ${currentChips}, mau bet ${bet}.`);

            removeChips(bet);

            const result = Math.random() < 0.5 ? 'head' : 'tail';
            const isWin = (choice === 'head' || choice === 'kpl') === (result === 'head');

            let flipMsg = `🪙 Koin dilempar... **${result.toUpperCase()}**!\n`;

            if (isWin) {
                const winAmount = bet * 2;
                addChips(winAmount);
                flipMsg += `✅ HOKI! Menang ${winAmount} Chip!`;
            } else {
                flipMsg += `❌ RUNGKAD! Chip hangus.`;
            }

            economy.saveEconomyDB(db);
            await sendMessage(flipMsg);
        }
    }
};
