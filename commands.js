const fs = require('fs');
const path = require('path');
const OLLAMA_API_KEY = '';
const yts = require('yt-search');

const economy = require('./economy.js');
let userMap = new Map();

// â”€â”€ Time helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/** "3:45" or "1:23:45" â†’ seconds */
function parseDuration(ts) {
    if (!ts) return 0;
    const parts = String(ts).split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
}

/** seconds â†’ "m:ss" or "h:mm:ss" */
function formatSec(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

/** 0.0-1.0 â†’ [â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘] */
function buildBar(progress, width = 12) {
    const filled = Math.round(Math.min(1, Math.max(0, progress)) * width);
    return '[' + 'â–ˆ'.repeat(filled) + 'â–‘'.repeat(width - filled) + ']';
}

const plugins = {};
const pluginCommands = new Map();

function loadPlugins() {
    const pluginDir = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir);

    try {
        const economyPath = path.join(__dirname, 'economy.js');
        delete require.cache[require.resolve(economyPath)];
    } catch (e) { }

    fs.readdirSync(pluginDir).forEach(file => {
        if (file.endsWith('.js')) {
            try {
                const pluginPath = path.join(pluginDir, file);
                delete require.cache[require.resolve(pluginPath)];
                const plugin = require(pluginPath);

                for (const [cmd, pFile] of pluginCommands.entries()) {
                    if (pFile === file) pluginCommands.delete(cmd);
                }

                plugins[file] = plugin;

                if (plugin.commands) {
                    plugin.commands.forEach(cmd => pluginCommands.set(cmd, file));
                }
                process.stdout.write(`Loaded plugin: ${file}\n`);
            } catch (err) {
                console.error(`âŒ Failed to load plugin ${file}:`, err);
            }
        }
    });
}
loadPlugins();

