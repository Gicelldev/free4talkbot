/**
 * say.js — !say <text>
 * Bot ngomong via TTS (Microsoft Edge Read Aloud) → broadcast ke voice room
 * lewat virtual mic pipeline.
 *
 * Bisa dipanggil:
 *   1. Langsung: !say halo apa kabar
 *   2. Via AI natural language: user bilang "gicell coba ngomong halo"
 *      → AI emit [CMD:!say halo] → command handler trigger plugin ini.
 *
 * Constraint:
 *   - Reject kalau lagi !play music (konflik audio output).
 *   - Reject kalau TTS lain masih ngomong.
 *   - Max 200 char, cooldown 15s per user.
 */

const MAX_LENGTH      = 200;
const COOLDOWN_MS     = 15000;
const _userCooldowns  = new Map(); // userId → lastUsedTs

// Voice aliases (boleh override pakai prefix --voice <nama>)
const VOICE_ALIASES = ['ardi', 'gadis', 'aria', 'guy'];

function parseArgs(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { text: '', voice: null };

    // Format: !say --voice gadis halo dunia
    const voiceMatch = trimmed.match(/^--voice\s+(\w+)\s+(.+)/i);
    if (voiceMatch) {
        const v = voiceMatch[1].toLowerCase();
        if (VOICE_ALIASES.includes(v)) {
            return { text: voiceMatch[2].trim(), voice: v };
        }
    }
    return { text: trimmed, voice: null };
}

module.exports = {
    commands: ['say', 'ngomong', 'speak'],

    handle: async (cmd, args, msg, { sender, botState, sendMessage, speakTTS, isTTSBusy, log }) => {
        if (typeof speakTTS !== 'function') {
            return await sendMessage('❌ TTS belum siap. Restart bot dulu.');
        }

        const { text, voice } = parseArgs(args);

        if (!text) {
            return await sendMessage(
                `🗣️ *!say <text>* — bot ngomong via voice\n` +
                `Contoh: !say halo semua\n` +
                `Pilih voice: !say --voice gadis halo (cewek) | --voice ardi (cowok)\n` +
                `Max ${MAX_LENGTH} karakter, cooldown ${COOLDOWN_MS / 1000}s.`
            );
        }

        if (text.length > MAX_LENGTH) {
            return await sendMessage(`❌ Kepanjangan! Max ${MAX_LENGTH} karakter (kamu kirim ${text.length}).`);
        }

        // Cooldown per user
        const userKey = sender.uid || sender.name || 'unknown';
        const lastUsed = _userCooldowns.get(userKey) || 0;
        const elapsed  = Date.now() - lastUsed;
        if (elapsed < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
            return await sendMessage(`⏳ ${sender.name}, tunggu ${remaining}s lagi sebelum !say lagi.`);
        }

        // Reject kalau lagi !play music (konflik audio pipeline)
        if (botState?.isPlaying || botState?.currentSong) {
            return await sendMessage(`❌ Lagi muter musik nih. Stop dulu pakai !stop, baru !say.`);
        }

        // Reject kalau TTS lain masih ngomong
        if (typeof isTTSBusy === 'function' && isTTSBusy()) {
            return await sendMessage(`❌ Bot lagi ngomong, tunggu kelar dulu.`);
        }

        // Set cooldown sebelum panggil supaya retry rapid ga lolos
        _userCooldowns.set(userKey, Date.now());

        try {
            await sendMessage(`🗣️ *${sender.name}* nyuruh aku ngomong: "${text}"`);
            await speakTTS(text, { voice: voice || 'ardi' });
            // Selesai — ga perlu kirim message lagi, biar ga spam.
        } catch (e) {
            log?.(`[!say] error: ${e.message}`, 'error');
            await sendMessage(`❌ Gagal ngomong: ${e.message}`);
        }
    }
};
