// server.js — no Express/HTTP server (manager.js handles all UI via IPC)
const { chromium }  = require('playwright');
const path          = require('path');
const fs            = require('fs');
const { execFile }   = require('child_process');
const { promisify }  = require('util');
const execFileAsync  = promisify(execFile);
const yts            = require('yt-search');
const { askAI, generateOnce, parseCommandFromAI } = require('./ai.js');
const { generateTTS } = require('./tts.js');
const { handlePeerUtterance, getVoiceStatus } = require('./voice.js');

// ── yt-dlp: ambil direct stream URL ────────────────────────────────────────────
// Cache: hindari re-fetch URL yang sama (YouTube stream URL valid ~4-6 jam)
const _streamUrlCache = new Map();  // videoUrl → { url, fetchedAt }
const STREAM_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 jam
const _pendingFetches  = new Map();  // dedup: cegah 2 call yt-dlp untuk URL yang sama

async function getStreamUrl(videoUrl) {
    // 1. Cache hit
    const cached = _streamUrlCache.get(videoUrl);
    if (cached && Date.now() - cached.fetchedAt < STREAM_CACHE_TTL) {
        console.log(`[MUSIC] Cache hit: ${videoUrl.slice(-20)}`);
        return cached.url;
    }

    // 2. Dedup: kalau sudah ada fetch yang pending untuk URL ini, tunggu itu saja
    if (_pendingFetches.has(videoUrl)) {
        console.log(`[MUSIC] Dedup — waiting for pending fetch: ${videoUrl.slice(-20)}`);
        return _pendingFetches.get(videoUrl);
    }

    // 3. Fetch baru
    const fetchPromise = (async () => {
        try {
            const { stdout } = await execFileAsync('yt-dlp', [
                // Format audio-only (lebih cepat, tidak perlu merge video)
                // 140 = m4a 128k, 251 = webm/opus, 250 = webm/opus low
                '-f', '140/251/250/bestaudio[ext=m4a]/bestaudio',
                '--get-url',
                '--no-playlist',
                '--no-warnings',
                '--no-call-home',
                '--socket-timeout', '10',
                videoUrl
            ]);
            const url = stdout.trim().split('\n').find(l => l.startsWith('http'));
            if (!url) throw new Error('yt-dlp returned no valid URL');
            _streamUrlCache.set(videoUrl, { url, fetchedAt: Date.now() });
            return url;
        } finally {
            _pendingFetches.delete(videoUrl);
        }
    })();

    _pendingFetches.set(videoUrl, fetchPromise);
    return fetchPromise;
}

// Pre-fetch stream URL di background (untuk next song di queue)
function preFetchNextSong() {
    if (botState.queue.length > 0) {
        const next = botState.queue[0];
        if (next?.url && !_streamUrlCache.has(next.url) && !_pendingFetches.has(next.url)) {
            console.log(`[MUSIC] Pre-fetching next song: ${next.title}`);
            getStreamUrl(next.url).catch(() => {});  // fire & forget
        }
    }
}



// ── Static role config (roles.json) — hot-reloaded on change ────────────────────
const ROLES_PATH = path.join(__dirname, 'roles.json');
let staticRoles  = { owners: [], coOwners: [], moderators: [], admins: [] };
function loadRoles() {
    try {
        staticRoles = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
        console.log(`[ROLES] Loaded: ${staticRoles.owners?.length||0} owners, ${staticRoles.moderators?.length||0} mods`);
    } catch (_) {}
}
loadRoles();
fs.watchFile(ROLES_PATH, () => { loadRoles(); applyStaticRoles(); });

/** Apply staticRoles to participantDetails (call after roles.json changes or after participants load) */
function applyStaticRoles() {
    const map = [
        ['Owner',     staticRoles.owners     || []],
        ['Co-owner',  staticRoles.coOwners   || []],
        ['Moderator', staticRoles.moderators || []],
        ['Admin',     staticRoles.admins     || []],
    ];
    for (const [role, uids] of map) {
        for (const uid of uids) {
            const existing = participantDetails.get(uid) || { name: uid };
            participantDetails.set(uid, { ...existing, role });
        }
    }
    updateParticipants();
}

// ── IPC: terima perintah dari manager.js via process.send() ──────────────

// ── Bot runtime state ────────────────────────────────────────────────────────
let browser  = null;
let context  = null;
let page     = null;
let botState = {
    status:       'OFFLINE',
    currentSong:  null,
    queue:        [],
    searchResults:[],
    isPlaying:    false,
    isRepeating:  false,
    volume:       10,
    botName:      'Music Bot Pro',
    participants: [],  // [{uid, name, role}] — real-time room list
    aiMuteUntil:  0,   // timestamp ms; 0 = AI aktif, >now = AI di-mute (set via !ai off/sleep)
    voiceListenActive: true   // Voice conversation mode (wake word listen via Groq STT)
};

// ── Hot-reload commands.js ───────────────────────────────────────────────────
let commandHandler = require('./commands.js');
fs.watchFile(path.join(__dirname, 'commands.js'), () => {
    try {
        delete require.cache[require.resolve('./commands.js')];
        commandHandler = require('./commands.js');
        log('Commands reloaded!', 'success');
    } catch (e) {
        log('Failed to reload commands: ' + e.message, 'error');
    }
});

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false }).replace(/\./g, '.');
    // Kirim via IPC ke manager (untuk dashboard broadcast)
    if (process.send) process.send({ type: 'bot-log', time, msg, level: type });
    console.log(`[${time}] [${type}] ${msg}`);
}
function updateStatus() {
    if (process.send) process.send({ type: 'bot-status', state: botState });
}

function updateParticipants() {
    botState.participants = [...participantDetails.entries()].map(([uid, d]) => ({
        uid, name: d.name || uid, role: d.role || 'Member'
    }));
    updateStatus();
    // Trigger auto-leave check setiap kali participant list berubah
    checkEmptyRoom();
}

// ── Auto-leave: keluar jika room kosong selama AUTO_LEAVE_SEC detik ──────────
const AUTO_LEAVE_SEC = 30;
let   emptyRoomTimer = null;

function checkEmptyRoom() {
    if (botState.status !== 'ONLINE') return;
    // Hitung peserta selain bot sendiri
    const others = botState.participants.filter(p => p.uid !== botMyId);
    if (others.length === 0) {
        if (!emptyRoomTimer) {
            log(`[AUTO-LEAVE] Room kosong — akan keluar dalam ${AUTO_LEAVE_SEC} detik...`, 'warn');
            emptyRoomTimer = setTimeout(() => {
                leaveRoom('Room kosong selama ' + AUTO_LEAVE_SEC + ' detik.');
            }, AUTO_LEAVE_SEC * 1000);
        }
    } else {
        // Ada orang → batalkan timer
        if (emptyRoomTimer) {
            clearTimeout(emptyRoomTimer);
            emptyRoomTimer = null;
            log('[AUTO-LEAVE] Timer dibatalkan — ada peserta masuk.', 'info');
        }
    }
}

// Ref ke sendMessage dan scanDomForOwner — diset saat bot start
let _sendMessage      = null;
let _scanDomForOwner  = null;
let _resolveWsReady   = null;  // resolve saat WS room confirm pertama
let _domScanInterval  = null;  // ID interval DOM scan — di-clear saat bot stop

async function leaveRoom(reason = 'Keluar room.') {
    log(`[AUTO-LEAVE] ${reason}`, 'warn');
    clearTimeout(emptyRoomTimer);
    emptyRoomTimer = null;

    // Stop DOM scan interval supaya tidak error setelah context ditutup
    if (_domScanInterval) { clearInterval(_domScanInterval); _domScanInterval = null; }
    _scanDomForOwner = null;

    try { if (_sendMessage) await _sendMessage(`👋 Bot keluar: ${reason}`); } catch (_) {}
    await new Promise(r => setTimeout(r, 1500));
    if (context) { try { await context.close(); } catch (_) {} }
    if (browser)  { try { await browser.close();  } catch (_) {} }
    browser  = null;
    context  = null;
    page     = null;
    botJwk   = null;
    botMyId  = null;
    participantDetails.clear();
    participantsCache.clear();
    botState.status = 'OFFLINE';
    botState.participants = [];
    botState.currentSong  = null;
    botState.queue        = [];
    botState.isPlaying    = false;
    updateStatus();
    log('Bot offline. Process akan exit dalam 2 detik.', 'info');

    // Exit process — manager akan detect dan mark STOPPED
    setTimeout(() => process.exit(0), 2000);
}

// ── Anti-loop guard ──────────────────────────────────────────────────────────
const sentMessages    = new Set();
let   botLastSentAt   = 0;
const BOT_SEND_COOLDOWN = 8000;          // ms
const BOT_OWN_NAMES     = ['GicellBot', 'riyan', 'rj'];

// Bot identity (for Option 3 direct send)
let botJwk  = null;   // { x, y, d } dari JWK keypair
let botMyId = null;   // uid bot di Free4Talk

// AI mutex
let isAIProcessing = false;