module.exports = async function handleCommand(msg, { botState, sendMessage, addToQueue, playNext, log, updateStatus, page, sender, speakTTS, isTTSBusy, clearPendingSongRequests }) {
    if (!msg || typeof msg !== 'string') return;

    // Defensive: trim leading/trailing whitespace supaya `msg.split(' ')[0]`
    // tidak menghasilkan string kosong saat ada spasi di depan.
    msg = msg.trim();
    if (!msg) return;

    loadPlugins();

    let cmd = msg.split(' ')[0].toLowerCase();
    let args = msg.replace(cmd, '').trim();

    if (cmd.startsWith('!vol') && cmd.length > 4) {
        args = cmd.substring(4) + (args ? ' ' + args : '');
        cmd = '!vol';
    }

    const cleanCmd = cmd.startsWith('!') ? cmd.substring(1) : cmd;
    if (cmd.startsWith('!') && pluginCommands.has(cleanCmd)) {
        const pluginName = pluginCommands.get(cleanCmd);
        const plugin = plugins[pluginName];

        try {
            console.log(`ðŸ”Œ Plugin Command: ${cleanCmd}`);
            const db = economy.loadEconomyDB();
            await plugin.handle(cleanCmd, args, msg, {
                botState, sendMessage, addToQueue, log, updateStatus, page, sender, userMap, db,
                speakTTS, isTTSBusy, clearPendingSongRequests
            });
            return;
        } catch (error) {
            console.error(`Error executing plugin command ${cleanCmd}:`, error);
            await sendMessage('âŒ Terjadi kesalahan pada plugin.');
            return;
        }
    }

    if (cmd === '!play' || cmd === '!p') {
        if (!args) return await sendMessage('â“ Masukkan judul lagu. Contoh: !play lofi');

        const choice = parseInt(args);
        if (!isNaN(choice) && botState.searchResults && botState.searchResults.length > 0) {
            if (choice >= 1 && choice <= botState.searchResults.length) {
                const selected = botState.searchResults[choice - 1];
                botState.searchResults = [];
                await addToQueue(selected.url, sender.name);
                return;
            }
        }

        await addToQueue(args, sender.name);
    }
    else if (cmd === '!search') {
        if (!args) return await sendMessage('â“ Masukkan judul lagu yang ingin dicari. Contoh: !search lofi');

        log(`Searching for: "${args}"...`, 'info');
        await sendMessage(`ðŸ” Mencari 10 hasil untuk: "${args}"...`);

        try {
            const r = await yts(args);
            const videos = r.videos.slice(0, 10);

            if (videos.length === 0) {
                return await sendMessage('âŒ Tidak ditemukan hasil untuk pencarian tersebut.');
            }

            botState.searchResults = videos;

            let response = `ðŸ”Ž Hasil Pencarian untuk: "${args}"\n\n`;
            videos.forEach((v, i) => {
                response += `${i + 1}. ${v.title} (${v.timestamp})\n`;
            });
            response += `\nðŸ’¡ Ketik !play [nomor] untuk memutar.`;

            await sendMessage(response.trim());
        } catch (e) {
            log('Search Error: ' + e.message, 'error');
            await sendMessage('âŒ Terjadi kesalahan saat mencari.');
        }
    }
    else if (cmd === '!skip' || cmd === '!s') {
        if (!botState.currentSong) return await sendMessage('â“ Tidak ada musik yang sedang diputar.');

        const isRoomOwner = sender.role === 'Owner';
        const isRequester = botState.currentSong.requestedBy === sender.name;

        if (isRoomOwner || isRequester) {
            log(`Skipping... (by ${sender.name})`, 'cmd');
            await sendMessage(`â­ Skipping... (Requested by ${sender.name})`);
            botState.isRepeating = false;
            // Stop audio segera supaya tidak overlap dengan lagu berikutnya
            botState.currentSong = null;
            botState.isPlaying = false;
            if (page) await page.evaluate(() => {
                if (window._audioElement) { window._audioElement.pause(); window._audioElement.src = ''; }
            }).catch(() => { });
            await playNext();
        } else {
            await sendMessage(`âŒ Hanya pengirim lagu (${botState.currentSong.requestedBy}) atau Owner yang bisa skip.`);
        }
    }
    else if (cmd === '!stop') {
        const isRoomOwner = sender.role === 'Owner';
        const isRequester = botState.currentSong && botState.currentSong.requestedBy === sender.name;

        if (isRoomOwner || isRequester || !botState.currentSong) {
            if (typeof clearPendingSongRequests === 'function') clearPendingSongRequests();
            botState.queue = [];
            botState.isRepeating = false;
            botState.isPlaying = false;
            botState.currentSong = null;
            if (page) await page.evaluate(() => {
                if (window._audioElement) { window._audioElement.pause(); window._audioElement.src = ''; }
            }).catch(() => { });
            log(`Stopped & Queue cleared (by ${sender.name}).`, 'warn');
            updateStatus();
            await sendMessage(`â¹ Music stopped & Queue cleared by ${sender.name}.`);
        } else {
            const reqName = botState.currentSong ? botState.currentSong.requestedBy : 'pengirim';
            await sendMessage(`âŒ Hanya pengirim lagu (${reqName}) atau Owner yang bisa stop.`);
        }
    }
    else if (cmd === '!repeat' || cmd === '!r') {
        botState.isRepeating = !botState.isRepeating;
        updateStatus();
        await sendMessage(botState.isRepeating ? 'ðŸ” Repeat ON' : 'ðŸ” Repeat OFF');
    }
    else if (cmd === '!np') {
        if (!botState.currentSong) return await sendMessage('â“ Tidak ada musik yang diputar.');

        const s = botState.currentSong;
        let elapsed = 0, audioDur = 0;

        if (page) {
            try {
                const info = await page.evaluate(() => ({
                    currentTime: window._audioElement?.currentTime || 0,
                    duration: window._audioElement?.duration || 0
                }));
                elapsed = Math.floor(info.currentTime);
                audioDur = isFinite(info.duration) ? Math.floor(info.duration) : 0;
            } catch (_) { }
        }

        const totalSec = audioDur || parseDuration(s.duration);
        const remaining = Math.max(0, totalSec - elapsed);
        const progress = totalSec > 0 ? elapsed / totalSec : 0;

        let npMsg = `ðŸŽ¶ *${s.title}*\n`;
        npMsg += `ðŸ‘¤ Requested by: ${s.requestedBy}\n`;
        if (totalSec > 0) {
            npMsg += `${buildBar(progress)} ${formatSec(elapsed)} / ${formatSec(totalSec)}\n`;
            npMsg += `â±ï¸ Selesai dalam: ${formatSec(remaining)}`;
        } else {
            npMsg += `â±ï¸ Durasi tidak tersedia`;
        }

        await sendMessage(npMsg);
    }
    else if (cmd === '!queue' || cmd === '!q') {
        // Ambil posisi audio saat ini dari browser
        let elapsed = 0;
        if (page && botState.currentSong) {
            try {
                const info = await page.evaluate(() => ({ currentTime: window._audioElement?.currentTime || 0 }));
                elapsed = Math.floor(info.currentTime);
            } catch (_) { }
        }

        if (!botState.currentSong && botState.queue.length === 0)
            return await sendMessage('â“ Antrean kosong dan tidak ada musik yang diputar.');

        let response = '';

        // â”€â”€ Now Playing â”€â”€
        if (botState.currentSong) {
            const s = botState.currentSong;
            const dur = parseDuration(s.duration);
            const rem = dur > 0 ? Math.max(0, dur - elapsed) : 0;
            const prog = dur > 0 ? elapsed / dur : 0;
            const durStr = s.duration ? ` (${s.duration})` : '';
            const barStr = dur > 0 ? `\n${buildBar(prog)} ${formatSec(elapsed)}/${formatSec(dur)}` : '';
            const remStr = rem > 0 ? ` â±ï¸ sisa ~${formatSec(rem)}` : '';

            response += `ðŸŽ¶ *Now Playing*${durStr}${remStr}\n${s.title}\nðŸ‘¤ ${s.requestedBy}${barStr}`;
        }

        // â”€â”€ Antrean â”€â”€
        if (botState.queue.length > 0) {
            const totalQueueSec = botState.queue.reduce((sum, s) => sum + parseDuration(s.duration), 0);
            const curRem = botState.currentSong
                ? Math.max(0, parseDuration(botState.currentSong.duration) - elapsed)
                : 0;
            const totalWait = curRem + totalQueueSec;

            const list = botState.queue.map((s, i) => {
                const d = s.duration ? ` (${s.duration})` : '';
                return `${i + 1}. ${s.title}${d} â€” ${s.requestedBy}`;
            }).join('\n');

            const totalStr = totalQueueSec > 0 ? ` | total ${formatSec(totalQueueSec)}` : '';
            response += `\n\nðŸ“ Antrean (${botState.queue.length} lagu${totalStr}):\n${list}`;

            if (totalWait > 0) {
                response += `\n\nâ° Estimasi semua selesai: ~${formatSec(totalWait)}`;
            }
        } else {
            response += '\n\n(Antrean berikutnya kosong)';
        }

        await sendMessage(response.trim());
    }
    else if (cmd === '!vol') {
        const n = parseInt(args, 10);
        if (isNaN(n)) {
            // Tampilkan volume saat ini
            return await sendMessage(`ðŸ”Š Volume saat ini: ${botState.volume}%\nGunakan: !vol [1-100]`);
        }

        const pct = Math.max(1, Math.min(100, n));   // clamp 1â€“100
        const frac = pct / 100;                        // 0.01â€“1.0 untuk audio element

        botState.volume = pct;  // simpan sebagai 1-100
        if (page) await page.evaluate(v => {
            // Update elemen audio aktif (lagu sekarang)
            if (window._audioElement) window._audioElement.volume = v;
            // Update baseline volume supaya lagu berikutnya tidak reset ke default
            window._botVolume = v;
        }, frac);
        updateStatus();
        await sendMessage(`ðŸ”Š Volume: ${pct}%`);
    }
    else if (cmd === '!help') {
        const menu = [
            `ðŸŽµ --- ${botState.botName.toUpperCase()} ---`,
            'â–¶ !play [judul/nomor] - Putar musik',
            'ðŸ”Ž !search [judul] - Cari 10 lagu',
            'â­ !skip - Lewati lagu',
            'ðŸ” !repeat - Ulangi lagu ini',
            'â¹ !stop - Berhenti & hapus antrean',
            'ðŸ“ !queue - Lihat daftar antrean',
            'ðŸŽ¶ !np - Judul lagu sekarang',
            'ðŸ”Š !vol [1-100]  - Atur volume (contoh: !vol 70)',
            'ðŸŽ¤ !lirik - Cari lirik lagu sekarang',
            'â“ !help - Menu bantuan'
        ].join('\n');
        await sendMessage(menu);
    }
    else if (cmd === '!lirik') {
        let query = args;
        if (!query && botState.currentSong) {
            query = botState.currentSong.title;
        }

        if (!query) {
            return await sendMessage('â“ Putar lagu dulu atau ketik: !lirik [judul lagu]');
        }

        // Bersihkan judul dari embel-embel YouTube
        const cleanQuery = query
            .replace(/official (lyric video|music video|video|audio)/gi, '')
            .replace(/\blirik( & terjemahan)?\b/gi, '')
            .replace(/\blyrics?( & translation)?\b/gi, '')
            .replace(/\bfull album\b/gi, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\|.*/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // YouTube format: "Artist - Song Title" â†’ split untuk lrclib
        const dashParts = cleanQuery.split(' - ').map(s => s.trim()).filter(Boolean);
        const ytArtist  = dashParts.length >= 2 ? dashParts[0] : '';
        const ytTrack   = dashParts.length >= 2 ? dashParts.slice(1).join(' - ') : cleanQuery;

        log(`Searching lyrics: "${ytTrack}" by "${ytArtist || '?'}" via lrclib.net...`, 'info');
        await sendMessage(`ðŸ” Mencari lirik untuk: ${cleanQuery}...`);

        let lirik = '';
        try {
            const tryLrc = async (track, artist) => {
                const url = 'https://lrclib.net/api/search?track_name=' + encodeURIComponent(track)
                          + (artist ? '&artist_name=' + encodeURIComponent(artist) : '');
                const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0 && data[0].plainLyrics) return data[0];
                return null;
            };
            let hit = null;
            if (ytArtist) hit = await tryLrc(ytTrack, ytArtist); // A: Artist di kiri (YouTube format)
            if (!hit)     hit = await tryLrc(ytTrack, '');        // B: Tanpa filter artist
            if (!hit)     hit = await tryLrc(cleanQuery, '');     // C: Full query
            if (hit) {
                lirik = hit.plainLyrics;
                log(`lrclib âœ… "${hit.trackName}" - ${hit.artistName}`, 'info');
            }
        } catch (e) {
            log('lrclib Error: ' + e.message, 'error');
        }

        if (!lirik || lirik.length < 20) {
            return await sendMessage('âŒ Gagal menemukan lirik untuk lagu ini.');
        }

        const lines = lirik.split('\n');
        let currentChunk = `ðŸŽ¤ Lirik: ${cleanQuery}\n\n`;

        for (const line of lines) {
            if ((currentChunk + line).length > 450) {
                await sendMessage(currentChunk.trim());
                await new Promise(r => setTimeout(r, 800));
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }

        if (currentChunk.trim()) {
            await sendMessage(currentChunk.trim());
        }
    }
};

module.exports.updateUserMap = function (map) {
    userMap = map;
    console.log(`User map updated: ${userMap.size} users`);
};

// Daftar command inti yang terdaftar (dipakai server.js untuk routing AI)
module.exports.CORE_COMMANDS = [
    'play', 'p', 'search', 'skip', 's', 'stop',
    'repeat', 'r', 'np', 'queue', 'q',
    'vol', 'help', 'lirik'
];

// Getter live Map dari plugin commands (hot-reload safe)
module.exports.getPluginCommands = () => pluginCommands;
