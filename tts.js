/**
 * tts.js — Text-to-Speech helper via Microsoft Edge Read Aloud API.
 * Free, no API key, neural voices, support bahasa Indonesia.
 *
 * Output: Buffer (MP3) — siap di-base64-encode dan kirim ke browser
 * untuk diputar lewat Web Audio pipeline (window._micDest).
 */
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Voice pool buat Indonesia
const VOICES = {
    ardi:   'id-ID-ArdiNeural',     // cowok, default
    gadis:  'id-ID-GadisNeural',    // cewek
    // English fallback (kalau user mau)
    aria:   'en-US-AriaNeural',
    guy:    'en-US-GuyNeural',
};

const DEFAULT_VOICE = VOICES.ardi;
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

// Sanitasi: buang karakter berbahaya/SSML injection.
// msedge-tts wrap input ke SSML, jadi tag XML harus di-escape.
function sanitize(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/[\x00-\x1F\x7F]/g, ' ')   // control chars
        .trim();
}

/**
 * Generate audio MP3 dari text.
 * @param {string} text - kalimat yang mau diucapkan
 * @param {object} opts - { voice?: 'ardi'|'gadis'|'aria'|'guy', rate?: '0%'|'+10%'|..., pitch?: '+0Hz'|...}
 * @returns {Promise<Buffer>} MP3 buffer
 */
async function generateTTS(text, opts = {}) {
    const clean = sanitize(text);
    if (!clean) throw new Error('TTS: empty text after sanitization');

    const voiceKey = (opts.voice || 'ardi').toLowerCase();
    const voice    = VOICES[voiceKey] || DEFAULT_VOICE;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, FORMAT);

    return await new Promise((resolve, reject) => {
        const chunks = [];
        let result;
        try {
            result = tts.toStream(clean, opts.rate || opts.pitch
                ? { rate: opts.rate || '0%', pitch: opts.pitch || '+0Hz' }
                : undefined);
        } catch (e) {
            return reject(e);
        }

        const stream = result?.audioStream;
        if (!stream) return reject(new Error('TTS: no audioStream returned'));

        const timeout = setTimeout(() => {
            stream.removeAllListeners();
            reject(new Error('TTS: stream timeout (15s)'));
        }, 15000);

        stream.on('data', chunk => chunks.push(chunk));
        stream.on('close', () => {
            clearTimeout(timeout);
            if (!chunks.length) return reject(new Error('TTS: empty buffer'));
            resolve(Buffer.concat(chunks));
        });
        stream.on('error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

module.exports = {
    generateTTS,
    VOICES,
};
