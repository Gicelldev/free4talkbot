const fs = require('fs');
const path = require('path');

module.exports = {
    commands: ['help', 'menu', 'start'],

    handle: async (cmd, args, msg, { sender, sendMessage, db }) => {

        const pluginDir = path.join(__dirname, '../plugins');
        let pluginCategories = {};

        if (fs.existsSync(pluginDir)) {
            fs.readdirSync(pluginDir).forEach(file => {
                if (file.endsWith('.js')) {
                    const plugin = require(path.join(pluginDir, file));
                    const category = file.replace('.js', '').toUpperCase();

                    if (plugin.commands) {
                        pluginCategories[category] = plugin.commands.map(c => `!${c}`);
                    }
                }
            });
        }

        let helpMsg = `🤖 **BOT MENU** 🤖\n\n`;

        helpMsg += `🎵 **MUSIC**\n`;
        helpMsg += `!play, !skip, !stop, !queue, !lyrics, !vol\n\n`;

        Object.keys(pluginCategories).forEach(cat => {
            if (cat === 'HELP') return;

            let emoji = '📦';
            if (cat === 'ECONOMY') emoji = '💰';
            if (cat === 'RPG') emoji = '⚔️';
            if (cat === 'SHOP') emoji = '🛒';
            if (cat === 'ACTIVITIES') emoji = '🎣';
            if (cat === 'CRIME') emoji = '🕵️';
            if (cat === 'GACHA') emoji = '🎁';

            helpMsg += `${emoji} **${cat}**\n`;
            helpMsg += `${pluginCategories[cat].join(', ')}\n\n`;
        });

        helpMsg += `💡 *Ketik command untuk mencoba!*`;

        await sendMessage(helpMsg.trim());
    }
};
