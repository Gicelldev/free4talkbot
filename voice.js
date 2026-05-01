/**
 * voice.js — handler untuk voice conversation:
 *   1. Terima audio chunk dari browser (peer utterance)
 *   2. Transcribe via Groq Whisper (stt.js)
 *   3. Cek wake word "gicell" (typo-tolerant) di transcript
 *   4. Cek strict trigger (kata kerja eksplisit setelah wake word)
 *   5. Forward ke askAI → speakTTS
 *
 * Anti-feedback: skip kalau _ttsBusy, kalau utterance terlalu pendek,
 * dan ada cooldown setelah bot reply (cegah trigger berulang).
 */
const { transcribeAudio, hasValidKeys, keyCount } = require('./stt.js');
const { askAI, parseCommandFromAI } = require('./ai.js');

// ── Config ───────────────────────────────────────────────────────────────
const VOICE_REPLY_COOLDOWN = 3000;   // 3s setelah bot reply, baru proses utterance baru
const MIN_TRANSCRIPT_LEN   = 3;      // skip transcript yang terlalu pendek
const MAX_TRANSCRIPT_LEN   = 500;    // skip kalau kepanjangan (anomaly)

// ── Module state ────────────────────────────────────────────────────────────
let _voiceBusy    = false;
let _lastReplyAt  = 0;         // timestamp reply terakhir (global, untuk wake word mode)
const _trackLastAt = new Map(); // trackId → timestamp (untuk talk mode per-track cooldown)

// Talk mode: semua utterance langsung direspon (tanpa perlu wake word)
// Aktif via !voice talk / !talkmode. State disimpan di botState.voiceTalkMode.
const TALK_MODE_MIN_LEN = 8;   // min transcript length di talk mode (biar ga respon "hmm", "ok")
const TALK_MODE_COOLDOWN = 8000; // cooldown per-track di talk mode (8s) biar ga spam

// ── Strict trigger keywords — kata kerja yang relevan setelah wake word ──
// Kalau wake word ada tapi tidak diikuti salah satu trigger ini → drop.
// Mirip COMMAND_INTENT_GUARDS di ai.js.
const STRICT_TRIGGERS = [
    // Sapaan / pertanyaan umum
    'apa', 'gimana', 'kabar', 'bisa', 'boleh', 'lagi', 'kamu', 'kau',
    // Permintaan
    'tolong', 'minta', 'coba', 'bantu', 'mau', 'pengen', 'ingin', 'pengin',
    // Aksi
    'putar', 'puter', 'mainkan', 'play', 'stop', 'skip', 'cek',
    'beli', 'jual', 'main', 'cari', 'liat', 'lihat',
    // Sapaan
    'halo', 'hai', 'hi', 'oi', 'woi', 'hei', 'hey',
    // Voice
    'ngomong', 'ucapin', 'bilang', 'sebut', 'sebutin', 'sapa',
    // Conversational
    'kenapa', 'kok', 'emang', 'memang', 'siapa', 'dimana', 'kapan',
];

/**
 * Normalize transcript untuk STT typo tolerance sebelum wake word match.
 * Handle kasus Whisper yang sering mangle nama Indonesian:
 *   "ghi-cheo" → hapus hyphen → gh→g → ch→c → eo→el → "gicel"
 *   "Gijal"    → al-ending→el         → "gijel"
 *   "Ghi, cel" → comma→space, merge short tokens ["gi","cel"] → "gicel"
 *
 * @returns {{ normal: string, compact: string }} dua versi: normal (per-kata) dan
 *   compact (short tokens ≤3 char digabung dengan kata berikutnya)
 */
