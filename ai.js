const fs = require('fs');
const path = require('path');
const { tryFunApi } = require('./fun_api');

// ============================================================
//  KONFIGURASI — Baca API keys dari .env
//  Salin .env.example → .env lalu isi dengan key asli kamu.
//  Daftar gratis: https://build.nvidia.com
// ============================================================
require('dotenv').config();

// Di .env: NIM_API_KEYS=nvapi-key1,nvapi-key2,nvapi-key3  (pisah koma)
const NIM_API_KEYS = (process.env.NIM_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k && !k.includes('REPLACE_ME'));
const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL        = 'qwen/qwen3.5-122b-a10b';

// Round-robin cursor — dimulai dari posisi acak supaya beberapa instance bot
// (multi-user) tidak semuanya hit key #0 di awal.
let _keyCursor = Math.floor(Math.random() * NIM_API_KEYS.length);
function nextApiKey() {
    const k = NIM_API_KEYS[_keyCursor % NIM_API_KEYS.length];
    _keyCursor = (_keyCursor + 1) % NIM_API_KEYS.length;
    return k;
}

/**
 * Panggil NIM API dengan rotasi key + auto-failover.
 * Akan retry ke key berikutnya jika respons 401/403/429/5xx atau network error.
 * Mengembalikan string reply, atau throw setelah semua key gagal.
 */
async function callNIM(messages, { max_tokens = 512, temperature = 0.85 } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < NIM_API_KEYS.length; attempt++) {
        const apiKey = nextApiKey();
        const keyTag = `key#${(_keyCursor + NIM_API_KEYS.length - 1) % NIM_API_KEYS.length + 1}`;
        try {
            const response = await fetch(NIM_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({ model: MODEL, messages, max_tokens, temperature, stream: false })
            });

            if (response.ok) {
                const data  = await response.json();
                const reply = data.choices?.[0]?.message?.content?.trim();
                if (!reply) throw new Error('Empty response from NIM API');
                return reply;
            }

            // Retry pada rate-limit / auth / server error
            if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
                const errText = await response.text().catch(() => '');
                console.warn(`[AI] ${keyTag} failed (${response.status}) — rotating. ${errText.slice(0, 120)}`);
                lastErr = new Error(`NIM ${response.status}: ${errText.slice(0, 200)}`);
                continue;
            }

            // Status lain (mis. 400 bad request) — jangan retry, langsung throw
            const errText = await response.text().catch(() => '');
            throw new Error(`NIM API ${response.status}: ${errText}`);
        } catch (e) {
            lastErr = e;
            console.warn(`[AI] ${keyTag} network/parse error: ${e.message} — rotating.`);
        }
    }
    throw lastErr || new Error('All NIM API keys failed');
}

// Jumlah pesan per-user yang disimpan (sliding window)
// 20 = 10 pasangan user/assistant
const MAX_HISTORY = 20;

const MEMORY_PATH = path.join(__dirname, 'ai_memory.json');

// ============================================================
//  MEMORY HELPERS
// ============================================================
function loadMemory() {
    try {
        if (!fs.existsSync(MEMORY_PATH)) return {};
        return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
    } catch (e) {
        console.error('[AI] Failed to load memory:', e.message);
        return {};
    }
}

function saveMemory(memory) {
    try {
        fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf8');
    } catch (e) {
        console.error('[AI] Failed to save memory:', e.message);
    }
}

// ============================================================
//  SYSTEM PROMPT — AI mengenali dirinya + promosinya
// ============================================================
function buildSystemPrompt(botName) {
    // Waktu real-time server (WIB)
    const now    = new Date();
    const jamWIB = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    const tglWIB = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // ============================================================
    //  TODO: Customize system prompt sesuai kepribadian bot kamu.
    //  Ini adalah template dasar. Tambahkan persona, aturan,
    //  dan kemampuan yang kamu inginkan.
    // ============================================================
    return `Kamu adalah ${botName} — sebuah bot AI yang aktif di Free4Talk (free4talk.com).

Waktu sekarang: ${jamWIB} WIB, ${tglWIB}.

Kepribadianmu: ramah, humoris, dan helpful. Gunakan bahasa yang dipakai user (Indonesia/English).
Balas dengan singkat maksimal 3-4 kalimat. Jangan gunakan markdown/bullet dalam chat room.

// Untuk fitur command execution: tambahkan [CMD:!perintah] di akhir reply.
// Contoh: "Siap! [CMD:!play nama lagu]"`,
}