function normalizeMsg(text) {
    return text
        .replace(/[`*_~|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 150);
}

// ── Participants cache ────────────────────────────────────────────────────────
const participantsCache   = new Map(); // name.toLowerCase() → uid
const participantDetails  = new Map(); // uid → { name, role }
const msgSeenKeys         = new Set(); // dedup

// ── Voice: WebRTC trackId → participant name mapping ─────────────────────────
// Diisi via __onTrackJoined (best-effort: nama participant yang baru join
// dikorelasikan ke track yang baru muncul dalam 3s window)
const _trackParticipantNames = new Map();

/** Lookup clean name by uid */
function nameOf(uid) {
    return participantDetails.get(uid)?.name || uid || 'Unknown';
}
/** Lookup role by uid */
function roleOf(uid) {
    return participantDetails.get(uid)?.role || 'Member';
}

/** Normalize Free4Talk role strings → canonical form */
function resolveRole(raw) {
    const r = (raw || '').toString().toLowerCase();
    // PENTING: cek co-owner SEBELUM owner (co-owner juga contains 'owner')
    if (r.includes('co-owner') || r.includes('coowner') || r === 'co') return 'Co-owner';
    if (r.includes('owner'))     return 'Owner';
    if (r.includes('moderator') || r.includes('mod'))    return 'Moderator';
    if (r.includes('admin'))     return 'Admin';
    return 'Member';
}

// ════════════════════════════════════════════════════════════════════════════
//  SEND MESSAGE  —  DOM primary (DataChannel direct disabled pending debug)
// ════════════════════════════════════════════════════════════════════════════
async function sendMessage(text) {
    if (!page) return;
    try {
        botLastSentAt = Date.now();
        const fp = normalizeMsg(text);
        sentMessages.add(fp);
        setTimeout(() => sentMessages.delete(fp), 15000);

        // ── Option 3: sign message with ECDSA and send via transporter ────────
        // NOTE: MSG:DIRECT sends but messages don't appear (silent reject by receiver).
        // Kept here for future debugging — bot uses DOM fallback which works reliably.
        // if (botJwk && botMyId) { ... }

        // ── Send via DOM (React native setter + keyboard events) ──────────────
        const sel   = 'textarea[placeholder*="Type a message"], input[placeholder*="Type a message"]';
        const sent  = await page.evaluate(async (msg) => {
            const input = document.querySelector(
                'textarea[placeholder*="Type a message"], input[placeholder*="Type a message"]'
            );
            if (!input) return false;
            const proto  = input instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(input, msg);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 30));
            const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            input.dispatchEvent(new KeyboardEvent('keydown',  opts));
            input.dispatchEvent(new KeyboardEvent('keypress', opts));
            input.dispatchEvent(new KeyboardEvent('keyup',    opts));
            return true;
        }, text);

        if (!sent) {
            await page.fill(sel, text);
            await page.keyboard.press('Enter');
        }
    } catch (e) {
        log('Failed to send message: ' + e.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  AI RELEVANCE GATE — tentukan apakah AI perlu balas pesan ini
// ════════════════════════════════════════════════════════════════════════════
let _aiLastReplyAt   = 0;
// Catatan: status mute disimpan di botState.aiMuteUntil (timestamp ms; 0 = aktif)
// supaya plugin (!ai off/on/sleep) bisa modify lewat ctx.botState.
const AI_DIRECT_COOLDOWN = 0;     // Direct mention: NO cooldown — user manggil eksplisit, harus selalu respond
const AI_QUESTION_COOLDOWN = 30000; // 30 detik untuk pertanyaan
const AI_RANDOM_COOLDOWN  = 90000; // 90 detik untuk random nimbrung
const AI_RANDOM_CHANCE    = 0.05;  // 5% (turun dari 15%)

// Ringkasan pesan terakhir untuk deteksi conversation antar-user
const _recentChats = [];          // [{ name, text, ts }]
const RECENT_CHAT_WINDOW = 20000; // 20 detik

function recordChat(name, text) {
    const now = Date.now();
    _recentChats.push({ name, text, ts: now });
    while (_recentChats.length && now - _recentChats[0].ts > RECENT_CHAT_WINDOW) {
        _recentChats.shift();
    }
}

/** Apakah pesan ini terlihat ditujukan ke user lain (bukan ke bot)? */
function isAddressedToOtherUser(text, participants = []) {
    const lower = text.toLowerCase();

    // 1. Eksplisit @mention (bukan @bot)
    const mentionMatch = lower.match(/@([a-z0-9_]+)/);
    if (mentionMatch) {
        const mentioned = mentionMatch[1];
        const isBot = ['bot', 'gicell', 'gicellbot'].some(b => mentioned.includes(b));
        if (!isBot) return true;
    }

    // 2. Sapaan langsung ke nama participant: "bro X", "kak X", "mbak X", "bang X", "sis X", "om X", "tante X"
    const addressPrefixes = ['bro ', 'kak ', 'mbak ', 'bang ', 'sis ', 'om ', 'tante ', 'mas ', 'kang '];
    for (const p of participants) {
        if (!p?.name) continue;
        const pname = p.name.toLowerCase();
        if (['bot', 'gicell', 'gicellbot'].some(b => pname.includes(b))) continue;
        // Match nama participant di pesan dengan prefix sapaan ATAU sebagai standalone token
        if (addressPrefixes.some(prefix => lower.includes(prefix + pname))) return true;
        // Bare name match (min 4 char buat hindari false positive)
        if (pname.length >= 4 && new RegExp(`\\b${pname}\\b`, 'i').test(lower)) return true;
    }

    return false;
}

/** Apakah ada conversation aktif antara 2+ user lain? */
function hasActiveUserConversation(currentSender) {
    const others = _recentChats.filter(c => c.name !== currentSender);
    const uniqueNames = new Set(others.map(c => c.name));
    // Conversation = ada minimal 1 user lain ngirim chat dlm window terakhir
    // dan combined chats >= 2 (saling balas / lanjutan)
    return uniqueNames.size >= 1 && others.length >= 2;
}

function checkAIRelevance(text, botName = 'GicellBot', senderName = '', participants = [], muteUntil = 0) {
    const lower      = text.toLowerCase().trim();
    const botLower   = botName.toLowerCase();
    const now        = Date.now();
    const sinceReply = now - _aiLastReplyAt;
    const isMuted    = muteUntil && muteUntil > now;

    // ── Tier 1: Direct mention / dipanggil langsung ───────────────────────
    // Catatan: 'bot' standalone dihapus karena terlalu generic ("lu bot ya", "kayak bot").
    // Tetap ada via prefix "hei bot/hey bot/hai bot" atau via nama bot eksplisit.
    // Direct mention BYPASS mute — supaya user bisa unmute via "!ai on" atau dipanggil ulang.
    //
    // Auto-typo tolerance dari botName:
    //   "GicellBot" → botLower "gicellbot"
    //                 → strip "bot" suffix → "gicell"
    //                 → dedupe huruf double "ll" → "gicel" (typo umum!)
    // Ini supaya user yang ngetik "gicel" / "gicell" / "gicellbot" semua match.
    const botRoot      = botLower.replace(/bot$/i, '');         // "gicell"
    const botRootDedup = botRoot.replace(/(.)\1+/g, '$1');      // "gicel"
    const directTriggers = [
        botLower,
        botRoot,
        botRootDedup,
        'hei bot', 'hey bot', 'hai bot', 'halo bot', 'oi bot', 'woi bot',
    ].filter((t, i, a) => t && t.length >= 3 && a.indexOf(t) === i);
    const isDirect = directTriggers.some(t => lower.includes(t));
    if (isDirect) {
        if (sinceReply < AI_DIRECT_COOLDOWN) return { reply: false, reason: 'direct cooldown' };
        _aiLastReplyAt = now;
        return { reply: true, reason: 'direct mention' };
    }

    // ── Mute manual: block Tier 2 & Tier 3 ────────────────────────────────
    // Direct mention di atas sudah lolos. Sisanya (pertanyaan + random) di-skip.
    if (isMuted) {
        const remaining = Math.ceil((muteUntil - now) / 1000);
        return { reply: false, reason: `ai muted (${remaining}s left)` };
    }

    // ── Tier 2: Pertanyaan eksplisit ─────────────────────────────────────
    // Lebih ketat: harus ada '?' ATAU diawali kata tanya (bukan di tengah kalimat).
    // Mid-sentence "apa" / "kenapa" sering false positive ("iya apa", "ya kenapa engga").
    const questionStarters = ['apa', 'siapa', 'gimana', 'bagaimana', 'kenapa',
                               'mengapa', 'kapan', 'dimana', 'berapa', 'what', 'how',
                               'why', 'when', 'where', 'who', 'which'];
    const isQuestion = lower.includes('?') ||
                       questionStarters.some(w => lower.startsWith(w + ' '));

    if (isQuestion) {
        // Skip kalau pertanyaan jelas ditujukan ke user lain
        if (isAddressedToOtherUser(text, participants)) {
            return { reply: false, reason: 'question addressed to other user' };
        }
        if (sinceReply < AI_QUESTION_COOLDOWN) return { reply: false, reason: 'question — cooldown' };
        _aiLastReplyAt = now;
        return { reply: true, reason: 'question detected' };
    }

    // ── Tier 3: Random nimbrung (5% chance, cooldown 90s) ────────────────
    if (sinceReply > AI_RANDOM_COOLDOWN && Math.random() < AI_RANDOM_CHANCE) {
        // Skip kalau pesan terlalu pendek (<= 5 kata)
        if (lower.split(/\s+/).length <= 5) return { reply: false, reason: 'too short for random' };
        // Skip kalau ditujukan ke user lain
        if (isAddressedToOtherUser(text, participants)) {
            return { reply: false, reason: 'random skip — addressed to other' };
        }
        // Skip kalau conversation antar user lagi rame
        if (hasActiveUserConversation(senderName)) {
            return { reply: false, reason: 'random skip — user conversation active' };
        }
        _aiLastReplyAt = now;
        return { reply: true, reason: 'random engagement' };
    }

    return { reply: false, reason: 'not relevant / cooldown' };
}

// ════════════════════════════════════════════════════════════════════════════
//  CHAT HANDLER
// ════════════════════════════════════════════════════════════════════════════
async function handleChatMessage(chatData) {

    if (!chatData?.text) return;

    // Normalisasi: trim leading/trailing whitespace.
    // Penting — keyboard mobile sering auto-insert spasi di depan, yang bikin
    // `text.startsWith('!')` gagal → command salah deteksi sebagai chat biasa
    // → kena cooldown / AI relevance gate → tidak direspons.
    chatData.text = String(chatData.text).trim();
    if (!chatData.text) return;

    // Resolve uid from name if missing, then hydrate name/role from cache
    if (!chatData.senderId && chatData.senderName && chatData.senderName !== 'Unknown') {
        chatData.senderId =
            participantsCache.get(chatData.senderName.toLowerCase()) ||
            [...participantsCache.entries()].find(([k]) => k.startsWith(chatData.senderName.toLowerCase()))?.[1] ||
            null;
    }
    // Always resolve clean name + role from participantDetails (overrides DOM noise)
    if (chatData.senderId) {
        chatData.senderName = nameOf(chatData.senderId);
        chatData.senderRole = roleOf(chatData.senderId);
    } else {
        chatData.senderName = chatData.senderName || 'Unknown';
        chatData.senderRole = chatData.senderRole || 'Member';
    }

    // Dedup
    const dedupKey = chatData.msgId ? `id:${chatData.msgId}` : `${chatData.senderName}::${chatData.text}`;
    if (msgSeenKeys.has(dedupKey)) return;
    msgSeenKeys.add(dedupKey);
    setTimeout(() => msgSeenKeys.delete(dedupKey), 30000);

    // Skip pesan bot sendiri (cek by UID dulu, fallback ke nama)
    if (botMyId && chatData.senderId === botMyId) return;
    const senderLower = (chatData.senderName || '').toLowerCase();
    if (BOT_OWN_NAMES.some(n => senderLower.includes(n.toLowerCase()))) return;

    // Anti-loop fingerprint
    const fp = normalizeMsg(chatData.text);
    if (sentMessages.has(fp)) { log('[Anti-loop] fingerprint match.', 'warn'); return; }

    // Anti-loop cooldown (non-command)
    const isCmd = chatData.text.startsWith('!');
    if (!isCmd && Date.now() - botLastSentAt < BOT_SEND_COOLDOWN) {
        log('[Anti-loop] cooldown active.', 'warn'); return;
    }

    // Track non-command chat untuk conversation awareness
    if (!isCmd) recordChat(chatData.senderName, chatData.text);

    const ctx = {
        botState, sendMessage, addToQueue, playNext, log, updateStatus, page,
        clearPendingSongRequests,
        speakTTS, isTTSBusy,
        sender: { name: chatData.senderName || 'Unknown', role: chatData.senderRole || 'Member', uid: chatData.senderId || null }
    };

    if (isCmd) {
        log(`[CMD] ${chatData.senderName} (${chatData.senderRole}) uid:${chatData.senderId} → ${chatData.text}`, 'cmd');
        await commandHandler(chatData.text, ctx);
        const cleanCmd = chatData.text.split(' ')[0].substring(1).toLowerCase();
        const isKnown  = commandHandler.CORE_COMMANDS?.includes(cleanCmd) ||
                         commandHandler.getPluginCommands?.()?.has(cleanCmd);
        if (!isKnown) {
            if (isAIProcessing) return;
            isAIProcessing = true;
            try {
                const reply = await askAI(chatData.text, chatData.senderName, botState);
                if (reply) await sendMessage(reply);
            } finally { isAIProcessing = false; }
        }
    } else {
        // ── Smart AI relevance gate ───────────────────────────────────────────
        // AI hanya balas kalau benar-benar relevan, bukan semua pesan
        const shouldReply = checkAIRelevance(
            chatData.text,
            botState.botName,
            chatData.senderName,
            botState.participants || [],
            botState.aiMuteUntil || 0
        );
        if (!shouldReply.reply) {
            log(`[AI] Skip reply (${shouldReply.reason})`, 'info');
            return;
        }
        log(`[AI] Replying — reason: ${shouldReply.reason}`, 'info');

        if (isAIProcessing) { log('[AI mutex] busy.', 'warn'); return; }
        isAIProcessing = true;
        try {
            log(`[CHAT] ${chatData.senderName} (uid:${chatData.senderId}): ${chatData.text}`, 'info');
            const reply = await askAI(chatData.text, chatData.senderName, botState);
            if (reply) {
                const { cleanReply, command } = parseCommandFromAI(reply, chatData.text);

                if (cleanReply) await sendMessage(cleanReply);
                if (command) {
                    log(`[AI→CMD] ${command}`, 'cmd');
                    try { await commandHandler(command, ctx); } catch (_) {}
                }
            }
        } finally { isAIProcessing = false; }

    }
}

// ════════════════════════════════════════════════════════════════════════════
//  WEBSOCKET INTERCEPTOR  —  participant cache + optional chat
// ════════════════════════════════════════════════════════════════════════════
const CHAT_EVENT_NAMES = new Set([
    'message','chat','chat:message','chat:new','new:message',
    'room:message','newMessage','chatMessage','msg','send',
    'broadcast','text','userMessage','roomChat','public-message'
]);

function parseChatPayload(eventName, data) {
    if (!CHAT_EVENT_NAMES.has(eventName) || !data || typeof data !== 'object') return null;
    const text = (data.message ?? data.text ?? data.content ?? data.msg ?? data.body ?? '').toString().trim();
    if (!text) return null;
    const userObj    = data.user ?? data.sender ?? data.from ?? data.author ?? {};
    const senderName = (userObj.name ?? userObj.username ?? userObj.displayName ?? data.username ?? '').trim() || 'Unknown';
    const senderId   = userObj.id ?? userObj._id ?? userObj.uid ?? data.userId ?? null;
    return { text, senderName, senderId, senderRole: userObj.role ?? data.role ?? 'Member', msgId: data.id ?? null };
}

function setupWSInterceptor() {
    page.on('websocket', ws => {
        if (!ws.url().includes('ws.free4talk.com')) return;
        ws.on('framereceived', ({ payload }) => {
            try {
                const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
                if (!raw.startsWith('42')) return;
                let jsonPart = raw.slice(2);
                if (jsonPart.startsWith('/')) {
                    const idx = jsonPart.indexOf(',[');
                    if (idx === -1) return;
                    jsonPart = jsonPart.slice(idx + 1);
                }
                let arr; try { arr = JSON.parse(jsonPart); } catch { return; }
                if (!Array.isArray(arr) || arr.length < 2) return;
                const [evName, evData] = arr;

                // Participants event
                if (evName.includes(':participants') && evData?.participantMap) {
                    // Konfirmasi bot sudah beneran di dalam room
                    if (_resolveWsReady) { _resolveWsReady(); _resolveWsReady = null; }
                    const keepBot    = participantDetails.get(botMyId);
                    const oldRoles   = new Map([...participantDetails.entries()].map(([uid, d]) => [uid, d.role]));  // preserve roles
                    participantDetails.clear();
                    if (keepBot) participantDetails.set(botMyId, keepBot);
                    for (const p of Object.values(evData.participantMap)) {
                        if (!p.name || !p.id) continue;
                        participantsCache.set(p.name.toLowerCase(), p.id);
                        const rawRole  = p.role || p.level || p.privilege || (p.power != null && p.power > 0 ? 'moderator' : '') || '';
                        const wsRole   = resolveRole(rawRole);
                        const prevRole = oldRoles.get(p.id) || '';
                        // Preserve elevated roles — don't reset Owner/Mod set by owner:command or DOM
                        const finalRole = (prevRole && prevRole !== 'Member') ? prevRole : wsRole;
                        participantDetails.set(p.id, { name: p.name, role: finalRole });
                    }
                    applyStaticRoles();
                    if (typeof commandHandler.updateUserMap === 'function')
                        commandHandler.updateUserMap(participantsCache);
                    if (!botJwk && evData.myself?.jwkKeyPair?.d && evData.myself?.id) {
                        botJwk  = evData.myself.jwkKeyPair;
                        botMyId = evData.myself.id;
                        log(`[IDENTITY] JWK from WS ✓ uid=${botMyId}`, 'success');
                    }
                }

                // ── Owner transfer: room:[id]:owner:command type:"warning" = transfer, type:"danger" = kick
                if (evName.includes(':owner:command') && evData?.system?.client?.id) {
                    const evType  = evData.system.type || '';
                    const newId   = evData.system.client.id;
                    const newName = evData.system.client.name || nameOf(newId);
                    participantsCache.set(newName.toLowerCase(), newId);
                    if (evType === 'warning') {  // ownership transfer
                        for (const [uid, d] of participantDetails.entries()) {
                            if (d.role === 'Owner') participantDetails.set(uid, { ...d, role: 'Member' });
                        }
                        const ex = participantDetails.get(newId) || { name: newName };
                        participantDetails.set(newId, { ...ex, name: newName, role: 'Owner' });
                        updateParticipants();
                        log(`[OWNER-TRANSFER] → ${newName} (${newId})`, 'success');
                    } else if (evType === 'danger') {
                        log(`[KICK] ${newName} (${newId}) was kicked`, 'warn');
                    }
                }

                // ── modMap roles dari room:settings ───────────────────────────
                if (evName.includes(':settings') && evData?.modMap) {
                    for (const [uid, info] of Object.entries(evData.modMap)) {
                        if (!info?.role) continue;
                        const role = resolveRole(info.role);
                        if (role !== 'Member') {
                            const ex2 = participantDetails.get(uid) || { name: nameOf(uid) };
                            participantDetails.set(uid, { ...ex2, role });
                        }
                    }
                    updateParticipants();
                }

                // WS-based chat (fallback path)
                const chatData = parseChatPayload(evName, evData);
                if (chatData) handleChatMessage(chatData);

                // Detect owner dari creatorId/ownerId field
                if (evData && typeof evData === 'object') {
                    const data = evData?.data || evData?.room || evData?.myself?.settings || evData;
                    const creatorId = data?.creatorId || data?.ownerId || data?.creator?.id || data?.owner?.id;
                    if (creatorId && typeof creatorId === 'string') {
                        const existing = participantDetails.get(creatorId) || { name: nameOf(creatorId) };
                        if (existing.role !== 'Owner') {
                            participantDetails.set(creatorId, { ...existing, role: 'Owner' });
                            log(`[ROOM] Owner from WS uid=${creatorId} (${existing.name})`, 'success');
                        }
                    }
                    if (!evName.includes('transporter') && !evName.includes('signaling')) {
                    // (verbose WS log dihapus untuk performa)
                    }
                }
            } catch (_) {}
        });
        ws.on('close', () => log(`[WS] Closed → ${ws.url()}`, 'warn'));
    });
    log('[WS] Participant cache listener active.', 'info');
}

// ── Leave detection: cari nama di page text (tile-only pattern) ───────────────
async function scanRoomParticipants() {
    if (!page || botState.status !== 'ONLINE') return;
    if (participantDetails.size === 0) return;
    try {
        const pageText = await page.evaluate(() => (document.body?.innerText || '').toLowerCase());
        if (!pageText || pageText.length < 10) return;

        let changed = false;
        for (const [uid, d] of participantDetails.entries()) {
            if (uid === botMyId) continue;
            const name = (d.name || '').toLowerCase();
            // Cari pola yang HANYA muncul di video tile F4T, bukan di chat history
            const inTile = pageText.includes(`select ${name}`) || pageText.includes(`${name} settings`);
            if (!inTile) {
                participantDetails.delete(uid);
                log(`[LEAVE] ${d.name} keluar dari room`, 'warn');
                changed = true;
            }
        }
        if (changed) applyStaticRoles();
    } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════════
//  MUSIC FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════
// ── Mic toggle helpers ───────────────────────────────────────────────────────
async function unmuteMic() {
    if (!page) return;
    log('[MIC] Mencoba unmute...', 'info');
    try {
        await page.bringToFront();
        // Cari button dengan text "Turn ON your microphone" (state: muted)
        const clicked = await page.evaluate(() => {
            const blinds = [...document.querySelectorAll('div.blind, .blind')];
            const target = blinds.find(el =>
                el.textContent.trim().toLowerCase().includes('turn on your microphone')
            );
            if (target) {
                // Klik ancestor button
                let btn = target;
                while (btn && btn.tagName !== 'BUTTON') btn = btn.parentElement;
                if (btn) { btn.click(); return true; }
            }
            return false;
        });
        if (clicked) {
            log('[MIC] ✅ Unmuted (klik "Turn ON your microphone")', 'success');
        } else {
            log('[MIC] Button mic tidak ditemukan di DOM.', 'warn');
        }
    } catch (e) {
        log(`[MIC] unmuteMic error: ${e.message}`, 'warn');
    }
}

async function muteMic() {
    if (!page) return;
    log('[MIC] Mencoba mute...', 'info');
    try {
        await page.bringToFront();
        // Cari button dengan text "Turn OFF your microphone" (state: unmuted)
        const clicked = await page.evaluate(() => {
            const blinds = [...document.querySelectorAll('div.blind, .blind')];
            const target = blinds.find(el =>
                el.textContent.trim().toLowerCase().includes('turn off your microphone')
            );
            if (target) {
                let btn = target;
                while (btn && btn.tagName !== 'BUTTON') btn = btn.parentElement;
                if (btn) { btn.click(); return true; }
            }
            return false;
        });
        if (clicked) {
            log('[MIC] ✅ Muted (klik "Turn OFF your microphone")', 'success');
        } else {
            log('[MIC] Button mic aktif tidak ditemukan di DOM.', 'warn');
        }
    } catch (e) {
        log(`[MIC] muteMic error: ${e.message}`, 'warn');
    }
}

// ── TTS: server-side wrapper ─────────────────────────────────────────────────
// Generate audio TTS, encode base64, push ke browser supaya diputar lewat
// virtual mic pipeline (window._micDest). Auto-handle mic state (unmute saat
// ngomong, mute lagi setelah selesai kalau sebelumnya muted).
let _ttsBusy = false;
async function speakTTS(text, opts = {}) {
    if (!page) throw new Error('Bot belum aktif (no page)');
    if (_ttsBusy) throw new Error('TTS sedang ngomong, tunggu selesai');

    _ttsBusy = true;
    let micWasMuted = false;
    try {
        log(`[TTS] Generating: "${String(text).slice(0, 60)}${text.length > 60 ? '...' : ''}"`, 'info');
        const buf = await generateTTS(text, opts);
        const b64 = buf.toString('base64');
        log(`[TTS] Buffer ${(buf.length / 1024).toFixed(1)}KB ready, broadcasting...`, 'info');

        // Cek apakah mic muted (cari tombol "Turn ON your microphone")
        micWasMuted = await page.evaluate(() => {
            const blinds = [...document.querySelectorAll('div.blind, .blind')];
            return blinds.some(el => el.textContent.trim().toLowerCase().includes('turn on your microphone'));
        }).catch(() => false);

        if (micWasMuted) {
            log('[TTS] Mic muted — auto-unmuting...', 'info');
            await unmuteMic();
            await new Promise(r => setTimeout(r, 400));  // beri waktu state settle
        }

        // Putar TTS via pipeline; resolve saat audio.onended.
        await page.evaluate(b => window._speakInPipeline(b), b64);
        log('[TTS] ✅ Selesai ngomong', 'success');
    } finally {
        // Restore mic state
        if (micWasMuted) {
            await new Promise(r => setTimeout(r, 200));
            await muteMic().catch(() => {});
        }
        _ttsBusy = false;
    }
}

function isTTSBusy() { return _ttsBusy; }

// ── Music race-condition guards ───────────────────────────────────────────
let _streamToken  = 0;   // increment setiap startStream baru — cegah stale stream
let _isSearching  = false; // mutex: hanya 1 yts+yt-dlp boleh jalan bersamaan

let _pendingSongRequests = [];
let _songRequestGeneration = 0;

function clearPendingSongRequests() {
    _songRequestGeneration++;
    _pendingSongRequests = [];
}

async function stopAudio() {
    if (page) {
        await page.evaluate(() => {
            if (window._audioElement) {
                window._audioElement.pause();
                window._audioElement.src = '';
            }
        }).catch(() => {});
    }
}

async function playNext() {
    if (botState.isRepeating && botState.currentSong) return startStream(botState.currentSong);
    if (botState.queue.length > 0) {
        botState.currentSong = botState.queue.shift();
        await startStream(botState.currentSong);
    } else if (_isSearching || _pendingSongRequests.length > 0) {
        _streamToken++;
        botState.isPlaying   = false;
        botState.currentSong = null;
        await stopAudio();
        await muteMic();
        log('Queue kosong, menunggu request lagu yang masih diproses.', 'info');
        updateStatus();
    } else {
        _streamToken++;  // invalidate any in-flight fetch
        botState.isPlaying   = false;
        botState.currentSong = null;
        await stopAudio();
        await muteMic();
        log('Queue empty.', 'warn');
        updateStatus();
        await sendMessage('⏹ Playlist selesai.');
    }
}

async function startStream(song) {
    _streamToken++;
    const myToken = _streamToken;

    botState.isPlaying   = true;
    botState.currentSong = song;
    updateStatus();
    log(`Preparing stream: ${song.title} (Req: ${song.requestedBy})`, 'info');
    await sendMessage(`⏳ Menyiapkan stream: ${song.title}\n👤 Requested by: ${song.requestedBy}`);

    try {
        log(`[MUSIC] Fetching stream URL...`, 'info');
        const [streamUrl] = await Promise.all([
            getStreamUrl(song.url),
            unmuteMic()
        ]);

        // Token berubah = ada skip/stop/play baru → batalkan ini
        if (myToken !== _streamToken) {
            log(`[MUSIC] Stream token mismatch (${myToken}≠${_streamToken}) — discarding stale stream.`, 'warn');
            return;
        }

        await page.evaluate(async url => {
            if (!window._audioElement) throw new Error('_audioElement not initialized');

            const audio = window._audioElement;
            audio.pause();
            audio.src = '';
            audio.volume = window._botVolume || 0.1;

            await new Promise((resolve, reject) => {
                let settled = false;
                const cleanup = () => {
                    clearTimeout(timer);
                    audio.removeEventListener('playing', onPlaying);
                    audio.removeEventListener('error', onError);
                };
                const finishOk = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };
                const finishErr = (err) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(err);
                };
                const onPlaying = () => finishOk();
                const onError = () => finishErr(new Error('audio playback error'));
                const timer = setTimeout(() => finishErr(new Error('audio start timeout')), 15000);

                audio.addEventListener('playing', onPlaying, { once: true });
                audio.addEventListener('error', onError, { once: true });
                audio.src = url;

                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(err => finishErr(new Error(err?.message || 'audio play() failed')));
                }
            });
        }, streamUrl);
        log(`[MUSIC] Playback started.`, 'success');
        log(`Now Playing: ${song.title} (Req: ${song.requestedBy})`, 'success');
        await sendMessage(`🎶 Now Playing: ${song.title}\n👤 Requested by: ${song.requestedBy}`);
        preFetchNextSong();  // pre-fetch lagu berikutnya di background

    } catch (e) {
        if (myToken !== _streamToken) return; // already superseded
        const detail = e?.stderr || e?.message || e?.toString() || JSON.stringify(e);
        log(`Stream Error: ${detail}`, 'error');
        await sendMessage(`❌ Gagal memutar: ${song.title}`);
        playNext();
    }
}

async function processPendingSongRequests() {
    if (_isSearching) return;
    _isSearching = true;
    try {
        while (_pendingSongRequests.length > 0) {
            const request = _pendingSongRequests.shift();
            if (!request || request.generation !== _songRequestGeneration) continue;

            await sendMessage(`🔍 Mencari: "${request.query}"...`);
            log(`Searching: "${request.query}"...`, 'cmd');

            try {
                const search = await yts(request.query);
                if (request.generation !== _songRequestGeneration) continue;
                if (!search.videos.length) {
                    await sendMessage(`❌ Lagu tidak ditemukan: "${request.query}"`);
                    continue;
                }

                const song = {
                    title:       search.videos[0].title,
                    url:         search.videos[0].url,
                    duration:    search.videos[0].timestamp,
                    requestedBy: request.requesterName
                };

                if (request.generation !== _songRequestGeneration) continue;

                if (botState.isPlaying) {
                    botState.queue.push(song);
                    log(`Added to queue: ${song.title}`, 'success');
                    updateStatus();
                    await sendMessage(`📝 Ditambahkan ke antrean (#${botState.queue.length}): ${song.title}`);
                    if (botState.queue.length === 1) getStreamUrl(song.url).catch(() => {});
                } else {
                    await startStream(song);
                }
            } catch (e) {
                if (request.generation !== _songRequestGeneration) continue;
                log(`Search Error: ${e.message}`, 'error');
                await sendMessage('❌ Terjadi kesalahan saat mencari lagu.');
            }
        }
    } finally {
        _isSearching = false;
        if (_pendingSongRequests.length > 0) {
            processPendingSongRequests().catch(e => log(`Search Queue Error: ${e.message}`, 'error'));
        }
    }
}