function normalizeForWakeWord(text) {
    const words = text
        .toLowerCase()
        .replace(/[-,;]+/g, ' ')       // hapus hyphen & comma: "ghi,cel" → "ghi cel"
        .split(/\s+/)
        .map(w => w
            .replace(/[^a-z]/g, '')    // strip non-alpha per kata
            .replace(/^gh/, 'g')       // gh di awal: "ghicheo" → "gicheo"
            .replace(/ch/g, 'c')       // ch → c: "gicheo" → "giceo"
            .replace(/tel$/, 'cel')    // tel di akhir → cel: "gitel" → "gicel" (t↔c confusion)
            .replace(/til$/, 'cel')    // til di akhir → cel: variasi lain
            .replace(/(eo|ao|al)$/, 'el') // eo/ao/al di akhir → el: giceo→gicel, gijal→gijel
        )
        .filter(Boolean);

    const normal = words.join(' ');

    // Compact: merge consecutive short tokens (≤3 char) → tangani "ghi cel" → "gicel"
    // (Whisper kadang split satu kata jadi dua dengan jeda/koma)
    const mergedWords = [];
    for (let i = 0; i < words.length; i++) {
        const last = mergedWords[mergedWords.length - 1];
        if (last !== undefined && last.length <= 3) {
            mergedWords[mergedWords.length - 1] = last + words[i];
        } else {
            mergedWords.push(words[i]);
        }
    }
    const compact = mergedWords.join(' ');

    return { normal, compact };
}

/**
 * Build typo-tolerant wake word set dari botName.
 *
 * Untuk "GicellBot" → [
 *   'gicellbot', 'gicell', 'gicel',          // base
 *   'gecellbot', 'gecell', 'gecel',           // gi→ge (Whisper Indo shift)
 *   'gijellbot', 'gijell', 'gijel',           // c→j phonetic
 * ]
 *
 * Variasi:
 *   - botRoot (strip "bot" suffix): "gicell"
 *   - botRootDedup (dedupe huruf double): "gicel"
 *   - Phonetic c→j: gicell → gijell
 *   - Vowel gi→ge: gicell → gecell, gicel → gecel  (Whisper sering dengar "gi" jadi "ge")
 */
function buildWakeWordSet(botName) {
    const botLower      = (botName || '').toLowerCase();
    const botRoot       = botLower.replace(/bot$/i, '');
    const botRootDedup  = botRoot.replace(/(.)\1+/g, '$1');

    const baseSet  = [botLower, botRoot, botRootDedup].filter(Boolean);
    const finalSet = new Set(baseSet);

    // Phonetic variations buat tolerate Whisper STT mistakes (Indo)
    for (const w of [...baseSet]) {
        if (w.includes('c'))    finalSet.add(w.replace(/c/g, 'j'));    // gicell → gijell
        if (w.includes('ce'))   finalSet.add(w.replace(/ce/g, 'je')); // gicel → gijel
        // Initial consonant variants: gi → ge/ci/ji/ki
        if (w.startsWith('gi')) finalSet.add('ge' + w.slice(2));  // gicell → gecell
        if (w.startsWith('gi')) finalSet.add('ci' + w.slice(2));  // gicell → cicell
        if (w.startsWith('gi')) finalSet.add('ji' + w.slice(2));  // gicell → jicell
        if (w.startsWith('gi')) finalSet.add('ki' + w.slice(2));  // gicell → kicell (K→G confusion)
    }

    // Post-process: tambah ending variants untuk semua yang sudah di-generate
    for (const w of [...finalSet]) {
        // el → il: "gicel" → "gicil" (vowel height shift, Whisper Indo mix i/e)
        if (w.endsWith('el'))  finalSet.add(w.slice(0, -2) + 'il');
        // cel → tel: "gicel" → "gitel" (affricate confusion c↔t↔ch di beberapa aksen)
        if (w.endsWith('cel')) finalSet.add(w.slice(0, -3) + 'tel');
    }

    return [...finalSet].filter(t => t && t.length >= 3);
}

// Sapaan yang OK muncul SEBELUM wake word — masih dianggap fresh context.
// "hei gicell apa kabar" → match. "oh gicel skip dong" → match.
// "tadi gua ketemu gicell" → skip (bukan sapaan).
const SAPAAN_LEAD = [
    'hei', 'hai', 'halo', 'oi', 'woi', 'hey', 'eh', 'yo', 'oy', 'haii', 'hi',
    'oh', 'wah', 'nah', 'ya', 'iya',   // tambahan: kalimat pendek sebelum manggil
];

