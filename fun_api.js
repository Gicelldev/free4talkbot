// ============================================================
//  fun_api.js — Fun Pack 6-in-1
//  Jadwal Shalat, Rayuan Gombal, Dad Joke, Truth/Dare, Resep, Quran
// ============================================================
const FUN_TIMEOUT = 10_000;
const FUN_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) F4T-Bot/1.0',
    'Accept'    : 'application/json',
};

// Cache untuk yang stabil-ish (shalat dalam 1 hari)
const _shalatCache = new Map();
const SHALAT_CACHE_TTL = 60 * 60 * 1000; // 1 jam

async function safeJsonFetch(url, opts = {}) {
    try {
        const res = await fetch(url, {
            ...opts,
            headers: { ...FUN_HEADERS, ...(opts.headers || {}) },
            signal: AbortSignal.timeout(FUN_TIMEOUT),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`[FunAPI] fetch error ${url.slice(0, 60)}: ${e.message}`);
        return null;
    }
}

// ============================================================
//  1. JADWAL SHALAT — Aladhan API (method 20 = Kemenag Indonesia)
// ============================================================
function extractShalatCity(msg) {
    const m = msg.match(/\b(?:jadwal|waktu)\s+(?:shalat|sholat|sembahyang)(?:\s+(?:di\s+|untuk\s+)?([a-zA-Z]+))?/i)
          || msg.match(/\bkapan\s+(?:subuh|dhuhur|dzuhur|ashar|maghrib|isya|isyak)(?:\s+(?:di\s+)?([a-zA-Z]+))?/i);
    if (!m) return null;
    return m[1] ? m[1].trim() : 'Jakarta';
}

async function fetchShalat(city) {
    const cacheKey = `shalat:${city.toLowerCase()}:${new Date().toISOString().slice(0,10)}`;
    const cached = _shalatCache.get(cacheKey);
    if (cached && Date.now() - cached.t < SHALAT_CACHE_TTL) return cached.data;

    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=20`;
    const json = await safeJsonFetch(url);
    if (!json?.data?.timings) return null;

    const t = json.data.timings;
    const date = json.data.date?.readable || '';
    const data = { city, date, fajr: t.Fajr, dhuhr: t.Dhuhr, asr: t.Asr, maghrib: t.Maghrib, isha: t.Isha, sunrise: t.Sunrise };
    _shalatCache.set(cacheKey, { data, t: Date.now() });
    return data;
}

function formatShalat(d) {
    return `[JADWAL SHALAT — pakai data ini buat jawab]\n` +
        `Kota: ${d.city}${d.date ? ` (${d.date})` : ''}\n` +
        `- Subuh  : ${d.fajr}\n` +
        `- Terbit : ${d.sunrise}\n` +
        `- Dhuhur : ${d.dhuhr}\n` +
        `- Ashar  : ${d.asr}\n` +
        `- Maghrib: ${d.maghrib}\n` +
        `- Isya   : ${d.isha}`;
}

// ============================================================
//  2. RAYUAN GOMBAL — hardcoded list (API source-nya 404 semua)
// ============================================================
const GOMBAL_LIST = [
    "Boleh aku kecil di sini? Soalnya kamu sudah besar di hatiku.",
    "Wifi-nya nyala dong, biar aku bisa terhubung sama kamu.",
    "Kamu pasti capek deh, soalnya kamu lari di pikiranku seharian.",
    "Apa kamu Google? Soalnya kamu udah punya semua yang aku cari.",
    "Apa kamu petir? Soalnya kamu menyambar hatiku begitu saja.",
    "Kamu sakit ya? Aku khawatir, soalnya senyum kamu bikin aku jatuh sakit.",
    "Tahu apa yang lebih indah dari rembulan? Senyum kamu.",
    "Apa kamu kunci? Karena kamu yang membuka hatiku.",
    "Apa kamu kopi? Soalnya kamu yang bikin aku gak bisa tidur malam ini.",
    "Hujan boleh basahin baju, tapi pesona kamu udah basahin hatiku.",
    "Kalau kamu jadi soal matematika, aku rela ngerjain seharian, asal kamu jadi solusinya.",
    "Apa kamu loker? Karena cuma kamu yang bisa nyimpen rahasia hatiku.",
    "Boleh tukar pikiran gak? Pikiran aku tentang kamu, dengan kamu yang lagi mikirin aku.",
    "Hidup kamu aja udah seperti puisi, apalagi kalau kamu mau jadi puisiku.",
    "Apa kamu listrik? Karena kamu bikin aku selalu nyetrum.",
    "Apa kamu malaikat? Soalnya wajahmu surga banget.",
    "Kalau aku jadi koki, kamu pasti jadi resep favoritku.",
    "Apa kamu peta? Soalnya aku tersesat di matamu.",
    "Tahu kenapa langit malam jadi indah? Karena dia ngiri sama kamu.",
    "Aku gak butuh charger, asal ada kamu yang bisa ngecas hatiku.",
    "Apa kamu kalkulator? Soalnya kamu menjumlahkan kebahagiaan dalam hidupku.",
    "Kalau aku punya 3 permintaan, semua tentang kamu — jadi kamu, miliki kamu, sama kamu.",
    "Apa kamu air? Karena aku gak bisa hidup tanpamu.",
    "Boleh minta nomor kamu gak? Soalnya nomor di handphoneku belum ada nomor pemilik hati.",
    "Apa kamu salju di musim panas? Soalnya kamu bikin hari yang terik jadi sejuk.",
    "Kamu pasti pelukis, soalnya kamu sudah melukis senyum di wajahku.",
    "Apa kamu jam alarm? Soalnya kamu yang bikin aku semangat bangun pagi.",
    "Aku bukan fotografer, tapi aku bisa membayangkan kita berdua dalam frame yang sama.",
    "Apa kamu permen? Karena kamu manis dan bikin nagih.",
    "Tuhan pasti lagi nyiptain mahakarya pas bikin kamu, soalnya kamu sempurna banget.",
    "Apa kamu lampu lalu lintas? Soalnya tiap aku liat kamu, hatiku berhenti sejenak.",
    "Kalau cinta itu kejahatan, aku rela dipenjara seumur hidup sama kamu.",
    "Apa kamu wifi rumah? Karena aku selalu pengen nyambung sama kamu.",
    "Boleh aku jadi GPS-mu gak? Biar kemana pun kamu pergi, aku selalu bisa ngarahin kamu pulang ke aku.",
    "Apa kamu earphone? Soalnya kamu yang bikin hari-hariku jadi punya soundtrack."
];

function hasGombalIntent(msg) {
    return /\b(?:rayuan\s+gombal|gombalin|gombalan|gombal\s+(?:dong|aja|donk))\b/i.test(msg)
        || /\b(?:kasih|mau|coba|pengen|gimme)\s+(?:rayuan|gombal)/i.test(msg)
        || /^gombal[!?.]*$/i.test(msg.trim());
}

function getRandomGombal() {
    return GOMBAL_LIST[Math.floor(Math.random() * GOMBAL_LIST.length)];
}

function formatGombal(quote) {
    return `[RAYUAN GOMBAL — sampaikan persis seperti ini ke user dengan gaya playful + tambahan emoji 😏💘 yang sesuai. JANGAN diubah/diparafrase isinya.]\n"${quote}"`;
}

// ============================================================
//  3. DAD JOKE — icanhazdadjoke.com
// ============================================================
function hasJokeIntent(msg) {
    if (/\bjoker\b/i.test(msg)) return false;
    return /\b(?:kasih|mau|gimme|bikin|coba|pengen|share)\s+(?:joke|jokes|garingan|lawakan|guyonan)\b/i.test(msg)
        || /\b(?:joke|jokes|garingan|lawakan|guyonan)\s+(?:dong|aja|please|donk)\b/i.test(msg)
        || /\bdad\s+joke\b/i.test(msg)
        || /^(?:joke|jokes|garingan|lawakan)[!?.]*$/i.test(msg.trim());
}

async function fetchDadJoke() {
    const json = await safeJsonFetch('https://icanhazdadjoke.com/', {
        headers: { 'Accept': 'application/json' }
    });
    return json?.joke || null;
}

function formatDadJoke(joke) {
    return `[DAD JOKE — joke ini dalam bahasa Inggris. Translate ke Indonesia dengan natural sambil pertahankan jokes-nya. Tambahin reaksi lucu di akhir.]\n"${joke}"`;
}

// ============================================================
//  4. TRUTH or DARE — truthordarebot.xyz
// ============================================================
function extractTodType(msg) {
    const cleaned = msg.trim().toLowerCase();
    // WYR — "wyr" / "would you rather" / "mendingan" (mendingan harus standalone biar gak false positive)
    if (/\bwyr\b/i.test(cleaned)) return 'wyr';
    if (/\bwould\s+you\s+rather\b/i.test(cleaned)) return 'wyr';
    if (/^mendingan(?:\s+(?:dong|aja|donk))?[!?.]*$/i.test(cleaned)) return 'wyr';
    // Truth or Dare combo
    if (/\btruth\s+or\s+dare\b/i.test(cleaned)) return Math.random() > 0.5 ? 'truth' : 'dare';
    // Single-word
    if (/^(?:truth|dare)[!?.]*$/i.test(cleaned)) return cleaned.match(/(truth|dare)/i)[1].toLowerCase();
    // With intent prefix
    if (/\b(?:kasih|mau|gimme|coba|pengen)\s+(?:truth|dare)\b/i.test(cleaned)) return cleaned.match(/(truth|dare)/i)[1].toLowerCase();
    // With intent suffix
    if (/\b(?:truth|dare)\s+(?:dong|aja|please|me|ku|donk)\b/i.test(cleaned)) return cleaned.match(/(truth|dare)/i)[1].toLowerCase();
    return null;
}

async function fetchTod(type) {
    // type: 'truth' | 'dare' | 'wyr'
    const url = `https://api.truthordarebot.xyz/v1/${type}`;
    const json = await safeJsonFetch(url);
    if (!json?.question) return null;
    return { question: json.question, rating: json.rating || 'PG', type: json.type || type.toUpperCase() };
}

function formatTod(d) {
    const labelMap = { 'TRUTH': 'TRUTH', 'DARE': 'DARE', 'WYR': 'WOULD YOU RATHER' };
    const label = labelMap[d.type] || d.type;
    return `[${label} (${d.rating}) — pertanyaan dalam Bahasa Inggris. Translate dengan natural ke Bahasa Indonesia, sampaikan ke user dengan gaya playful + ajak mereka jawab.]\n"${d.question}"`;
}

// ============================================================
//  5. RESEP MAKANAN — TheMealDB
// ============================================================
function extractRecipeQuery(msg) {
    if (/\bresep\s+(?:random|aja|apa\s+aja|bebas)\b/i.test(msg)) return '__random__';
    const m = msg.match(/\b(?:resep|cara\s+(?:bikin|buat|masak))\s+([a-zA-Z][a-zA-Z\s]{1,40}?)(?:\s+(?:dong|aja|please|donk|gicell))?[?.!]*$/i);
    if (!m) return null;
    return m[1].trim();
}

async function fetchRecipe(query) {
    let url;
    if (query === '__random__') {
        url = 'https://www.themealdb.com/api/json/v1/1/random.php';
    } else {
        url = `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`;
    }
    const json = await safeJsonFetch(url);
    if (!json?.meals?.[0]) return null;
    const m = json.meals[0];

    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
        const ing  = m[`strIngredient${i}`];
        const meas = m[`strMeasure${i}`];
        if (ing && ing.trim()) ingredients.push(`${meas?.trim() || ''} ${ing.trim()}`.trim());
    }

    return {
        name        : m.strMeal,
        category    : m.strCategory,
        area        : m.strArea,
        ingredients : ingredients.slice(0, 12),
        instructions: (m.strInstructions || '').replace(/\r\n|\r|\n/g, ' ').slice(0, 600),
    };
}

