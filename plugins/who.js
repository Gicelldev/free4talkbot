/**
 * who.js — !who | !list | !room | !siapa
 * Tampilkan semua orang yang ada di room saat ini
 */
module.exports = {
    commands: ['who', 'list', 'room', 'siapa'],

    async handle(cmd, args, fullMsg, ctx) {
        const { botState, sendMessage } = ctx;
        const participants = botState.participants || [];

        if (participants.length === 0) {
            return sendMessage('📋 Data participant belum ter-load. Coba beberapa detik lagi.');
        }

        // Sort: Owner dulu, lalu Mod, lalu Member
        const roleOrder = { 'Owner': 0, 'Co-owner': 1, 'Moderator': 2, 'Admin': 3, 'Member': 4 };
        const sorted = [...participants].sort((a, b) =>
            (roleOrder[a.role] ?? 5) - (roleOrder[b.role] ?? 5)
        );

        const roleIcon = {
            'Owner': '👑',
            'Co-owner': '🥈',
            'Moderator': '🛡️',
            'Admin': '⚙️',
            'Member': '👤'
        };

        const lines = sorted.map(p => {
            const icon = roleIcon[p.role] || '👤';
            return `${icon} ${p.name} [${p.role || 'Member'}]`;
        });

        return sendMessage(`📋 Pengguna di room (${participants.length}):\n${lines.join('\n')}`);
    }
};