/**
 * Cek apakah transcript jelas mengarah ke bot.
 * Aturan:
 *   1. Wake word HARUS di awal kalimat ATAU setelah sapaan ("hei gicell ...")
 *   2. Setelah wake word, harus ada kata kerja eksplisit (STRICT_TRIGGERS)
 *      ATAU utterance terdiri dari wake word saja ("gicell?", "gicell.")
 *   3. Wake word di tengah kalimat panjang ("tadi gua ketemu gicell")
 *      otomatis di-skip.
 *
 * Dicek tiga cara:
 *   1. Transcript asli
 *   2. Normalized (gh→g, ch→c, al→el, tel→cel, token compact)
 *   3. Fuzzy Levenshtein (edit distance ≤ 1) buat catch sisa varian yang lolos
 */

/** Levenshtein edit distance antara dua string pendek. O(m*n). */
function levenshtein(a, b) {
    // Quick reject: beda panjang lebih dari 2 → pasti > 1
    if (Math.abs(a.length - b.length) > 2) return 99;
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp[i] = [i]; }
    for (let j = 0; j <= n; j++) { dp[0][j] = j; }
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    return dp[m][n];
}

/**
 * Coba temukan word dalam tokens yang fuzzy-match (lev ≤ 1) ke salah satu wake word.
 * Hanya dipakai sebagai fallback kalau exact/normalized match gagal.
 * Minimum word length 4 untuk hindari false positive (kata 3 huruf terlalu pendek).
 */
function findFuzzyMatch(tokens, wakeWords) {
    // Hanya check wake words yang cukup panjang (≥ 5 char) biar tidak false positive
    const longWakes = wakeWords.filter(w => w.length >= 5);
    for (let i = 0; i < tokens.length; i++) {
        const word = tokens[i].replace(/[^a-z]/g, '');
        if (word.length < 4) continue;
        for (const wake of longWakes) {
            if (levenshtein(word, wake) <= 1) {
                return { tokenIdx: i, word, wake };
            }
        }
    }
    return null;
}
function detectWakeWord(transcript, wakeWords) {
    const lower = String(transcript || '').toLowerCase().trim();
    if (!lower) return { matched: false, wake: null, after: '' };

    // Tiga kandidat untuk matching:
    //   1. lower   — transcript asli
    //   2. normal  — per-kata normalized (gh→g, ch→c, eo/al→el)
    //   3. compact — short tokens (≤3) digabung → handle "ghi, cel" → "gicel"
    const { normal, compact } = normalizeForWakeWord(lower);
    const seen = new Set([lower]);
    const candidates = [lower];
    if (!seen.has(normal))   { seen.add(normal);   candidates.push(normal); }
    if (!seen.has(compact))  { seen.add(compact);  candidates.push(compact); }

    for (const target of candidates) {
        for (const wake of wakeWords) {
            const idx = target.indexOf(wake);
            if (idx === -1) continue;

            const before = target.slice(0, idx).trim();
            const after  = target.slice(idx + wake.length).trim();

            // Cek context sebelum wake word
            const beforeLastWord = (before.split(/\s+/).pop() || '').replace(/[^a-z]/g, '');
            const isFreshContext = before === '' || SAPAAN_LEAD.includes(beforeLastWord);

            if (!isFreshContext) continue;

            // Cek standalone: cuma wake word ± punctuation
            const afterClean = after.replace(/[.,!?\s]/g, '');
            if (afterClean.length === 0) {
                return { matched: true, wake, after, normalized: target !== lower };
            }

            // Cek strict trigger di max 8 kata pertama setelah wake word
            const firstWords = after.split(/\s+/).slice(0, 8).join(' ').replace(/[.,!?]/g, '');
            if (STRICT_TRIGGERS.some(t => firstWords.includes(t))) {
                return { matched: true, wake, after, normalized: target !== lower };
            }
        }
    }

    // ── Fuzzy fallback: Levenshtein ≤ 1 (catch varian yang lolos exact/normalized) ──
    // Hanya apply ke transcript asli (lower) dan normalized, bukan compact
    // Tetap enforce context rules (SAPAAN_LEAD + STRICT_TRIGGER / standalone)
    const fuzzyTargets = [...new Set([lower, normal])];
    for (const fTarget of fuzzyTargets) {
        const tokens = fTarget.split(/\s+/);
        const fuzzy = findFuzzyMatch(tokens, wakeWords);
        if (!fuzzy) continue;

        const { tokenIdx, word, wake } = fuzzy;
        const beforeTokens = tokens.slice(0, tokenIdx);
        const afterTokens  = tokens.slice(tokenIdx + 1);
        const before = beforeTokens.join(' ').trim();
        const after  = afterTokens.join(' ').replace(/[.,!?]+$/, '').trim();

        const beforeLastWord = (beforeTokens[beforeTokens.length - 1] || '').replace(/[^a-z]/g, '');
        const isFreshContext = before === '' || SAPAAN_LEAD.includes(beforeLastWord);
        if (!isFreshContext) continue;

        const afterClean = after.replace(/[.,!?\s]/g, '');
        if (afterClean.length === 0) {
            return { matched: true, wake: word, after, normalized: true, fuzzy: true };
        }
        const firstWords = afterTokens.slice(0, 8).join(' ').replace(/[.,!?]/g, '');
        if (STRICT_TRIGGERS.some(t => firstWords.includes(t))) {
            return { matched: true, wake: word, after, normalized: true, fuzzy: true };
        }
    }

    return { matched: false, wake: null, after: '' };
}