function formatRecipe(r) {
    return `[RESEP MAKANAN — data ini dari TheMealDB (mostly Western/Asian food, content English). Translate seperlunya, sampaikan dengan gaya cerita santai. Boleh skip detail yang gak relevan / sebut "bisa googling lebih detail" kalau ringkasan saja gak cukup.]\n` +
        `Nama: ${r.name}\n` +
        `Kategori: ${r.category} (${r.area})\n` +
        `Bahan utama:\n  - ${r.ingredients.join('\n  - ')}\n` +
        `Cara: ${r.instructions}`;
}

// ============================================================
//  6. QURAN AYAT RANDOM — alquran.cloud
// ============================================================
function hasAyatIntent(msg) {
    return /\b(?:kasih|mau|gimme|bagi|kirim|baca)\s+(?:ayat|surat|surah)\b/i.test(msg)
        || /\b(?:ayat|surat|surah)\s+(?:random|dong|aja|sehari|hari\s+ini)\b/i.test(msg);
}

async function fetchAyat() {
    // Quran punya 6236 ayat total
    const randomN = Math.floor(Math.random() * 6236) + 1;
    const url = `https://api.alquran.cloud/v1/ayah/${randomN}/editions/quran-uthmani,id.indonesian`;
    const json = await safeJsonFetch(url);
    if (!json?.data || json.data.length < 2) return null;

    const arabic = json.data.find(d => d.edition?.identifier === 'quran-uthmani') || json.data[0];
    const indo   = json.data.find(d => d.edition?.identifier === 'id.indonesian')  || json.data[1];

    return {
        surahName    : arabic.surah?.englishName || '',
        surahNameAr  : arabic.surah?.name || '',
        surahNumber  : arabic.surah?.number || 0,
        ayahNumber   : arabic.numberInSurah || 0,
        arabic       : arabic.text || '',
        indonesian   : indo.text || '',
    };
}

