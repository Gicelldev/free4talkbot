/**
 * aimode.js — !ai off/on/sleep + !quiet
 * Mute manual untuk AI random nimbrung. Owner/Mod only.
 * State disimpan di botState.aiMuteUntil (timestamp ms; 0 = aktif).
 *
 * Note: command "!ai" / "!quiet" hanya mute AI Tier-2/3 (random + question
 * gating). Direct mention ("hai bot", "@gicell") tetap respon — supaya owner
 * bisa unmute walau bot lagi off.
 */

const PRIVILEGED_ROLES = new Set(['Owner', 'Co-owner', 'Moderator', 'Admin']);

/** Parse durasi seperti "5m", "30s", "1h", "2j" → ms. Return null kalau invalid. */
function parseDuration(input) {
    if (!input) return null;
    const m = String(input).trim().toLowerCase().match(/^(\d+)\s*(s|d|m|menit|min|h|j|jam|hour)?$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (isNaN(n) || n <= 0) return null;
    const unit = m[2] || 'm';
    if (['s', 'd'].includes(unit))                  return n * 1000;
    if (['m', 'menit', 'min'].includes(unit))       return n * 60 * 1000;
    if (['h', 'j', 'jam', 'hour'].includes(unit))   return n * 60 * 60 * 1000;
    return null;
}

function formatRemaining(ms) {
    if (ms <= 0) return '0 detik';
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `${s} detik`;
    const m = Math.ceil(s / 60);
    if (m < 60) return `${m} menit`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} jam ${mm} menit` : `${h} jam`;
}

module.exports = {
    commands: ['ai', 'quiet', 'unmute'],

    handle: async (cmd, args, msg, { sender, botState, sendMessage }) => {
        const role = sender?.role || 'Member';
        const isPriv = PRIVILEGED_ROLES.has(role);

        // ── !quiet → shortcut untuk mute 5 menit ─────────────────────────────
        if (cmd === 'quiet') {
            if (!isPriv) return await sendMessage(`❌ ${sender.name}, !quiet cuma buat Owner/Mod. Direct mention ("hai bot") masih jalan kok.`);
            botState.aiMuteUntil = Date.now() + 5 * 60 * 1000;
            return await sendMessage(`🤫 OK, AI random nimbrung di-mute 5 menit. Ketik !ai on buat unmute.`);
        }

        // ── !unmute → alias !ai on ───────────────────────────────────────────
        if (cmd === 'unmute') {
            if (!isPriv) return await sendMessage(`❌ ${sender.name}, cuma Owner/Mod yang bisa unmute.`);
            botState.aiMuteUntil = 0;
            return await sendMessage(`🔊 AI aktif lagi. Boleh nimbrung sekarang.`);
        }

        // ── !ai <subcommand> ─────────────────────────────────────────────────
        const sub = (args || '').trim().toLowerCase().split(/\s+/);
        const action = sub[0] || 'status';

        // Status — boleh siapa saja
        if (action === 'status' || action === '') {
            const now = Date.now();
            if (!botState.aiMuteUntil || botState.aiMuteUntil <= now) {
                return await sendMessage(`🟢 Status AI: AKTIF. Boleh nimbrung & jawab pertanyaan.`);
            }
            const remaining = botState.aiMuteUntil - now;
            return await sendMessage(`🔴 Status AI: MUTED (sisa ${formatRemaining(remaining)}). Ketik !ai on untuk aktifkan lagi.`);
        }

        // Action lain butuh privilege
        if (!isPriv) {
            return await sendMessage(`❌ ${sender.name}, cuma Owner/Mod yang bisa atur AI mode. Cek status: !ai status`);
        }

        if (action === 'off' || action === 'mute') {
            // !ai off → mute permanen sampai !ai on
            // Sebenarnya pakai timestamp jauh ke depan (1 tahun) supaya simple.
            botState.aiMuteUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
            return await sendMessage(`🔇 AI random nimbrung di-mute. Direct mention ("hai bot") masih respon.\nKetik !ai on untuk aktifkan lagi.`);
        }

        if (action === 'on') {
            botState.aiMuteUntil = 0;
            return await sendMessage(`🔊 AI aktif lagi. Boleh nimbrung sekarang.`);
        }

        if (action === 'sleep') {
            const durationStr = sub[1];
            if (!durationStr) {
                return await sendMessage(`❓ Format: !ai sleep <durasi>\nContoh: !ai sleep 5m, !ai sleep 30s, !ai sleep 1j`);
            }
            const ms = parseDuration(durationStr);
            if (!ms) {
                return await sendMessage(`❌ Durasi "${durationStr}" tidak valid. Format: 30s / 5m / 1h / 1j`);
            }
            // Cap maksimal 24 jam supaya ga lupa unmute
            const capped = Math.min(ms, 24 * 60 * 60 * 1000);
            botState.aiMuteUntil = Date.now() + capped;
            return await sendMessage(`😴 AI tidur ${formatRemaining(capped)}. Auto-aktif lagi setelah itu.`);
        }

        // Help
        return await sendMessage(
            `🤖 *AI Mode Commands*\n` +
            `• !ai status — cek status\n` +
            `• !ai off — mute random nimbrung (sampai !ai on)\n` +
            `• !ai on — aktifkan lagi\n` +
            `• !ai sleep <durasi> — mute sementara (cth: 5m, 30s, 1j)\n` +
            `• !quiet — shortcut mute 5 menit\n` +
            `• !unmute — alias !ai on\n\n` +
            `*Note:* Direct mention ("hai bot") tetap jalan walau di-mute.`
        );
    }
};