/**
 * Strip emoji dari text sebelum di-TTS.
 * msedge-tts kadang baca simbol emoji sebagai kata/bunyi aneh.
 */
function stripEmojisForTTS(text) {
    return text
        // Emoji ranges umum
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')   // supplementary plane (emoji utama)
        .replace(/[\u{2600}-\u{27BF}]/gu, '')      // misc symbols & dingbats
        .replace(/[\u{2B00}-\u{2BFF}]/gu, '')      // misc symbols & arrows
        .replace(/\s{2,}/g, ' ')                   // collapse extra spaces
        .trim();
}

/**
 * Process incoming utterance dari browser.
 * @param {object} payload - { trackId, durationMs, mime, audioB64 }
 * @param {object} ctx - { botName, log, sendMessage, speakTTS, isTTSBusy, botState, executeCommand?, senderName? }
 */
async function handlePeerUtterance(payload, ctx) {
    const { trackId, durationMs, mime, audioB64 } = payload || {};
    const { botName, log, sendMessage, speakTTS, isTTSBusy, botState, executeCommand, senderName } = ctx;
    // senderName: nama participant kalau diketahui (dari track-participant mapping)
    const voiceSender = senderName || 'VoiceUser';

    if (!hasValidKeys()) {
        log?.('[VOICE] Skip: belum ada Groq API key (edit stt.js).', 'warn');
        return;
    }

    // Voice listen ga aktif → drop
    if (botState?.voiceListenActive === false) return;

    // Cooldown setelah bot reply terakhir (hanya untuk wake word mode)
    if (!botState?.voiceTalkMode) {
        const sinceReply = Date.now() - _lastReplyAt;
        if (sinceReply < VOICE_REPLY_COOLDOWN) return;
    }

    // Single-flight
    if (_voiceBusy) return;

    // Skip kalau bot sedang ngomong (anti-feedback)
    if (typeof isTTSBusy === 'function' && isTTSBusy()) return;

    if (!audioB64 || audioB64.length < 100) return;

    _voiceBusy = true;
    try {
        const audioBuf = Buffer.from(audioB64, 'base64');
        log?.(`[VOICE] Utterance dari ${trackId.slice(-6)} (${durationMs}ms, ${(audioBuf.length / 1024).toFixed(1)}KB) → STT...`, 'info');

        // Transcribe via Groq
        let transcript = '';
        try {
            transcript = await transcribeAudio(audioBuf, { lang: 'id', mime });
        } catch (e) {
            log?.(`[VOICE] STT error: ${e.message}`, 'warn');
            return;
        }

        if (!transcript || transcript.length < MIN_TRANSCRIPT_LEN) return;
        if (transcript.length > MAX_TRANSCRIPT_LEN) {
            log?.(`[VOICE] Transcript terlalu panjang (${transcript.length}), skip.`, 'warn');
            return;
        }

        log?.(`[VOICE] Transcript: "${transcript}"`, 'info');

        // ── Wake word detection vs Talk Mode ────────────────────────────────
        const talkMode = botState?.voiceTalkMode === true;
        let contextLabel = '';

        if (talkMode) {
            // TALK MODE: respon semua utterance tanpa perlu wake word
            if (transcript.length < TALK_MODE_MIN_LEN) {
                // Skip single word / too short
                return;
            }
            // Per-track cooldown: jangan spam jawab ke orang yang sama ≤ 8s
            const lastTrackReply = _trackLastAt.get(trackId) || 0;
            if (Date.now() - lastTrackReply < TALK_MODE_COOLDOWN) {
                return;
            }
            contextLabel = '[TALK MODE] 🎙️';
            log?.(`[VOICE] ${contextLabel} Processing semua utterance...`, 'info');
        } else {
            // WAKE WORD MODE: cek nama bot sebelum respon
            const wakeWords = buildWakeWordSet(botName);
            const detect    = detectWakeWord(transcript, wakeWords);
            if (!detect.matched) {
                log?.(`[VOICE] No wake word match — skip.`, 'info');
                return;
            }
            const matchHow = detect.fuzzy ? ' (fuzzy~1)' : detect.normalized ? ' (via normalized)' : '';
            contextLabel = `Wake word "${detect.wake}"${matchHow}`;
            log?.(`[VOICE] ✅ ${contextLabel} detected. Processing...`, 'success');
        }

        // ── AI generate reply ──────────────────────────────────────────────
        let reply = '';
        try {
            // Pakai nama user yang ngomong kalau diketahui — biar AI lebih personal
            const aiResp = await askAI(transcript, voiceSender, botState || {});
            reply = String(aiResp || '').trim();
        } catch (e) {
            log?.(`[VOICE] AI error: ${e.message}`, 'warn');
            return;
        }

        if (!reply) return;

        // Parse command dari AI reply (voice mode sekarang execute command!)
        // parseCommandFromAI → { cleanReply, command } dari ai.js
        let cleanReply = reply;
        let aiCommand  = null;
        try {
            const parsed = parseCommandFromAI(reply, transcript);
            cleanReply = parsed.cleanReply || '';
            aiCommand  = parsed.command  || null;
        } catch (_) {
            // Fallback: strip manual kalau parseCommandFromAI error
            cleanReply = reply.replace(/\[CMD:[^\]]*\]/g, '').trim();
        }

        if (!cleanReply && !aiCommand) return;

        if (cleanReply) {
            log?.(`[VOICE] AI reply: "${cleanReply.slice(0, 80)}${cleanReply.length > 80 ? '...' : ''}"`, 'info');
        }
        if (aiCommand) {
            log?.(`[VOICE→CMD] ${aiCommand}`, 'cmd');
        }

        // ── Speak via TTS ──────────────────────────────────────────────────
        if (cleanReply) {
            if (typeof speakTTS !== 'function') {
                await sendMessage?.(cleanReply);
            } else {
                // Strip emoji + truncate kalau kepanjangan (TTS limit ~200 char)
                const rawTts = cleanReply.length > 200 ? cleanReply.slice(0, 197) + '...' : cleanReply;
                const ttsText = stripEmojisForTTS(rawTts);
                try {
                    await speakTTS(ttsText, { voice: 'ardi' });
                    _lastReplyAt = Date.now();
                    _trackLastAt.set(trackId, _lastReplyAt);  // update per-track cooldown
                } catch (e) {
                    log?.(`[VOICE] TTS error: ${e.message}`, 'warn');
                    await sendMessage?.(`🗣️ (TTS error) ${cleanReply}`);
                }
            }
        } else {
            // Kalau tidak ada teks tapi ada command — set cooldown juga
            _lastReplyAt = Date.now();
            _trackLastAt.set(trackId, _lastReplyAt);
        }

        // ── Execute command (setelah TTS selesai, biar tidak clash dgn unmuteMic) ─
        if (aiCommand && typeof executeCommand === 'function') {
            try {
                await executeCommand(aiCommand, voiceSender);
            } catch (e) {
                log?.(`[VOICE→CMD] Error: ${e.message}`, 'error');
            }
        }
    } finally {
        _voiceBusy = false;
    }
}

/**
 * Status helper untuk debug/info
 */
function getVoiceStatus() {
    return {
        sttKeys: keyCount(),
        sttReady: hasValidKeys(),
        busy: _voiceBusy,
        cooldownRemaining: Math.max(0, VOICE_REPLY_COOLDOWN - (Date.now() - _lastReplyAt)),
    };
}

module.exports = {
    handlePeerUtterance,
    getVoiceStatus,
    buildWakeWordSet,
    detectWakeWord,
};