// ============================================================
//  WEATHER — auto detect kota + fetch Open-Meteo (gratis, no key)
// ============================================================

// Mapping WMO weather code → deskripsi bahasa Indonesia
const WMO_DESC = {
    0: 'Cerah ☀️', 1: 'Umumnya cerah 🌤️', 2: 'Berawan sebagian ⛅', 3: 'Mendung ☁️',
    45: 'Berkabut 🌫️', 48: 'Berkabut beku 🌫️',
    51: 'Gerimis ringan 🌦️', 53: 'Gerimis sedang 🌦️', 55: 'Gerimis lebat 🌧️',
    61: 'Hujan ringan 🌧️', 63: 'Hujan sedang 🌧️', 65: 'Hujan deras 🌧️',
    71: 'Salju ringan 🌨️', 73: 'Salju sedang 🌨️', 75: 'Salju lebat 🌨️',
    80: 'Hujan lokal 🌦️', 81: 'Hujan lokal sedang 🌦️', 82: 'Hujan lokal lebat ⛈️',
    95: 'Badai petir ⛈️', 96: 'Badai + hujan es ⛈️', 99: 'Badai petir lebat ⛈️'
};

/** Coba ekstrak nama kota dari pesan user */
function extractCity(msg) {
    const lower = msg.toLowerCase();

    // Cek dulu apakah pesan berkaitan dengan cuaca/suhu
    const weatherKw = ['cuaca', 'weather', 'suhu', 'temperature', 'panas', 'dingin', 'hujan', 'cerah', 'mendung', 'gerimis', 'badai'];
    if (!weatherKw.some(kw => lower.includes(kw))) return null;

    // Kata-kata yang bukan nama kota (filter false-positive)
    const stopWords = new Set([
        'gimana', 'bagaimana', 'sekarang', 'hari', 'ini', 'tadi', 'disini', 'sini',
        'today', 'now', 'like', 'what', 'right', 'gak', 'ga', 'ngga', 'tidak',
        'berapa', 'banget', 'lagi', 'dong', 'deh', 'sih', 'kan', 'ya', 'yah'
    ]);

    const patterns = [
        // "cuaca di surabaya", "suhu di bandung", "weather in tokyo"
        /(?:cuaca|suhu|weather|temperature)\s+(?:di|in|at|kota)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
        // "di jakarta cuaca/panas/hujan"
        /(?:di|in)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(?:cuaca|suhu|panas|dingin|hujan|cerah|mendung|gerimis)/i,
        // "panas/hujan ga di surabaya", "hujan ngga di medan"
        /(?:panas|dingin|hujan|cerah|mendung|gerimis)\s+(?:ga|gak|ngga|nggak|tidak)?\s*(?:di|in)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
        // "how's weather in bali", "how is the weather in london"
        /how(?:'s| is)\s+(?:the\s+)?weather\s+(?:in|at)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
        // fallback: kata langsung setelah "cuaca" tanpa "di" — "cuaca surabaya"
        /cuaca\s+([a-zA-Z]{3,})/i,
    ];

    for (const re of patterns) {
        const m = msg.match(re);
        if (m && m[1]) {
            const city = m[1].trim().split(/\s+/)[0]; // ambil kata pertama saja jika parse terlalu panjang
            if (city.length > 2 && !stopWords.has(city.toLowerCase())) {
                console.log(`[Weather] Extracted city: "${city}" from: "${msg}"`);
                return city;
            }
        }
    }
    return null;
}


// ============================================================
//  USER CONTEXT — sticky state per user untuk follow-up questions
//  (mis. user nanya "cuaca jakarta", lalu "cuacanya masih panas?"
//   → otomatis pakai jakarta tanpa perlu disebut ulang)
// ============================================================
const _userContext = new Map();              // senderName → { lastCity, lastCity_at, ... }
const USER_CONTEXT_TTL = 10 * 60 * 1000;     // 10 menit

function setUserContext(sender, key, val) {
    if (!_userContext.has(sender)) _userContext.set(sender, {});
    const c = _userContext.get(sender);
    c[key] = val;
    c[`${key}_at`] = Date.now();
}

function getUserContext(sender, key) {
    const c = _userContext.get(sender);
    if (!c) return null;
    if (Date.now() - (c[`${key}_at`] || 0) > USER_CONTEXT_TTL) return null;
    return c[key] || null;
}

/** Detect weather intent (kata-kata yang nunjukin user nanya soal cuaca) */
function hasWeatherIntent(msg) {
    return /\b(cuaca|weather|hujan|panas|dingin|mendung|cerah|suhu|wether|gerah)\b/i.test(msg);
}

// ============================================================
//  WEB SEARCH — Bing HTML scrape (gratis, no key, no deps)
//  (DuckDuckGo diblok beberapa ISP Indonesia, jadi pakai Bing)
// ============================================================
const _searchCache = new Map();              // query (lowercase) → { results, fetchedAt }
const SEARCH_CACHE_TTL = 10 * 60 * 1000;     // 10 menit
const SEARCH_TIMEOUT   = 15_000;             // 15 detik
const SEARCH_TOP_N     = 5;

const SEARCH_HEADERS = {
    'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept'          : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language' : 'id-ID,id;q=0.9,en;q=0.8',
};

/** Bersihin HTML tags + decode entities → plain text */
function cleanHtmlText(s) {
    return String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .replace(/&#0?(\d+);/g, (_, d) => String.fromCharCode(+d))
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Bersihin pesan dari bot name (mention) supaya tidak ke-capture sebagai query.
 * Contoh: "cari gempa gicell" + botName="GicellBot" → "cari gempa"
 */
function stripBotName(msg, botName) {
    if (!msg) return '';
    let cleaned = String(msg).trim();
    if (!botName) return cleaned;

    // Bangun list nama yang harus di-strip:
    // - botName persis (e.g. "GicellBot")
    // - tanpa suffix "Bot" (e.g. "Gicell")
    // - lowercase versions
    const variants = new Set();
    variants.add(botName);
    const noBotSuffix = botName.replace(/bot\s*$/i, '').trim();
    if (noBotSuffix && noBotSuffix !== botName) variants.add(noBotSuffix);

    for (const v of variants) {
        if (!v) continue;
        const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // End of message: "...gicell", "...,gicell!", "... @gicell?"
        cleaned = cleaned.replace(new RegExp(`[\\s,!.@:]*${esc}[\\s,!.?]*$`, 'gi'), '');
        // Start of message: "gicell ...", "@gicell, ...", "gicell: ..."
        cleaned = cleaned.replace(new RegExp(`^[\\s@]*${esc}[\\s,!:.?]+`, 'gi'), '');
    }
    return cleaned.trim();
}

/**
 * Deteksi intent search dari pesan user.
 * Trigger eksplisit: "cari X", "search X", "google X", "googling X"
 * Optional prefix: "tolong/coba/bot, ..."
 * Optional suffix: "...di google/web/internet"
 * Return: query string atau null kalau tidak match.
 */
function extractSearchQuery(msg) {
    const cleanMsg = String(msg || '').trim();
    if (cleanMsg.length < 4) return null;

    // Pattern utama
    const re = /^(?:tolong\s+|coba\s+|bot[,\s]+)?(?:cari(?:in|nya|kan)?|search|googl(?:e|ing))\s+(?:tentang|soal|seputar|ttg|about\s+|info\s+)?(.{3,150}?)(?:\s+(?:di|in|via|pake)\s+(?:google|web|internet|ddg|bing|duckduckgo))?\s*[?.!]*$/i;
    const m = cleanMsg.match(re);
    if (!m || !m[1]) return null;

    const q = m[1].trim();
    // Filter query yang terlalu generic / kemungkinan false positive
    const blacklist = new Set(['ya','iya','gak','ga','aku','kamu','gw','lu','dong','dulu','aja','sih','deh']);
    if (q.length < 3 || blacklist.has(q.toLowerCase())) return null;

    return q;
}

/**
 * Fetch hasil pencarian web via Bing HTML scrape.
 * Return: array of { title, snippet } atau null.
 */
async function fetchSearchResults(query) {
    const key = query.toLowerCase().trim();
    const cached = _searchCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL) {
        console.log(`[Search] Cache hit: "${query}"`);
        return cached.results;
    }

    try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=id-ID&setlang=id`;
        const res = await fetch(url, {
            headers: SEARCH_HEADERS,
            signal: AbortSignal.timeout(SEARCH_TIMEOUT)
        });
        if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
        const html = await res.text();

        // Parse <li class="b_algo">...</li> blocks
        const items = [];
        const blockRe = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
        let m;
        while ((m = blockRe.exec(html)) !== null && items.length < SEARCH_TOP_N) {
            const block = m[1];
            // Title: <h2><a href="...">TITLE</a></h2>
            const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/);
            // Snippet: prioritas b_lineclamp (snippet utama), fallback ke <p> apa saja
            const snippetMatch = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/)
                || block.match(/<p[^>]*>([\s\S]*?)<\/p>/);

            if (titleMatch) {
                const title   = cleanHtmlText(titleMatch[2]);
                const snippet = snippetMatch ? cleanHtmlText(snippetMatch[1]) : '';
                if (title && snippet) {
                    items.push({ title, snippet: snippet.slice(0, 300) });
                }
            }
        }

        if (items.length === 0) {
            console.log(`[Search] No parsable results: "${query}"`);
            return null;
        }

        _searchCache.set(key, { results: items, fetchedAt: Date.now() });
        console.log(`[Search] "${query}" → ${items.length} results (Bing)`);
        return items;
    } catch (e) {
        console.error(`[Search] Error for "${query}":`, e.message);
        return null;
    }
}

/** Format hasil search jadi string untuk inject ke prompt AI */
function formatSearchContext(query, results) {
    const formatted = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.snippet}`
    ).join('\n\n');
    return `\n\n[HASIL PENCARIAN WEB untuk "${query}" — pakai data ini buat jawab pertanyaan user. Ringkas pakai gaya bahasamu sendiri, JANGAN copy-paste. Boleh sebut sumber (misal "menurut BMKG..." / "dari berita yang ada...") kalau memang perlu. Kalau hasil kurang relevan dengan pertanyaan, akui saja dengan jujur.]\n${formatted}`;
}

/** Fetch cuaca dari Open-Meteo (gratis, tanpa API key) */
async function fetchWeather(cityName) {
    try {
        // Step 1: Geocoding — nama kota → lat/lon
        const geoRes  = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=id&format=json`
        );
        const geoData = await geoRes.json();

        if (!geoData.results || geoData.results.length === 0) {
            console.log(`[Weather] City not found: ${cityName}`);
            return null;
        }

        const { latitude, longitude, name, country } = geoData.results[0];

        // Step 2: Cuaca real-time dari Open-Meteo
        const wxRes  = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
            `&timezone=Asia%2FJakarta&forecast_days=1`
        );
        const wxData = await wxRes.json();
        const cur    = wxData.current;

        const kondisi = WMO_DESC[cur.weather_code] || 'Tidak diketahui';

        return (
            `Cuaca saat ini di ${name}, ${country}: ` +
            `${kondisi}, suhu ${cur.temperature_2m}°C ` +
            `(terasa seperti ${cur.apparent_temperature}°C), ` +
            `kelembaban ${cur.relative_humidity_2m}%, ` +
            `angin ${cur.wind_speed_10m} km/j.`
        );
    } catch (e) {
        console.error('[Weather] Fetch error:', e.message);
        return null;
    }
}

// ============================================================
//  MAIN FUNCTION — panggil NIM API
// ============================================================
async function askAI(userMessage, senderName, botState) {
    try {
        const memory  = loadMemory();
        if (!memory[senderName]) memory[senderName] = [];

        const history = memory[senderName];
        const botName = botState.botName || 'Music Bot Pro';

        // --- Auto-detect cuaca: cek apakah pesan menyebut nama kota ---
        // Fallback ke sticky lastCity kalau user nanya cuaca tapi tanpa sebut kota
        // (mis. follow-up "cuacanya gimana sekarang?" setelah "cuaca jakarta")
        let weatherContext = '';
        let detectedCity = extractCity(userMessage);
        if (!detectedCity && hasWeatherIntent(userMessage)) {
            const stickyCity = getUserContext(senderName, 'lastCity');
            if (stickyCity) {
                detectedCity = stickyCity;
                console.log(`[Weather] No city in msg, using sticky lastCity: "${stickyCity}"`);
            }
        }
        if (detectedCity) {
            console.log(`[Weather] Detected city: "${detectedCity}", fetching...`);
            const wxInfo = await fetchWeather(detectedCity);
            if (wxInfo) {
                weatherContext = `\n\n[DATA CUACA REAL-TIME — gunakan ini untuk menjawab pertanyaan cuaca]\n${wxInfo}`;
                setUserContext(senderName, 'lastCity', detectedCity); // sticky untuk follow-up
                console.log(`[Weather] ${wxInfo}`);
            }
        }

        // --- Auto-detect web search: cek apakah pesan minta cari sesuatu ---
        let searchContext = '';
        // Strip bot name dulu supaya "cari X gicell" → query "X" (bukan "X gicell")
        const cleanedMsg  = stripBotName(userMessage, botName);
        const searchQuery = extractSearchQuery(cleanedMsg);
        if (searchQuery) {
            console.log(`[Search] Detected query: "${searchQuery}", fetching...`);
            const results = await fetchSearchResults(searchQuery);
            if (results && results.length > 0) {
                searchContext = formatSearchContext(searchQuery, results);
            } else {
                // Inject failure context supaya AI tahu sudah dicoba dan gagal,
                // bukan halu bilang "aku belum dengar info itu" pakai data lama.
                searchContext = `\n\n[SEARCH GAGAL — sistem barusan mencoba cari "${searchQuery}" di web tapi gagal (kemungkinan timeout / no results / API down). Sampaikan dengan jujur ke user kalau pencariannya barusan gagal, dan saran user coba lagi sebentar atau pakai keyword yang lebih spesifik. JANGAN berpura-pura tahu jawaban dari training data — akui saja kalau search-nya gagal.]`;
            }
        }

        // --- Auto-detect Fun API (shalat / gombal / joke / TOD / resep / quran) ---
        let funContext = '';
        // Skip kalau pesan udah trigger search (search & fun bisa konflik di kalimat seperti "cari resep")
        if (!searchQuery) {
            const funResult = await tryFunApi(cleanedMsg);
            if (funResult) {
                console.log(`[FunAPI] Triggered: ${funResult.type}`);
                funContext = funResult.context;
            }
        }

        // Bangun message array: system prompt + history + pesan baru
        // Inject context (cuaca/search/fun) ke pesan user jika ada
        const userContent = `${senderName}: ${userMessage}${weatherContext}${searchContext}${funContext}`;

        const messages = [
            { role: 'system', content: buildSystemPrompt(botName) },
            ...history,
            { role: 'user', content: userContent }
        ];

        const reply = await callNIM(messages, { max_tokens: 512, temperature: 0.85 });

        // Simpan ke memory (sliding window) — simpan pesan original tanpa weather context
        history.push({ role: 'user',      content: `${senderName}: ${userMessage}` });
        history.push({ role: 'assistant', content: reply });

        if (history.length > MAX_HISTORY) {
            memory[senderName] = history.slice(-MAX_HISTORY);
        } else {
            memory[senderName] = history;
        }

        saveMemory(memory);

        console.log(`[AI] ${senderName} → ${reply.substring(0, 120)}...`);
        return reply;

    } catch (e) {
        console.error('[AI] Error:', e.message);
        return null;
    }
}

// ============================================================
//  UTILS — reset memory
// ============================================================
function clearUserMemory(senderName) {
    const memory = loadMemory();
    delete memory[senderName];
    saveMemory(memory);
    console.log(`[AI] Memory cleared for: ${senderName}`);
}

function clearAllMemory() {
    saveMemory({});
    console.log('[AI] All memory cleared.');
}

// ============================================================
//  ONE-SHOT GENERATOR — AI generate pesan tanpa simpan memory
//  Dipakai untuk: pesan startup, notifikasi sistem, dll
// ============================================================
async function generateOnce(prompt, botState) {
    try {
        const botName = botState.botName || 'Music Bot Pro';
        const messages = [
            { role: 'system', content: buildSystemPrompt(botName) },
            { role: 'user',   content: prompt }
        ];

        const reply = await callNIM(messages, { max_tokens: 300, temperature: 0.9 });
        console.log(`[AI:generateOnce] ${reply?.substring(0, 80)}...`);
        return reply || null;
    } catch (e) {
        console.error('[AI:generateOnce] Error:', e.message);
        return null;
    }
}

// ============================================================
//  PARSE COMMAND dari reply AI
//  Ekstrak [CMD:!xxx] dari reply, return { cleanReply, command }
// ============================================================
function parseCommandFromAI(reply, userMessage = '') {
    if (!reply) return { cleanReply: '', command: null };

    const cmdStart = reply.lastIndexOf('[CMD:');
    if (cmdStart === -1) return { cleanReply: reply.trim(), command: null };

    const cmdEnd = reply.indexOf(']', cmdStart);
    if (cmdEnd === -1) {
        console.warn('[AI] CMD tag truncated, ignoring:', reply.slice(cmdStart));
        return { cleanReply: reply.slice(0, cmdStart).trim(), command: null };
    }

    const command    = reply.slice(cmdStart + 5, cmdEnd).trim();
    const cleanReply = reply.slice(0, cmdStart).trim();

    if (!command.startsWith('!')) {
        console.warn('[AI] CMD tag invalid (no !), ignoring:', command);
        return { cleanReply: reply.trim(), command: null };
    }

    // ── Intent guard (allowlist) ────────────────────────────────────────────
    // AI sering "halu" emit [CMD:...] padahal user cuma ngobrol biasa.
    // Setiap command WAJIB ada keyword pemicu eksplisit di pesan user, atau
    // command-nya di-block. Command yang tidak terdaftar di sini juga di-block
    // by default (AI tidak boleh mengarang command).
    const cmdName = command.slice(1).split(/\s+/)[0].toLowerCase();
    const msgLower = userMessage.toLowerCase();

    const allowed = COMMAND_INTENT_GUARDS[cmdName];
    if (!allowed) {
        console.warn(`[AI] CMD "!${cmdName}" not in allowlist — blocked.`);
        return { cleanReply: reply.trim(), command: null };
    }
    if (!allowed.some(w => msgLower.includes(w))) {
        console.warn(`[AI] !${cmdName} BLOCKED — no explicit intent in: "${userMessage.substring(0, 80)}"`);
        return { cleanReply: reply.trim(), command: null };
    }

    console.log(`[AI] ➔ Executing command intent: "${command}"`);
    return { cleanReply, command };
}

// ============================================================
//  COMMAND INTENT GUARDS — allowlist keyword pemicu per command
//  Format: { commandName: ['keyword1', 'keyword2', ...] }
//  Keyword di-cek dengan substring match (case-insensitive).
//  Kalau salah satu keyword muncul di pesan user → command boleh fire.
//  Kalau tidak ada → command di-block.
// ============================================================
const COMMAND_INTENT_GUARDS = {
    // ── Musik ────────────────────────────────────────────────────────
    play:    ['putar','putiin','mainkan',' play','play ','puter','dengerin',
              'pasangin','pasang lagu','nyalain','nyalakan','muter lagu','mutar lagu','muterin','mutarin'],
    p:       ['putar','putiin','mainkan',' play','play ','puter','dengerin',
              'pasangin','pasang lagu','nyalain','nyalakan','muter lagu','mutar lagu'],
    skip:    ['skip','lewati','lewat','ganti lagu','next lagu','selanjutnya','ganti dong'],
    s:       ['skip','lewati','lewat','next lagu'],
    stop:    ['stop','berhenti','henti','matikan','matiin','udahin','sudahi','hentikan'],
    np:      ['np','now playing','lagu apa','lagu sekarang','lagu yang','sekarang muter','lagi muter','judul lagu'],
    queue:   ['queue','antrean','antrian','daftar lagu','playlist','antri'],
    q:       ['queue','antrean','antrian','daftar lagu','antri'],
    repeat:  ['repeat','ulang','ulangi','loop','ulangin'],
    r:       ['repeat','ulang','ulangi','loop'],
    search:  ['cari lagu','cariin','search','find lagu','temukan lagu'],
    lirik:   ['lirik','lyric','liriknya','liriknya apa'],
    vol:     ['volume','vol ','kecilkan','besarkan','keraskan','kecilin','besarin','kerasin','volumenya'],

    // ── Audio FX ─────────────────────────────────────────────────────
    speed:     ['speed','kecepatan','cepetin','lambatin','percepat','perlambat'],
    bass:      ['bass','ngebass','bassnya'],
    treble:    ['treble','jernihin','crispy'],
    reverb:    ['reverb','gema','gua'],
    '8d':      ['8d','delapan d','muter telinga'],
    nightcore: ['nightcore'],
    vaporwave: ['vaporwave','aesthetic'],
    slowed:    ['slowed','slow','chill mode'],
    fx:        ['efek','effect','fx ','status fx'],
    fxreset:   ['fxreset','reset efek','reset fx','normalin lagu','normalin musik','balikin normal'],

    // ── Ekonomi ──────────────────────────────────────────────────────
    daily:     ['daily','reward harian','ambil daily','klaim daily'],
    balance:   ['balance','saldo','duit','koin','uang ku','berapa coin','berapa koin','cek bal'],
    bal:       ['balance','saldo','duit','koin','uang ku','berapa coin','cek bal'],
    shop:      ['shop','toko','market','daftar item','jual apa','liat shop'],
    buy:       ['beli','beliin','order'],
    sell:      ['sell','jual','jualin'],
    inv:       ['inv','inventory','tas','barang ku','isi tas','liat tas'],
    inventory: ['inventory','tas','barang ku','isi tas','liat tas'],

    // ── RPG ──────────────────────────────────────────────────────────
    hunt:      ['hunt','berburu','buru','ngeburu','huntin'],
    heal:      ['heal','sembuh','sembuhin','obat','obatin','healin'],
    adventure: ['adventure','petualangan','petualang','adv'],

    // ── Voice / TTS ──────────────────────────────────────────────────
    // Bot ngomong via Microsoft Edge TTS, broadcast ke voice room.
    // Trigger word eksplisit untuk hindari mis-fire dari obrolan biasa.
    say:       ['ngomong','ucapin','ucapkan','sebut','sebutin','bilang','bilangin',
                'bicara','bacain','baca','sapa','sapain','speak','say ','tts','ngomong dong'],
    ngomong:   ['ngomong','ucapin','ucapkan','sebut','sebutin','bilang','bilangin',
                'bicara','bacain','baca','sapa','sapain','speak','say ','tts'],
    speak:     ['speak','say ','tts','ngomong','ucapin','bilang'],
};


module.exports = { askAI, generateOnce, clearUserMemory, clearAllMemory, parseCommandFromAI };
