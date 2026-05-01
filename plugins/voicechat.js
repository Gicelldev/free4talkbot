/**
 * voicechat.js — toggle voice conversation mode (wake word listen via Groq STT)
 *
 * Commands:
 *   !voice on  / !listen on   → aktifin wake word mode (default)
 *   !voice off / !listen off  → matiin semua voice
 *   !voice talk               → toggle Talk Mode (respon SEMUA utterance tanpa wake word)
 *   !talkmode [on|off]        → sama seperti !voice talk
 *   !voice                    → status
 *
 * Owner / Mod only.
 */

const { getVoiceStatus } = require('../voice.js');

function isOwnerOrMod(sender) {
    if (!sender?.role) return false;
    const r = String(sender.role).toLowerCase().trim();
    // Pakai includes() biar catch 'Owner', 'co-owner', 'Moderator', 'Admin', dll
    return r.includes('owner') || r.includes('mod') || r.includes('admin') || r.includes('creator');
}

module.exports = {
    commands: ['voice', 'listen', 'talkmode'],

    handle: async (cmd, args, msg, { sender, botState, sendMessage, page, log }) => {
        const arg = String(args || '').trim().toLowerCase();

        // ── !talkmode on/off/toggle ────────────────────────────────────────
        if (cmd === 'talkmode' || arg === 'talk') {
            log?.('[VOICE] talkmode cmd - sender: ' + sender?.name + ', role: ' + JSON.stringify(sender?.role), 'info');
            if (!isOwnerOrMod(sender)) {
                return await sendMessage(`❌ ${sender.name}, cuma Owner/Mod yang bisa pakai talk mode.`);
            }

            // Determine target state
            let enable;
            if (arg === 'on'  || (cmd === 'talkmode' && arg === 'on'))  enable = true;
            else if (arg === 'off' || (cmd === 'talkmode' && arg === 'off')) enable = false;
            else enable = !botState.voiceTalkMode;   // toggle kalau ga ada arg

            botState.voiceTalkMode     = enable;
            botState.voiceListenActive = true;  // pastikan listening aktif

            log?.(`[VOICE] Talk mode ${enable ? 'ON' : 'OFF'} (by ${sender.name})`, enable ? 'success' : 'warn');

            if (enable) {
                return await sendMessage(
                    `🎙️ *Talk Mode AKTIF*\n` +
                    `Bot sekarang respon SEMUA yang diucapkan — tanpa perlu manggil nama.\n` +
                    `Cooldown 8s per user untuk hindari spam.\n\n` +
                    `Matiin: !talkmode off atau !voice talk`
                );
            } else {
                return await sendMessage(
                    `🔇 *Talk Mode MATI* — balik ke wake word mode.\n` +
                    `Sebut "${botState.botName}" dulu untuk ngobrol via voice.`
                );
            }
        }

        // Cek role kalau mau ubah state (status query bebas)
        if (arg === 'on' || arg === 'off') {
            if (!isOwnerOrMod(sender)) {
                return await sendMessage(`❌ ${sender.name}, cuma Owner/Mod yang bisa ubah voice listen mode.`);
            }
        }

        // ── Status ─────────────────────────────────────────────────────────
        if (!arg) {
            const status   = getVoiceStatus();
            const state    = botState?.voiceListenActive ? '🟢 ON' : '🔴 OFF';
            const talkMode = botState?.voiceTalkMode ? '🎙️ TALK MODE (respon semua)' : '🔔 Wake word mode';
            const keys     = status.sttReady ? `✅ ${status.sttKeys} key` : '❌ no key (set di stt.js)';
            return await sendMessage(
                `🎙️ *Voice Status*\n` +
                `Listen: ${state}\n` +
                `Mode  : ${talkMode}\n` +
                `STT   : ${keys}\n` +
                `Busy  : ${status.busy ? 'ya' : 'tidak'}\n\n` +
                `Pakai: !voice on/off/talk | !talkmode on/off`
            );
        }

        // ── Toggle ON ──────────────────────────────────────────────────────
        if (arg === 'on') {
            botState.voiceListenActive = true;
            if (page) await page.evaluate(() => { window._voiceListenActive = true; }).catch(() => {});
            log?.(`[VOICE] Listen mode ON (by ${sender.name})`, 'success');
            const mode = botState.voiceTalkMode ? '🎙️ Talk mode aktif' : `Sebut "${botState.botName}" + perintah`;
            return await sendMessage(
                `🟢 *Voice listen mode AKTIF*\n` +
                `${mode}`
            );
        }

        // ── Toggle OFF ─────────────────────────────────────────────────────
        if (arg === 'off') {
            botState.voiceListenActive = false;
            botState.voiceTalkMode     = false;  // matiin talk mode juga
            if (page) await page.evaluate(() => { window._voiceListenActive = false; }).catch(() => {});
            log?.(`[VOICE] Listen mode OFF (by ${sender.name})`, 'warn');
            return await sendMessage(`🔴 *Voice listen mode MATI* — bot ga dengerin lagi.`);
        }

        await sendMessage(`❓ Pakai: !voice on / off / talk | !talkmode on/off`);
    }
};