async function addToQueue(query, requesterName = 'Unknown') {
    _pendingSongRequests.push({ query, requesterName, generation: _songRequestGeneration });

    if (_isSearching) {
        const waitCount = _pendingSongRequests.length;
        if (waitCount > 1) {
            await sendMessage(`📝 Permintaan diterima, masuk antrean proses (#${waitCount}): ${query}`);
        } else {
            await sendMessage(`📝 Permintaan diterima, menunggu proses lagu sebelumnya: ${query}`);
        }
    }

    await processPendingSongRequests();
}


// ════════════════════════════════════════════════════════════════════════════
//  START BOT
// ════════════════════════════════════════════════════════════════════════════
async function startBot(config) {
    if (botState.status === 'ONLINE') return;
    try {
        botState.botName = config.botName || 'Music Bot Pro';
        botState.status  = 'STARTING';
        updateStatus();

        // Gate: resolve saat WS :participants pertama — harus dibuat SEBELUM join room
        // supaya tidak miss event yang datang saat loading page
        const wsReadyGate = new Promise(resolve => { _resolveWsReady = resolve; });

        log('Launching browser...', 'info');

        const PROFILE_DIR = process.env.BOT_PROFILE_DIR               // per-user dari manager
                         || path.join(__dirname, 'profile')            // single-user fallback
                         || null;
        const useProfile  = PROFILE_DIR && fs.existsSync(PROFILE_DIR);

        const BROWSER_ARGS = [
            // Wajib: fake media stream untuk mic/audio
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-web-security',
            '--mute-audio',

            // ── Hemat RAM & CPU (aman untuk headless) ─────────────────────
            '--disable-gpu',                        // ~50-100MB savings
            '--disable-gpu-compositing',
            '--disable-software-rasterizer',
            '--disable-background-networking',      // stop background fetches
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',                   // no crash reporter
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-dev-shm-usage',              // cegah /dev/shm OOM di container
            '--disable-extensions',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-first-run',
            '--no-default-browser-check',
            '--safebrowsing-disable-auto-update',
            '--password-store=basic',
            '--use-mock-keychain',
            '--js-flags=--max-old-space-size=256',  // limit V8 heap per tab
        ];

        if (useProfile) {
            // ── Persistent Context (profile sudah ada → tidak perlu inject localStorage) ──
            log('[AUTH] Profile ditemukan — pakai persistent session (no inject needed).', 'success');
            context = await chromium.launchPersistentContext(PROFILE_DIR, {
                headless: true,
                args: BROWSER_ARGS,
                permissions: ['microphone', 'camera'],
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            });
            // launchPersistentContext tidak punya browser object terpisah
            browser = null;
        } else {
            // ── Regular Context (fallback: pakai localStorage inject) ────────────
            log('[AUTH] Tidak ada ./profile/ — pakai localStorage inject.', 'info');
            browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
            context = await browser.newContext({
                permissions: ['microphone', 'camera'],
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });
        }


        // ── InitScript 1: Audio pipeline + EQ ────────────────────────────────
        await context.addInitScript(() => {
            window._audioCtx     = new (window.AudioContext || window.webkitAudioContext)();
            window._audioElement = document.createElement('audio');
            window._audioElement.crossOrigin = 'anonymous';
            window._audioElement.autoplay    = true;
            window._audioElement.volume      = 0.1;  // default 10%

            const source = window._audioCtx.createMediaElementSource(window._audioElement);
            const dest   = window._audioCtx.createMediaStreamDestination();

            window._bassFilter = window._audioCtx.createBiquadFilter();
            window._bassFilter.type = 'lowshelf'; window._bassFilter.frequency.value = 200; window._bassFilter.gain.value = 0;
            window._trebleFilter = window._audioCtx.createBiquadFilter();
            window._trebleFilter.type = 'highshelf'; window._trebleFilter.frequency.value = 3500; window._trebleFilter.gain.value = 0;
            window._pannerNode = window._audioCtx.createStereoPanner(); window._pannerNode.pan.value = 0;
            window._convolverNode = window._audioCtx.createConvolver();
            window._reverbGain = window._audioCtx.createGain(); window._reverbGain.gain.value = 0;
            window._dryGain    = window._audioCtx.createGain(); window._dryGain.gain.value = 1.0;

            (function buildImpulse(dur, dec) {
                const sr  = window._audioCtx.sampleRate;
                const buf = window._audioCtx.createBuffer(2, sr * dur, sr);
                for (let c = 0; c < 2; c++) {
                    const d = buf.getChannelData(c);
                    for (let i = 0; i < d.length; i++)
                        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, dec);
                }
                window._convolverNode.buffer = buf;
            })(3, 5);

            source.connect(window._bassFilter);
            window._bassFilter.connect(window._trebleFilter);
            window._trebleFilter.connect(window._pannerNode);
            window._pannerNode.connect(window._dryGain);
            window._pannerNode.connect(window._convolverNode);
            window._convolverNode.connect(window._reverbGain);
            window._dryGain.connect(dest);
            window._reverbGain.connect(dest);

            window._effects    = { speed: 1.0, bass: 0, treble: 0, reverb: false, is8d: false };
            window._8dInterval = null;
            window._musicStream = dest.stream;
            window._micDest     = dest;

            navigator.mediaDevices.getUserMedia = async (constraints) => {
                if (constraints.audio) return window._musicStream;
                return null;
            };
            setInterval(() => { if (window._audioCtx.state === 'suspended') window._audioCtx.resume(); }, 1000);
            window._audioElement.onended = () => window.onSongEnded();

            // ── TTS pipeline ─────────────────────────────────────────────────
            // Audio TTS di-route langsung ke _micDest (bypass EQ supaya suara clear).
            // Tracking _ttsActive supaya tidak overlap multiple TTS bersamaan.
            window._ttsActive = false;
            window._speakInPipeline = function (b64Mp3) {
                return new Promise((resolve, reject) => {
                    if (window._ttsActive) {
                        return reject(new Error('TTS already speaking'));
                    }
                    try {
                        const audio = new Audio('data:audio/mp3;base64,' + b64Mp3);
                        audio.crossOrigin = 'anonymous';
                        audio.volume      = 1.0;

                        const src = window._audioCtx.createMediaElementSource(audio);
                        src.connect(window._micDest);  // langsung ke virtual mic, bypass EQ

                        window._ttsActive = true;
                        let finished = false;
                        const cleanup = (err) => {
                            if (finished) return;
                            finished = true;
                            window._ttsActive = false;
                            try { src.disconnect(); } catch (_) {}
                            try { audio.pause(); audio.src = ''; } catch (_) {}
                            err ? reject(err) : resolve();
                        };

                        audio.onended = () => cleanup(null);
                        audio.onerror = (e) => cleanup(new Error('TTS audio decode/play error'));

                        // Safety timeout: max 30 detik per ucapan
                        setTimeout(() => cleanup(new Error('TTS timeout (30s)')), 30000);

                        audio.play().catch(err => cleanup(err));
                    } catch (e) {
                        window._ttsActive = false;
                        reject(e);
                    }
                });
            };
        });

        // ── InitScript 2: API intercept + Transporter capture ─────────────────
        await context.addInitScript(() => {
            // Capture transporter instance via ODP hook (sebelum F4T JS jalan)
            const __origODP = Object.defineProperty;
            Object.defineProperty = function (target, prop, desc) {
                if (prop === 'sendToDataChannel' && typeof desc?.value === 'function') {
                    const orig = desc.value;
                    desc = Object.assign({}, desc, {
                        value: function () {
                            if (!window.__f4tTransporter) window.__f4tTransporter = this;
                            return orig.apply(this, arguments);
                        }
                    });
                }
                return __origODP.apply(this, arguments);
            };

            // Helper → Node.js
            function send(type, url, body) {
                try { window.__f4tApi && window.__f4tApi(type, url, String(body).substring(0, 500)); } catch (_) {}
            }

            // Patch fetch
            const _fetch = window.fetch;
            window.fetch = async function (input, init) {
                const url  = typeof input === 'string' ? input : input?.url || '';
                const resp = await _fetch(input, init);
                if (url.includes('free4talk') && !url.match(/\.(js|css|png|woff|ico)/)) {
                    try {
                        resp.clone().text().then(body => {
                            if (body && body.length > 2 && body.length < 8000)
                                send('fetch', url, body);
                        }).catch(() => {});
                    } catch (_) {}
                }
                return resp;
            };

            // Patch XHR
            const _XHROpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this.__f4t_url = url;
                return _XHROpen.call(this, method, url, ...rest);
            };
            const _XHRSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function (...args) {
                const url = this.__f4t_url || '';
                if (url.includes('free4talk') && !url.match(/\.(js|css|png|woff|ico)/)) {
                    this.addEventListener('load', () => {
                        const body = this.responseText;
                        if (body && body.length > 2 && body.length < 8000) send('xhr', url, body);
                    });
                }
                return _XHRSend.apply(this, args);
            };

            // Patch WebSocket — parse participants IN browser (full message), send compact data
            const _WS = window.WebSocket;
            window.WebSocket = function (url, ...rest) {
                const ws = new _WS(url, ...rest);
                if (url && url.includes('free4talk')) {
                    ws.addEventListener('message', e => {
                        if (typeof e.data !== 'string') return;
                        const raw = e.data;
                        // Parse participants event IN browser (no truncation)
                        if (raw.startsWith('42') && raw.includes(':participants')) {
                            try {
                                const arr = JSON.parse(raw.slice(2));
                                if (Array.isArray(arr) && arr.length >= 2) {
                                    const [evName, evData] = arr;
                                    if (evName.includes(':participants') && evData?.participantMap) {
                                        const compact = Object.values(evData.participantMap)
                                            .filter(p => p.id && p.name)
                                            .map(p => ({ id: p.id, name: p.name }));
                                        if (compact.length > 0 && window.__f4tParticipants) {
                                            window.__f4tParticipants(compact);
                                        }
                                    }
                                }
                            } catch (_) {}
                        }
                        // Send raw for non-transporter events (logging only, may be truncated)
                        if (!raw.includes(':transporter:') && !raw.includes('signaling:audio')) {
                            send('ws', url, raw);
                        }
                    });
                    if (url.includes('socket-io')) window.__f4tWsRef = ws;
                }
                return ws;
            };
            Object.assign(window.WebSocket, _WS);
            window.WebSocket.prototype = _WS.prototype;
        });

        // ── InitScript 3: WebRTC DataChannel + Audio Track hook ───────────────
        await context.addInitScript(() => {
            const _RTC = window.RTCPeerConnection;
            if (!_RTC) return;
            function hookChannel(ch) {
                ch.addEventListener('message', e => {
                    try {
                        const s = typeof e.data === 'string' ? e.data : null;
                        if (!s) return;
                        if (!s.includes('ack%3Achat%3Amessage') && !s.includes('ack:chat:message')) return;
                        window.__f4tDC && window.__f4tDC(s);
                    } catch (_) {}
                });
            }

            // ── Voice listen state — default aktif ────────────────────────────
            window._voiceListenActive = true;
            window._voicePeers = new Map();   // trackId → peer entry

            // ── VAD + MediaRecorder per audio track (peer ngomong) ────────────
            function hookAudioTrack(track, stream) {
                if (track.kind !== 'audio') return;
                if (!window._audioCtx) return;
                if (window._voicePeers.has(track.id)) return;

                let source, analyser;
                try {
                    source   = window._audioCtx.createMediaStreamSource(stream);
                    analyser = window._audioCtx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.3;
                    source.connect(analyser);
                    // analyser TIDAK connect ke destination — cuma untuk hitung
                    // energy. Audio peer tidak di-render ke speaker.
                } catch (_) {
                    return;
                }

                const VAD_THRESHOLD = 12;     // RMS energy threshold (0-128 scale)
                const SILENCE_MS    = 1200;   // diam sekian → utterance dianggap selesai
                const MAX_DURATION  = 15000;  // max utterance 15 detik
                const MIN_DURATION  = 500;    // utterance < 500ms = noise, di-skip

                const dataBuf = new Uint8Array(analyser.frequencyBinCount);
                let recorder = null;
                let chunks = [];
                let isSpeaking = false;
                let silenceStartedAt = 0;
                let recordStartedAt = 0;
                let stopped = false;

                window._voicePeers.set(track.id, { track, stream, source, analyser });
                // Notifikasi Node: track baru masuk (untuk participant name mapping)
                if (window.__onTrackJoined) {
                    try { window.__onTrackJoined({ trackId: track.id, joinedAt: Date.now() }); } catch (_) {}
                }

                function startRecord() {
                    if (recorder) return;
                    if (!window._voiceListenActive) return;
                    if (window._ttsActive) return;  // bot sedang ngomong → skip
                    try {
                        recorder = new MediaRecorder(stream, {
                            mimeType: 'audio/webm; codecs=opus',
                            audioBitsPerSecond: 32000,
                        });
                        chunks = [];
                        recorder.ondataavailable = e => {
                            if (e.data && e.data.size > 0) chunks.push(e.data);
                        };
                        recorder.onstop = async () => {
                            const duration = Date.now() - recordStartedAt;
                            recorder = null;
                            if (duration < MIN_DURATION) return;
                            if (!chunks.length) return;
                            try {
                                const blob = new Blob(chunks, { type: 'audio/webm; codecs=opus' });
                                const ab   = await blob.arrayBuffer();
                                const u8   = new Uint8Array(ab);
                                let bin = '';
                                const CHUNK = 0x8000;
                                for (let i = 0; i < u8.length; i += CHUNK) {
                                    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
                                }
                                const b64 = btoa(bin);
                                if (window.__onPeerUtterance) {
                                    window.__onPeerUtterance({
                                        trackId: track.id,
                                        durationMs: duration,
                                        mime: 'audio/webm',
                                        audioB64: b64,
                                    });
                                }
                            } catch (_) {}
                        };
                        recorder.start();
                        recordStartedAt = Date.now();
                    } catch (_) {
                        recorder = null;
                    }
                }

                function stopRecord() {
                    if (recorder && recorder.state === 'recording') {
                        try { recorder.stop(); } catch (_) {}
                    }
                }

                function vadLoop() {
                    if (stopped) return;
                    if (!window._voicePeers.has(track.id)) return;
                    try {
                        analyser.getByteTimeDomainData(dataBuf);
                        let sum = 0;
                        for (let i = 0; i < dataBuf.length; i++) {
                            const v = dataBuf[i] - 128;
                            sum += v * v;
                        }
                        const rms = Math.sqrt(sum / dataBuf.length);
                        const speaking = rms > VAD_THRESHOLD;
                        const now = Date.now();

                        if (speaking) {
                            silenceStartedAt = 0;
                            if (!isSpeaking) {
                                isSpeaking = true;
                                startRecord();
                            }
                        } else if (isSpeaking) {
                            if (!silenceStartedAt) silenceStartedAt = now;
                            if (now - silenceStartedAt >= SILENCE_MS) {
                                isSpeaking = false;
                                silenceStartedAt = 0;
                                stopRecord();
                            }
                        }

                        // Force-stop kalau utterance kelewat panjang
                        if (recorder && recordStartedAt && now - recordStartedAt >= MAX_DURATION) {
                            stopRecord();
                            isSpeaking = false;
                            silenceStartedAt = 0;
                        }
                    } catch (_) {}
                    setTimeout(vadLoop, 50);
                }
                vadLoop();

                track.addEventListener('ended', () => {
                    stopped = true;
                    stopRecord();
                    window._voicePeers.delete(track.id);
                    try { source.disconnect(); } catch (_) {}
                    try { analyser.disconnect(); } catch (_) {}
                });
            }

            function PatchedRTC(...args) {
                const pc = new _RTC(...args);
                pc.addEventListener('datachannel', e => hookChannel(e.channel));
                const origCreate = pc.createDataChannel.bind(pc);
                pc.createDataChannel = function (label, opts) {
                    const ch = origCreate(label, opts);
                    hookChannel(ch);
                    return ch;
                };
                // Hook incoming audio tracks (suara user lain di voice room)
                pc.addEventListener('track', e => {
                    try {
                        if (e.track && e.track.kind === 'audio' && e.streams && e.streams[0]) {
                            hookAudioTrack(e.track, e.streams[0]);
                        }
                    } catch (_) {}
                });
                return pc;
            }
            PatchedRTC.prototype = _RTC.prototype;
            ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(k => PatchedRTC[k] = _RTC[k]);
            Object.setPrototypeOf(PatchedRTC, _RTC);
            window.RTCPeerConnection = PatchedRTC;
        });

        page = await context.newPage();

        // ── Expose functions ───────────────────────────────────────────────────
        await page.exposeFunction('onSongEnded', () => { log('Song ended.', 'info'); playNext(); });

        await page.exposeFunction('__f4tApi', (_type, _url, _body) => {
            // Logging dimatikan untuk performa — parsing tetap lewat setupWSInterceptor
        });

        // ── Voice conversation: terima utterance dari peer ───────────────────
        await page.exposeFunction('__onPeerUtterance', async (payload) => {
            try {
                // Resolve nama participant dari trackId (track-participant mapping)
                const knownName = _trackParticipantNames.get(payload && payload.trackId ? payload.trackId : '');

                await handlePeerUtterance(payload, {
                    botName:    botState.botName,
                    log,
                    sendMessage,
                    speakTTS,
                    isTTSBusy,
                    botState,
                    senderName: knownName || null,   // nama user yang ngomong (kalau diketahui)
                    executeCommand: async (cmd, requesterName) => {
                        const voiceCtx = {
                            botState, sendMessage, addToQueue, playNext, log, updateStatus, page,
                            clearPendingSongRequests, speakTTS, isTTSBusy,
                            sender: {
                                name: requesterName || knownName || 'VoiceUser',
                                role: 'Member',
                                uid:  null,
                            }
                        };
                        await commandHandler(cmd, voiceCtx);
                    }
                });
            } catch (e) {
                log(`[VOICE] handlePeerUtterance error: ${e.message}`, 'error');
            }
        });

        // ── Voice: track join notification dari browser ──────────────────────
        // Browser mengirim { trackId, joinedAt } saat peer track baru terdeteksi.
        // Server korelasikan trackId ke participant yang baru join dalam 3s window.
        await page.exposeFunction('__onTrackJoined', (info) => {
            if (!info || !info.trackId) return;
            // Cari participant yang join paling baru (dalam 3s) → assign ke track ini
            // Heuristik: participant terakhir di list yang belum punya track mapping
            const now = Date.now();
            const candidates = [...participantDetails.entries()]
                .filter(([uid]) => uid !== botMyId)
                .map(([uid, d]) => ({ uid, name: d.name }));
            // Cari participant yang belum punya trackId assignment
            const taken = new Set(_trackParticipantNames.values());
            const unassigned = candidates.find(p => !taken.has(p.name));
            if (unassigned) {
                _trackParticipantNames.set(info.trackId, unassigned.name);
                log("[VOICE] Track " + info.trackId.slice(-6) + " -> " + unassigned.name, 'info');
            }
        });

        // ── __f4tParticipants: compact data dari browser (no CDP truncation) ──────
        await page.exposeFunction('__f4tParticipants', (compact) => {
            if (!Array.isArray(compact) || compact.length === 0) return;
            const keepBot  = participantDetails.get(botMyId);
            const oldRoles = new Map([...participantDetails.entries()].map(([uid, d]) => [uid, d.role]));
            participantDetails.clear();
            if (keepBot) participantDetails.set(botMyId, keepBot);
            for (const p of compact) {
                if (!p.id || !p.name) continue;
                participantsCache.set(p.name.toLowerCase(), p.id);
                const prevRole = oldRoles.get(p.id) || '';
                // Preserve elevated roles from OWNER-TRANSFER or DOM scan
                const role = (prevRole && prevRole !== 'Member') ? prevRole : 'Member';
                participantDetails.set(p.id, { name: p.name, role });
            }
            applyStaticRoles();
            log(`[PARTICIPANTS] ${compact.map(p => p.name).join(', ')} (${compact.length} users)`, 'info');
            // Jadwalkan re-scan Owner badge setelah DOM render (3.5s)
            // Ini fix-nya jika owner keluar lalu masuk lagi: badge re-appear di DOM
            if (_scanDomForOwner) setTimeout(_scanDomForOwner, 3500);
        });


        await page.exposeFunction('__f4tDC', async rawData => {
            try {
                const parts  = rawData.split('%7C');
                if (parts.length < 2) return;
                let jsonStr;
                try { jsonStr = decodeURIComponent(parts[1]); } catch { jsonStr = parts[1]; }
                const obj  = JSON.parse(jsonStr);
                const pkt  = obj?.packet;
                if (!pkt || pkt.event !== 'ack:chat:message') return;
                const data = pkt.data;
                if (!data) return;

                log(`[DC:CHAT] ${JSON.stringify(data).substring(0, 400)}`, 'info');

                const msgId    = data.id || '';
                const idParts  = msgId.split(':');
                const senderId = idParts[1] || null;

                // Use participantDetails (uid → {name, role}) — clean, no DOM noise
                const senderName = nameOf(senderId);
                const senderRole = roleOf(senderId);
                const text = data.texts?.[0]?.msg || data.text || data.msg || data.body;
                if (!text) return;

                await handleChatMessage({
                    text: String(text).trim(), senderName, senderId, senderRole, msgId
                });
            } catch (_) {}
        });

        // ── Intercept identity endpoint untuk JWK (full body, no truncation) ──
        await page.route('**/identity/get/me/**', async route => {
            const response = await route.fetch();
            try {
                const json    = await response.json();
                const session = json?.data?.session || json?.data;
                if (session?.jwkKeyPair?.d && session?.uid) {
                    botJwk  = session.jwkKeyPair;
                    botMyId = session.uid;
                    log(`[IDENTITY] JWK ready ✓ uid=${botMyId}`, 'success');
                }
            } catch (_) {}
            await route.fulfill({ response });
        });
        // ── Intercept identity/get/users → ONLY populate name cache (TIDAK tambah ke participantDetails)
        // F4T memanggil ini dengan friends-list, bukan harus room member!
        await page.route('**/identity/get/users/**', async route => {
            let response;
            try { response = await route.fetch(); } catch { return route.abort(); }
            try {
                const json  = await response.json();
                const users = json?.data;
                if (Array.isArray(users)) {
                    for (const u of users) {
                        if (!u.id || !u.name) continue;
                        participantsCache.set(u.name.toLowerCase(), u.id);  // name → uid lookup only
                    }
                    log(`[IDENTITY:USERS] Cached ${users.length} user names`, 'info');
                }
            } catch (_) {}
            await route.fulfill({ response });
        });

        // ── WS interceptor (participant cache) ────────────────────────────────
        setupWSInterceptor();

        // ── Auth injection (skip jika pakai persistent profile) ───────────────
        if (useProfile) {
            log('[AUTH] Pakai persistent profile — skip localStorage inject.', 'info');
            log(`Joining room: ${config.roomUrl}`, 'info');
            await page.goto(config.roomUrl, { waitUntil: 'networkidle' });
        } else {
            log('Setting up auth...', 'info');
            let authData;
            try { authData = typeof config.authData === 'string' ? JSON.parse(config.authData) : config.authData; }
            catch (e) { authData = config.authData; }
            const lsData = authData?.localStorage || authData || {};
            const lsKeys = Object.keys(lsData);

            if (lsKeys.length === 0) {
                log('[AUTH] Auth data kosong — bot akan join sebagai guest!', 'warn');
            } else {
                log(`[AUTH] ${lsKeys.length} keys siap diinjeksi.`, 'info');
            }

            // Step 1: Buka halaman kosong dulu
            await page.goto('about:blank');

            // Step 2: Inject localStorage ke domain F4T via CDP storage API
            // (inject via evaluate di about:blank tidak work — perlu origin yang benar)
            // Navigasi ke root dengan domcontentloaded, lalu LANGSUNG inject sebelum
            // JS F4T sempat berjalan penuh, lalu reload agar F4T boot dengan token kita.
            await page.goto('https://www.free4talk.com/', { waitUntil: 'domcontentloaded' });

            // Inject segera setelah DOM ready (sebelum React selesai init)
            if (lsKeys.length > 0) {
                await page.evaluate(s => {
                    Object.keys(s).forEach(k => {
                        try { localStorage.setItem(k, s[k]); } catch (_) {}
                    });
                }, lsData);
                log('[AUTH] localStorage injected — reloading page so F4T boots with token...', 'info');

                // Step 3: RELOAD agar F4T baca localStorage kita dari awal
                await page.reload({ waitUntil: 'networkidle' });
            }

            // Step 4: Verifikasi
            const tokenInPage = await page.evaluate(() => localStorage.getItem('user:token'));
            if (tokenInPage) {
                try {
                    const parsed   = JSON.parse(tokenInPage);
                    const jwt      = parsed.data || tokenInPage;
                    const payload  = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
                    const expMs    = payload.exp * 1000;
                    const minsLeft = Math.floor((expMs - Date.now()) / 60000);
                    if (Date.now() > expMs) {
                        log(`[AUTH] user:token EXPIRED ${Math.abs(minsLeft)} menit lalu!`, 'warn');
                    } else {
                        log(`[AUTH] ✅ Verified — token valid ${minsLeft} menit lagi (${payload.name || payload.id}).`, 'success');
                    }
                } catch (_) {
                    log('[AUTH] user:token terdeteksi. Lanjut.', 'success');
                }
            } else {
                log('[AUTH] ❌ user:token TIDAK ditemukan setelah inject+reload!', 'warn');
            }

            log(`Joining room: ${config.roomUrl}`, 'info');
            await page.goto(config.roomUrl, { waitUntil: 'networkidle' });
        }




        // ── Dismiss "Click on anywhere to start" interstitial ────────────────
        // Multi-strategy: DOM text → CSS locator → fallback body click
        // Setiap strategi diverifikasi apakah overlay benar-benar hilang.
        await page.bringToFront();
        try {
            log('[JOIN] Waiting for interstitial to appear in DOM...', 'info');

            // Strategi 1: tunggu text "click on anywhere" atau "click anywhere" muncul di DOM
            const appeared = await page.waitForFunction(
                () => {
                    const txt = document.body.innerText.toLowerCase();
                    return txt.includes('click on anywhere') || txt.includes('click anywhere') ||
                           txt.includes('to start') || txt.includes('untuk memulai');
                },
                { timeout: 12000 }
            ).then(() => true).catch(() => false);

            if (appeared) {
                log('[JOIN] Interstitial detected — attempting dismiss...', 'info');
            } else {
                log('[JOIN] Interstitial text not found — sending gesture click anyway.', 'info');
            }

            // Ambil dimensi halaman untuk klik adaptif
            const vp = page.viewportSize() || { width: 1280, height: 720 };
            const cx  = Math.floor(vp.width  / 2);
            const cy  = Math.floor(vp.height / 2);

            // Helper: cek apakah overlay masih ada
            const isOverlayGone = () => page.evaluate(() => {
                const txt = document.body.innerText.toLowerCase();
                return !txt.includes('click on anywhere') && !txt.includes('click anywhere') && !txt.includes('to start');
            }).catch(() => true);

            // Retry loop — sampai 5x, posisi klik bervariasi
            const positions = [
                [cx, cy],
                [cx, cy - 80],
                [cx - 100, cy],
                [cx + 100, cy + 50],
                [cx, cy + 100],
            ];
            let dismissed = false;
            for (let i = 0; i < positions.length; i++) {
                const [x, y] = positions[i];
                // Real mouse click
                await page.mouse.move(x, y);
                await page.mouse.click(x, y);
                await page.waitForTimeout(600);
                // Backup: dispatchEvent click
                await page.evaluate(([px, py]) => {
                    document.elementFromPoint(px, py)?.click();
                }, [x, y]).catch(() => {});
                await page.waitForTimeout(400);

                if (await isOverlayGone()) {
                    dismissed = true;
                    log(`[JOIN] Interstitial dismissed at position (${x},${y}) after ${i+1} attempt(s).`, 'success');
                    break;
                }
            }

            if (!dismissed) {
                // Backup: Space / Enter keyboard press (trigger AudioContext gesture)
                log('[JOIN] Click attempts failed — trying keyboard gesture...', 'warn');
                await page.keyboard.press('Space');
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(500);
                if (await isOverlayGone()) {
                    log('[JOIN] Keyboard gesture worked.', 'success');
                } else {
                    log('[JOIN] Interstitial may still be present — continuing anyway.', 'warn');
                }
            }
        } catch (e) {
            log(`[JOIN] Interstitial handler error: ${e.message} — continuing.`, 'warn');
            await page.mouse.click(640, 360).catch(() => {});
        }
        await page.waitForTimeout(1000);








        // ── DOM role scanner — reads owner/moderator badges from participant tiles ──

        // Runs once after join; WS event may not carry role field
        await page.exposeFunction('__onRoleScan', (results) => {
            let changed = false;
            for (const { uid, role } of results) {
                if (!uid) continue;
                const existing = participantDetails.get(uid) || { name: nameOf(uid) };
                const resolved = resolveRole(role);
                if (resolved !== 'Member') {
                    participantDetails.set(uid, { ...existing, role: resolved });
                    log(`[ROLE] ${uid} (${existing.name}) → ${resolved}`, 'info');
                    changed = true;
                }
            }
            if (changed) updateParticipants();  // sync botState.participants
        });
        await page.evaluate(async () => {
            // Wait a moment for tiles to render
            await new Promise(r => setTimeout(r, 2000));
            const results = [];
            // F4T participant tiles: look for elements with uid attribute + role badge
            const UID_ATTRS  = ['data-uid', 'data-user-id', 'data-id', 'data-participant-id'];
            const ROLE_SELS  = ['[class*="owner"]', '[class*="Owner"]', '[class*="role"]',
                                '[class*="badge"]', '[class*="privilege"]', '[class*="moderator"]'];
            // Walk all elements that have a uid attribute
            for (const attr of UID_ATTRS) {
                document.querySelectorAll(`[${attr}]`).forEach(el => {
                    const uid = el.getAttribute(attr);
                    if (!uid) return;
                    for (const sel of ROLE_SELS) {
                        const badge = el.querySelector(sel) || (el.matches(sel) ? el : null);
                        if (!badge) continue;
                        const text = (badge.innerText || badge.textContent || '').trim().toLowerCase();
                        if (text && text !== '') {
                            results.push({ uid, role: text });
                            break;
                        }
                    }
                });
            }
            // Also scan participant video tiles by text label
            document.querySelectorAll('[class*="participant"], [class*="Participant"]').forEach(tile => {
                let uid = null;
                for (const attr of UID_ATTRS) { uid = tile.getAttribute(attr); if (uid) break; }
                if (!uid) return;
                for (const sel of ROLE_SELS) {
                    const badge = tile.querySelector(sel);
                    if (!badge) continue;
                    const text = (badge.innerText || '').trim().toLowerCase();
                    if (text) { results.push({ uid, role: text }); break; }
                }
            });
            if (results.length > 0 && window.__onRoleScan) window.__onRoleScan(results);
        });

        // ── MutationObserver — text-only DOM fallback (name/role from cache) ──
        await page.exposeFunction('__onDomChat', async data => {
            try { await handleChatMessage(data); } catch (_) {}
        });
        await page.evaluate(() => {
            let lastKey = '';
            const TEXT_SELS = [
                '[class*="message-content"]',
                '[class*="MessageContent"]',
                '[class*="messageContent"]',
                '[class*="chat"] p',
            ];
            function extractLatest() {
                let msgEl = null;
                for (const sel of TEXT_SELS) {
                    const all = document.querySelectorAll(sel);
                    if (all.length) { msgEl = all[all.length - 1]; break; }
                }
                if (!msgEl) return;
                const text = (msgEl.innerText || '').trim();
                if (!text) return;

                let el = msgEl;
                let senderId = null;
                for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
                    const uid = el.dataset?.uid || el.dataset?.userId || el.getAttribute('data-uid');
                    if (uid) { senderId = uid; break; }
                }

                const key = `${senderId || '?'}::${text}`;
                if (key === lastKey) return;
                lastKey = key;
                window.__onDomChat({ text, senderId, senderName: null, senderRole: null, msgId: null });
            }
            new MutationObserver(() => extractLatest()).observe(document.body, { childList: true, subtree: true });
            setInterval(extractLatest, 2000);
        });
        log('MutationObserver (text-only) aktif!', 'success');
        // Bot join dalam keadaan MUTED — mic hanya dibuka saat musik main
        log('[MIC] Bot join muted. Mic akan auto-open saat musik diputar.', 'info');

        botState.status = 'ONLINE';
        updateStatus();
        log('Bot is ONLINE and active!', 'success');
        log('Real-time WS chat listener is active.', 'success');

        // Set referensi untuk leaveRoom() (module-level)
        _sendMessage = sendMessage;

        // Scan berkala setiap 15s — simpan ID untuk bisa di-clear saat stop
        _domScanInterval = setInterval(async () => {
            if (!page) return;  // sudah offline, skip
            await scanRoomParticipants();
            if (_scanDomForOwner) await _scanDomForOwner();
        }, 15000);

        // ── AUTO-DETECT roles dari DOM (Owner / Co-owner / Mod) ──────────────────
        const scanDomForOwner = async () => {
            try {
                const result = await page.evaluate(() => {
                    // Badge text yang valid untuk peran room
                    const ROLE_TEXTS = new Set(['owner', 'co-owner', 'moderator', 'mod', 'admin']);
                    const all = [...document.querySelectorAll('*')];
                    const roleEls = all
                        .filter(el =>
                            el.children.length === 0 &&
                            ROLE_TEXTS.has(el.textContent.trim().toLowerCase())
                        )
                        .map(el => ({ el, roleText: el.textContent.trim().toLowerCase() }));
                    if (roleEls.length === 0) return { found: false, total: all.length };

                    // Helper: apakah element ini di dalam TILE (bukan chat message)?
                    // Tile F4T selalu punya "Select [Name]" atau "[Name] Settings" di container kecil
                    function isInsideTile(el) {
                        let parent = el.parentElement;
                        for (let i = 0; i < 8; i++) {
                            if (!parent) return false;
                            const txt = (parent.innerText || '').toLowerCase();
                            if (txt.length < 300 && (txt.includes(' settings') || txt.includes('select '))) return true;
                            parent = parent.parentElement;
                        }
                        return false;
                    }

                    const BLACKLIST = new Set([
                        'owner','co-owner','member','moderator','mod','admin',
                        'connected','connecting','disconnected','open','close',
                        'closed','pending','active','inactive','online','offline',
                        'muted','unmuted','speaking','loading','error','true','false'
                    ]);

                    const results = [];
                    for (const { el: roleEl, roleText } of roleEls) {
                        // SKIP jika bukan tile (kemungkinan dari chat history)
                        if (!isInsideTile(roleEl)) continue;

                        // Coba ambil uid dari data-attribute di ancestor
                        let el = roleEl;
                        let foundUid = false;
                        for (let i = 0; i < 12; i++) {
                            if (!el) break;
                            const uid = el.dataset?.uid || el.dataset?.id ||
                                        el.dataset?.participantId || el.getAttribute('data-uid');
                            if (uid) { results.push({ uid, roleText, source: 'data-attr' }); foundUid = true; break; }
                            el = el.parentElement;
                        }
                        if (foundUid) continue;

                        // Fallback: cari nama participant di container yang sama
                        let container = roleEl.parentElement;
                        for (let i = 0; i < 8; i++) {
                            if (!container) break;
                            const texts = [...container.querySelectorAll('*')]
                                .filter(e =>
                                    e !== roleEl &&
                                    e.children.length === 0 &&
                                    e.textContent.trim().length > 1 &&
                                    e.textContent.trim().length < 60 &&
                                    !BLACKLIST.has(e.textContent.trim().toLowerCase())
                                )
                                .map(e => e.textContent.trim());
                            if (texts.length > 0) {
                                results.push({ name: texts[0], allTexts: texts, roleText, source: 'name-scan' });
                                break;
                            }
                            container = container.parentElement;
                        }
                    }
                    return { found: results.length > 0, roleCount: roleEls.length, results };
                });

                if (!result.found) return;

                // Log singkat: hanya nama + role yang berubah
                for (const r of result.results) {
                    const detectedRole = resolveRole(r.roleText || 'owner');
                    if (r.uid) {
                        const existing = participantDetails.get(r.uid) || { name: nameOf(r.uid) };
                        if (existing.role !== detectedRole) {
                            participantDetails.set(r.uid, { ...existing, role: detectedRole });
                            updateParticipants();
                            log(`[DOM] ✅ ${detectedRole} uid=${r.uid} (${existing.name})`, 'success');
                        }
                    } else if (r.allTexts?.length > 0) {
                        let roleName = null;
                        for (const t of r.allTexts) {
                            if (participantsCache.has(t.toLowerCase())) { roleName = t; break; }
                        }
                        if (!roleName) {
                            for (const t of r.allTexts) {
                                const clean = t.replace(/^Select /i, '').replace(/ Settings$/i, '').trim();
                                if (participantsCache.has(clean.toLowerCase())) { roleName = clean; break; }
                            }
                        }
                        if (roleName) {
                            const uid = participantsCache.get(roleName.toLowerCase());
                            const existing = participantDetails.get(uid) || { name: roleName };
                            if (existing.role !== detectedRole) {
                                participantDetails.set(uid, { ...existing, role: detectedRole });
                                updateParticipants();
                                log(`[DOM] ✅ ${detectedRole} → ${roleName} (${uid})`, 'success');
                            }
                        } else {
                            // badge ditemukan tapi uid belum ada di cache — skip, akan retry di scan berikutnya
                        }
                    }
                }
            } catch (e) {
                log(`[DOM] Scan error: ${e.message}`, 'warn');
            }
        };
        // Expose ke module untuk akses oleh setInterval (deklarasi const harus sebelum assignment)
        _scanDomForOwner = scanDomForOwner;
        // Scan 2x dengan jeda: pertama setelah render, kedua setelah late-joiners
        setTimeout(scanDomForOwner, 4000);
        setTimeout(scanDomForOwner, 10000);

        // AI welcome — tunggu WS room confirm dulu (gate dibuat di awal startBot)
        log('Waiting for room WebSocket confirmation...', 'info');
        await Promise.race([
            wsReadyGate,
            new Promise(resolve => setTimeout(resolve, 12000)),
        ]);
        if (!_resolveWsReady) {
            log('[JOIN] WS room confirmed — bot aktif dalam room.', 'success');
        } else {
            _resolveWsReady = null;
            log('[JOIN] WS timeout — lanjut tanpa konfirmasi WS.', 'warn');
        }

        log('Generating AI welcome message...', 'info');
        const introPrompt = [
            `You are ${botState.botName}, a legitimate chat bot that just joined a Free4Talk room.`,
            `Write a SHORT, FRIENDLY introduction message in Indonesian (max 3-4 sentences).`,
            `Identify yourself as a BOT, mention !help for commands, say you cannot hear voice (only read text).`,
            `No links, no promotions. Sound helpful, not spammy.`
        ].join(' ');
        const welcomeMsg = await generateOnce(introPrompt, botState);
        await sendMessage(welcomeMsg || `✅ ${botState.botName} aktif! Ketik !help untuk melihat perintah.`);

    } catch (e) {
        log('Startup Error: ' + e.message, 'error');
        botState.status = 'OFFLINE';
        updateStatus();
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  IPC — terima perintah dari manager.js via proc.send()
// ════════════════════════════════════════════════════════════════════════════
if (process.send) {
    // Berjalan sebagai child process manager.js
    process.on('message', async (msg) => {
        if (!msg || !msg.type) return;

        if (msg.type === 'stop-bot') {
            log('Stopping bot (IPC)...', 'warn');
            if (context) { try { await context.close(); } catch (_) {} }
            if (browser) { try { await browser.close(); } catch (_) {} }
            browser = context = page = null;
            botJwk = botMyId = null;
            botState.status = 'OFFLINE'; botState.isPlaying = false;
            botState.currentSong = null; botState.queue = [];
            updateStatus();
            log('Bot stopped.', 'warn');
        }

        if (msg.type === 'send-command') {
            const cmd = msg.command;
            if (!cmd) return;
            log(`[IPC→CMD] ${cmd}`, 'cmd');
            try {
                await commandHandler(cmd, {
                    botState, sendMessage, addToQueue, playNext, log, updateStatus, page,
                    sender: { name: 'Dashboard Admin', role: 'Owner', uid: 'ADMIN' }
                });
            } catch (_) {}
        }

        if (msg.type === 'set-volume') {
            const pct  = Math.max(1, Math.min(100, parseInt(msg.volume, 10) || 50));
            botState.volume = pct;
            if (page) await page.evaluate(v => {
                if (window._audioElement) window._audioElement.volume = v;
            }, pct / 100).catch(() => {});
            updateStatus();
        }
    });
}

// ── updateStatus: kirim ke manager via IPC ─────────────────────────────────
// (overrides updateStatus to also IPC-send state)
const _origUpdateStatus = updateStatus;
// updateStatus sudah defined di atas; tambahkan IPC emit setelah call
function ipcSend(type, payload) {
    if (process.send) process.send({ type, ...payload });
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTO-START (dipanggil langsung, tidak perlu tunggu listen)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n🚀 Bot process started (no HTTP port needed).');

if (process.env.AUTO_START_ROOM) {
    const roomUrl = process.env.AUTO_START_ROOM;
    const botName = process.env.AUTO_BOT_NAME || 'GicellBot';
    let authData  = null;
    for (const fname of ['account.json', 'auth.json']) {
        try {
            authData = JSON.parse(fs.readFileSync(path.join(__dirname, fname), 'utf8'));
            console.log(`[AUTO-START] Auth loaded from ${fname}`);
            break;
        } catch (_) {}
    }
    if (!authData) console.warn('[AUTO-START] No auth file found, joining without auth.');
    console.log(`[AUTO-START] Joining ${roomUrl} as "${botName}"...`);
    setTimeout(() => startBot({ roomUrl, botName, authData }), 1000);
}