function formatAyat(a) {
    return `[QURAN AYAT — sampaikan dengan gaya hormat dan reflektif. Sebutkan surah & nomor ayatnya. JANGAN ubah teks Arab atau terjemahannya.]\n` +
        `Q.S. ${a.surahName} (${a.surahNameAr}) — ${a.surahNumber}:${a.ayahNumber}\n\n` +
        `${a.arabic}\n\n` +
        `Terjemahan:\n${a.indonesian}`;
}

// ============================================================
//  DISPATCHER — coba tiap handler, pertama match menang
// ============================================================
async function tryFunApi(userMessage) {
    if (!userMessage) return null;

    // 1. Shalat (paling spesifik dengan kata kunci unik)
    const shalatCity = extractShalatCity(userMessage);
    if (shalatCity) {
        const data = await fetchShalat(shalatCity);
        if (data) return { type: 'shalat', context: '\n\n' + formatShalat(data) };
    }

    // 2. Quran ayat (kata kunci unik "ayat/surat")
    if (hasAyatIntent(userMessage)) {
        const data = await fetchAyat();
        if (data) return { type: 'ayat', context: '\n\n' + formatAyat(data) };
    }

    // 3. Recipe
    const recipeQuery = extractRecipeQuery(userMessage);
    if (recipeQuery) {
        const data = await fetchRecipe(recipeQuery);
        if (data) return { type: 'recipe', context: '\n\n' + formatRecipe(data) };
        // Kalau tidak ditemukan, beri tahu user
        return {
            type: 'recipe-notfound',
            context: `\n\n[RESEP TIDAK DITEMUKAN — TheMealDB tidak punya resep untuk "${recipeQuery}" (database mostly Western/Asian food, banyak makanan Indonesia tidak ada). Sampaikan ke user dengan jujur, dan saran cari di Cookpad / YouTube.]`
        };
    }

    // 4. Truth/Dare/WYR
    const todType = extractTodType(userMessage);
    if (todType) {
        const data = await fetchTod(todType);
        if (data) return { type: 'tod', context: '\n\n' + formatTod(data) };
    }

    // 5. Gombal
    if (hasGombalIntent(userMessage)) {
        const quote = getRandomGombal();
        return { type: 'gombal', context: '\n\n' + formatGombal(quote) };
    }

    // 6. Dad Joke
    if (hasJokeIntent(userMessage)) {
        const joke = await fetchDadJoke();
        if (joke) return { type: 'joke', context: '\n\n' + formatDadJoke(joke) };
    }

    return null;
}

module.exports = { tryFunApi };
