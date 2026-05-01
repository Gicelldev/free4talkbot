/**
 * stt.js — Speech-to-Text via Groq Whisper API.
 * Free tier: 2000 req/day per key. Multi-key rotation untuk extend quota.
 *
 * Pattern mirror dari ai.js (NIM_API_KEYS):
 *   - Round-robin cursor (mulai random)
 *   - Auto-failover saat 429/error → coba key berikutnya
 *
 * Endpoint Groq mirror OpenAI Whisper format (tinggal ganti base URL).
 */
const FormData = globalThis.FormData;  // Node.js 18+ built-in
const Blob     = globalThis.Blob;

// ============================================================
//  KONFIGURASI — Baca API keys dari .env
//  Salin .env.example → .env lalu isi dengan key asli kamu.
//  Daftar gratis: https://console.groq.com
// ============================================================
require('dotenv').config();

// Di .env: GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3  (pisah koma)
const GROQ_API_KEYS = (process.env.GROQ_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k && !k.includes('REPLACE_ME'));

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL    = 'whisper-large-v3';  // full model — lebih akurat untuk nama & mixed language
                                             // vs turbo: akurasi+, latency +0.3s, quota sama 2000/hari

// Round-robin cursor — mulai random supaya multi-instance ga collide
let _keyCursor = Math.floor(Math.random() * Math.max(1, GROQ_API_KEYS.length));
function nextGroqKey() {
    if (GROQ_API_KEYS.length === 0) return null;
    const k = GROQ_API_KEYS[_keyCursor % GROQ_API_KEYS.length];
    _keyCursor = (_keyCursor + 1) % GROQ_API_KEYS.length;
    return k;
}

/**
 * Transcribe audio buffer ke text via Groq Whisper.
 * @param {Buffer} audioBuffer - audio data (webm/opus, mp3, wav, m4a, etc.)
 * @param {object} opts - { lang?: 'id'|'en'|null, mime?: string }
 * @returns {Promise<string>} transcript text (atau '' kalau gagal/empty)
 */
async function transcribeAudio(audioBuffer, opts = {}) {
    if (!audioBuffer || audioBuffer.length === 0) return '';
    if (GROQ_API_KEYS.length === 0) {
        throw new Error('STT: GROQ_API_KEYS kosong. Edit stt.js dan kasih API key.');
    }

    const lang = opts.lang || 'id';
    const mime = opts.mime || 'audio/webm';
    const ext  = mime.split('/')[1]?.split(';')[0] || 'webm';

    let lastErr = null;

    for (let attempt = 0; attempt < GROQ_API_KEYS.length; attempt++) {
        const apiKey = nextGroqKey();
        const keyTag = `gsk-key#${(_keyCursor + GROQ_API_KEYS.length - 1) % GROQ_API_KEYS.length + 1}`;

        try {
            const form = new FormData();
            form.append('file', new Blob([audioBuffer], { type: mime }), `audio.${ext}`);
            form.append('model', GROQ_MODEL);
            form.append('language', lang);
            form.append('response_format', 'json');
            form.append('temperature', '0');

            const resp = await fetch(GROQ_BASE_URL, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: form,
            });

            if (resp.status === 429) {
                // Rate limit — coba key berikutnya
                lastErr = new Error(`Rate limit (${keyTag})`);
                console.warn(`[STT] ${keyTag} rate-limited, trying next key...`);
                continue;
            }
            if (resp.status === 401 || resp.status === 403) {
                lastErr = new Error(`Invalid API key (${keyTag})`);
                console.warn(`[STT] ${keyTag} unauthorized — check API key.`);
                continue;
            }
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '<no body>');
                throw new Error(`Groq STT ${resp.status}: ${txt.slice(0, 200)}`);
            }

            const data = await resp.json();
            const text = String(data?.text || '').trim();
            return text;
        } catch (e) {
            lastErr = e;
            console.warn(`[STT] ${keyTag} error: ${e.message}`);
        }
    }

    throw lastErr || new Error('All Groq keys failed');
}

function hasValidKeys() {
    return GROQ_API_KEYS.length > 0;
}

function keyCount() {
    return GROQ_API_KEYS.length;
}

module.exports = {
    transcribeAudio,
    hasValidKeys,
    keyCount,
};
