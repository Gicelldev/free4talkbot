<div align="center">

# GicellBot

**Bot AI suara buat voice room Free4Talk — host sendiri, gratis, tanpa ribet**

[![npm](https://img.shields.io/npm/v/create-gicellbot?style=flat-square&color=cb3837)](https://www.npmjs.com/package/create-gicellbot)
[![npm downloads](https://img.shields.io/npm/dt/create-gicellbot?style=flat-square&label=downloads&color=blue)](https://www.npmjs.com/package/create-gicellbot)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Free4Talk](https://img.shields.io/badge/platform-Free4Talk-purple?style=flat-square)](https://free4talk.com)

[🇺🇸 English](README.md) | 🇮🇩 Bahasa Indonesia

</div>

---

Jadi ceritanya ini bot buat [Free4Talk](https://free4talk.com) — platform voice chat. Bot-nya bisa dengerin orang ngomong di room secara real-time, transcribe pake Whisper, terus balas pake suara lewat TTS. Bisa muter musik langsung ke room WebRTC tanpa butuh virtual soundcard. Ada juga sistem ekonomi, RPG, AI chat, dan sejenisnya — semua jalan dari satu proses Node.js.

**Bedanya dari bot lain:**
- Self-hosted sepenuhnya — data di server sendiri, key sendiri, kontrol penuh
- Inject audio langsung ke WebRTC — ga perlu virtual mic atau soundcard eksternal
- Deteksi wake word fuzzy — Whisper sering salah transkripsi nama Indonesia, bot ini tetap nangkep meski ditranskrip jadi `"Gicil"`, `"Gitel"`, atau `"Cicel"`
- Talk Mode — tanpa wake word, bot respon semua yang ngomong di room
- AI bisa langsung eksekusi command dari suara — bilang `"puterin Playdate"`, AI balas dan trigger `!play` otomatis
- Semua API yang dipake punya free tier — ga perlu bayar bulanan untuk pemakaian normal

> Dibuat sama **Gilang Raja** ([@Gicelldev](https://github.com/Gicelldev))

**Quick start:**
```bash
npx create-gicellbot nama-folder
cd nama-folder && cp .env.example .env
# isi .env dengan API key kamu
npm run setup   # login ke Free4Talk sekali doang
npm start
```

---

## Daftar Isi

- [Fitur](#fitur)
- [Gimana Cara Kerjanya](#gimana-cara-kerjanya)
- [Spesifikasi Minimum](#spesifikasi-minimum)
- [Instalasi](#instalasi)
- [Konfigurasi](#konfigurasi)
- [Pertama Kali Jalankan](#pertama-kali-jalankan)
- [Referensi File](#referensi-file)
  - [server.js](#serverjs)
  - [voice.js](#voicejs)
  - [stt.js](#sttjs)
  - [tts.js](#ttsjs)
  - [ai.js](#aijs)
  - [commands.js](#commandsjs)
  - [economy.js](#economyjs)
  - [fun_api.js](#fun_apijs)
  - [manager.js](#managerjs)
  - [plugins/](#plugins)
- [Voice Mode](#voice-mode)
- [Referensi Command](#referensi-command)
- [Plugin System](#plugin-system)
- [Troubleshooting](#troubleshooting)
- [Lisensi](#lisensi)

---

## Fitur

### 🎙️ Suara
- Intercept audio track semua peer di room via WebRTC langsung
- Transcribe real-time pake **Groq Whisper Large v3** (gratis 2.000 req/hari)
- Deteksi wake word 3 tahap dengan fuzzy matching — handle kesalahan transkripsi Whisper
- **Talk Mode** — tanpa wake word, semua yang ngomong langsung direspon
- Balas pake suara via **Microsoft Edge TTS** (18+ pilihan suara, tanpa API key)
- Anti-feedback — bot ga pernah respon output TTS-nya sendiri

### 🎵 Musik
- Cari di YouTube via `yt-search`, stream audio pake `yt-dlp`
- Audio diinject langsung ke WebRTC sender track — tanpa virtual device
- Cache stream URL (TTL 4 jam) dan pre-fetch lagu berikutnya di antrian
- Dedup request — ga ada double call yt-dlp untuk URL yang sama
- Antrian lengkap dengan tracking posisi dan nama requester per lagu

### 🤖 AI Chat
- Pake **NVIDIA NIM** (model bisa diganti, default Qwen 3.5 122B)
- Memori percakapan per-user — tersimpan antar restart di `ai_memory.json`
- Multi-key rotation dengan auto-failover saat 429/error
- Web search via scraping Bing — trigger otomatis kalau user minta cari sesuatu
- Cuaca real-time via Open-Meteo (gratis, tanpa key) — trigger dari keyword kota + cuaca
- Jawab pertanyaan jadwal shalat (API Kemenag), jokes, truth/dare, resep, ayat Quran
- AI bisa parse dan eksekusi command langsung dari reply-nya sendiri

### 🎮 Ekonomi & RPG
- Mata uang virtual, 60+ pekerjaan grinding, toko item, gacha, judi, sistem crime
- Leveling XP, HP, cooldown harian, inventory per-user

---

## Gimana Cara Kerjanya

```
 Orang ngomong di room
     │
     ▼
 WebRTC track (browser via Playwright)
     │   ScriptProcessorNode capture PCM chunks
     │   Di-encode ke WebM/Opus di browser
     │   Dikirim ke Node.js via page.exposeFunction
     ▼
 voice.js — handlePeerUtterance()
     │   Cek isTTSBusy (anti-feedback)
     │   Deteksi wake word 3 tahap:
     │       1. Substring langsung
     │       2. Normalized phonetic
     │       3. Fuzzy Levenshtein (edit distance ≤ 1)
     ▼
 stt.js — transcribeAudio()
     │   Groq Whisper Large v3
     │   Round-robin multi-key
     │   Auto-failover 429/error
     ▼
 ai.js — askAI()
     │   System prompt + memori user
     │   fun_api.js → shalat, jokes, truth/dare, resep, Quran
     │   Web search (Bing) kalau dideteksi
     │   Cuaca (Open-Meteo) kalau dideteksi
     │   Call NVIDIA NIM API
     │   parseCommandFromAI() → ekstrak [CMD:!...] dari reply
     ▼
 server.js — speakTTS() + eksekusi command
     │   tts.js → generateTTS() via msedge-tts
     │   Audio diinject ke WebRTC sender track
     │   Command diparsing dan dirouting ke commands.js
     ▼
 Room — peer lain denger bot ngomong
```

---

## Spesifikasi Minimum

### Hardware

| Komponen | Minimum | Rekomendasi |
|---|---|---|
| **RAM** | 1 GB bebas | 2 GB bebas |
| **CPU** | 2 core (x86_64) | 4+ core |
| **Storage** | 1,5 GB bebas | 2 GB+ bebas |
| **Internet** | Broadband stabil | Latensi ≤ 50ms |

> **Rincian RAM:** Chromium ~300–400 MB · Voice processing ~150 MB · Streaming musik ~50–100 MB · Node.js ~100 MB. Total sekitar 700–750 MB normal load. Kurang dari 1 GB bebas = lag atau crash kalau voice dan musik jalan bersamaan.

> **Rincian storage:** `node_modules` ~300 MB · Playwright Chromium ~400 MB · Audio temp ~50 MB · Data file ~5 MB. Minimal ~800 MB, nyamannya 1,5 GB.

### OS

| OS | Status | Catatan |
|---|---|---|
| Windows 10 / 11 | ✅ Full support | Tested harian |
| Ubuntu 20.04 / 22.04 | ✅ Full support | Tested di 22.04 LTS |
| Debian 11+ | ✅ Harusnya jalan | Install Playwright deps dulu |
| macOS 12+ | ✅ Harusnya jalan | Kurang ditest |
| ARM / Raspberry Pi | ⚠️ Tidak disarankan | Chromium berat di ARM |

Di Debian/Ubuntu mungkin perlu:
```bash
npx playwright install-deps chromium
```

### Software

| Software | Versi | Fungsi |
|---|---|---|
| **Node.js** | ≥ 18.0.0 | Runtime |
| **npm** | ≥ 8.0.0 | Package manager |
| **yt-dlp** | Terbaru | Ekstrak audio YouTube |
| **ffmpeg** | Versi apapun | Processing audio (dep yt-dlp) |

**Install yt-dlp:**
```bash
# Windows
winget install yt-dlp

# Linux
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# macOS
brew install yt-dlp
```

**Install ffmpeg:**
```bash
# Windows
winget install ffmpeg

# Linux
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

> **Penting:** yt-dlp harus sering di-update. YouTube rutin ganti format internal, dan itu bikin versi lama yt-dlp rusak. Jalanin `yt-dlp -U` tiap beberapa minggu.

### API yang Dipakai (Semua Gratis)

| Layanan | Fungsi | Free Tier | Daftar |
|---|---|---|---|
| **Groq** | Speech-to-Text (Whisper Large v3) | 2.000 req/hari per key | [console.groq.com](https://console.groq.com) |
| **NVIDIA NIM** | AI chat | ~1.000 req/hari (tergantung model) | [build.nvidia.com](https://build.nvidia.com) |
| **Free4Talk** | Platform tempat bot jalan | Akun gratis | [free4talk.com](https://free4talk.com) |
| **Open-Meteo** | Cuaca real-time | Unlimited, tanpa key | Otomatis |
| **Kemenag API** | Jadwal shalat Indonesia | Unlimited, tanpa key | Otomatis |
| **Genius** | Lirik lagu | Public scraping | Otomatis |

---

## Instalasi

### Opsi A — npx (paling simpel)

```bash
npx create-gicellbot nama-folder
cd nama-folder
```

Download dari npm, salin semua file, jalankan `npm install` otomatis, print langkah selanjutnya.

### Opsi B — Clone dari GitHub

```bash
git clone https://github.com/Gicelldev/free4talkbot.git nama-folder
cd nama-folder
npm install
```

### Install browser Playwright

Setelah salah satu dari dua opsi di atas:

```bash
npx playwright install chromium
```

Download Chromium ~400 MB. Cuma perlu sekali.

---

## Konfigurasi

### `.env`

```bash
cp .env.example .env
```

```env
# ─────────────────────────────────────────────────────────────
#  GROQ — Speech-to-Text (Whisper)
#  Daftar gratis di https://console.groq.com
#  Bisa masukin banyak key pisah koma buat nambah kuota harian.
#  Key dipakai round-robin, otomatis skip kalau rate limit.
# ─────────────────────────────────────────────────────────────
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3

# ─────────────────────────────────────────────────────────────
#  NVIDIA NIM — AI Chat
#  Daftar gratis di https://build.nvidia.com
#  Multiple key juga didukung, rotasi otomatis.
# ─────────────────────────────────────────────────────────────
NIM_API_KEYS=nvapi-key1,nvapi-key2

# ─────────────────────────────────────────────────────────────
#  Room yang di-join pas bot start
#  Kosongkan kalau mau set dari dashboard setelah start.
# ─────────────────────────────────────────────────────────────
ROOM_URL=https://www.free4talk.com/room/ROOM_ID?key=ROOM_KEY

# ─────────────────────────────────────────────────────────────
#  Nama bot — harus sama persis dengan nama akun Free4Talk.
#  Juga jadi wake word di voice mode.
# ─────────────────────────────────────────────────────────────
BOT_NAME=GicellBot
```

### `account.json`

```json
{ "username": "NamaBotKamu" }
```

Harus sama persis dengan nama tampilan akun Free4Talk yang dipakai bot.

### `roles.json`

```json
{
  "owners": ["USER_UID_DISINI"],
  "mods":   ["USER_UID_DISINI"]
}
```

UID keliatan di log dashboard waktu user join room. Owner dan mod bisa pakai command terbatas seperti `!skip` (lagu orang lain), `!stop`, `!voice on/off`, `!talkmode`.

### `ai.js` — system prompt

Edit fungsi `buildSystemPrompt(botName)` buat atur kepribadian AI-nya. Default-nya sengaja dikosongkan — tambahin sendiri persona, aturan, dan konteks yang diinginkan.

---

## Pertama Kali Jalankan

### Step 1 — Login ke Free4Talk

```bash
npm run setup
```

Ini buka window browser Chromium beneran. Login ke akun Free4Talk yang mau dipakai bot. Sesi disimpan ke `./profile/` dan dipakai otomatis setiap start berikutnya. Cuma perlu dilakukan sekali — atau kalau sesi expired.

> Jangan hapus folder `./profile/`. Kalau dihapus, bot ga bisa auto-login dan harus setup ulang.

### Step 2 — Jalankan bot

```bash
npm start
```

Pas start, bot:
1. Launch browser Chromium headless via Playwright
2. Load sesi dari `./profile/`
3. Navigasi ke room di `ROOM_URL`
4. Dismiss interstitial izin kamera/mic
5. Setup WebSocket chat interceptor
6. Setup intercept audio track WebRTC untuk voice listening
7. Mulai MutationObserver buat baca pesan chat
8. Masuk room dan kirim pesan welcome yang digenerate AI

### Step 3 — Dashboard

Buka `http://localhost:3000` (atau port yang diprint pas start). Dari sini bisa:
- Lihat log live, color-coded per level
- Ganti URL room tanpa restart
- Start/stop bot
- Lihat antrian aktif
- Lihat participant yang connected

---

## Referensi File

Dokumentasi lengkap setiap fungsi di setiap file.

---

### `server.js`

Otak utama bot. Handle sesi browser, join room, intercept chat, streaming musik, playback TTS, dan setup WebRTC. ~2.100 baris.

#### `getStreamUrl(videoUrl) → Promise<string>`
Ambil URL audio langsung dari YouTube via `yt-dlp`. Fitur:
- **Cache 4 jam** (`_streamUrlCache`) — biar ga re-fetch URL yang sama waktu skip/replay
- **Request dedup** (`_pendingFetches`) — cegah dua call yt-dlp concurrent untuk video yang sama
- Prioritas format: `140` (m4a 128k) → `251` (opus) → `250` (opus low) → best audio

#### `preFetchNextSong()`
Dipanggil langsung setelah lagu mulai diputar. Pre-fetch stream URL lagu berikutnya di background, jadi waktu skip/transisi URL sudah di-cache dan playback langsung mulai.

#### `loadRoles()` / `applyStaticRoles()`
Baca `roles.json` dan assign status Owner/Mod ke user berdasarkan UID. `applyStaticRoles` re-apply ke participant yang sudah connected (dipanggil kalau roles.json berubah saat runtime).

#### `log(msg, type)`
Logger terstruktur. Tipe: `'info'` · `'success'` · `'warn'` · `'error'` · `'cmd'` · `'ai'`. Log dikirim ke dashboard via Socket.IO.

#### `updateStatus()`
Broadcast state bot saat ini (room URL, volume, lagu yang diputar, panjang antrian, status voice) ke semua client dashboard yang connected.

#### `updateParticipants()`
Baca elemen user dari DOM, ekstrak UID dan nama tampilan, emit daftar participant ke dashboard. Dipanggil saat MutationObserver trigger.

#### `checkEmptyRoom()`
Mulai countdown 30 detik kalau room jadi kosong (semua manusia keluar). Kalau masih kosong setelah 30 detik, bot keluar otomatis.

#### `leaveRoom(reason)`
Keluar dari room secara graceful — stop musik, mute mic, klik tombol leave, emit status offline.

#### `normalizeMsg(text) → string`
Bersihin pesan chat masuk — strip zero-width character, normalize Unicode, trim whitespace. Dipake sebelum semua pemrosesan pesan.

#### `nameOf(uid) → string` / `roleOf(uid) → string`
Resolve peer socket ID atau UID ke nama tampilan atau role dari cache participant internal.

#### `resolveRole(raw) → string`
Normalize string role mentah dari DOM Free4Talk (`'Owner'`, `'Moderator'`, `'Member'`, dll) ke lowercase yang konsisten.

#### `sendMessage(text)`
Kirim pesan teks ke chat room Free4Talk. Pakai Playwright untuk ketik ke input chat dan submit.

#### `recordChat(name, text)`
Tambahkan pesan chat ke `botState.chatHistory` (buffer rolling 20 pesan), dipakai sebagai konteks untuk relevance filter AI.

#### `isAddressedToOtherUser(text, participants) → boolean`
Return `true` kalau pesan kelihatannya ditujukan ke user lain (mengandung nama participant lain). Dipakai buat skip respons AI kalau pesan jelas bukan buat bot.

#### `hasActiveUserConversation(currentSender) → boolean`
Return `true` kalau ada user lain yang lagi mid-conversation sama bot. Cegah bot nyela pas orang lain lagi ngobrol.

#### `checkAIRelevance(text, botName, senderName, participants, muteUntil) → boolean`
Gate utama relevansi AI. Return `true` kalau bot harusnya respon pesan ini. Cek:
- Lagi TTS-busy? (skip buat hindari feedback)
- Ini command (`!...`)? (commands dihandle commands.js, bukan AI)
- Terlalu pendek (< 3 karakter)?
- Ditujukan ke user lain?
- Dari bot sendiri?
- Ada conversation aktif sama orang lain?

#### `handleChatMessage(chatData)`
Handler utama pesan chat masuk. Dipanggil WebSocket interceptor. Urutan proses:
1. Abaikan pesan dari bot sendiri
2. Normalize dan clean teks
3. Deteksi dan eksekusi `!command`
4. Cek relevance gate AI
5. Kalau AI mode on, kirim ke `askAI()` dan post hasilnya ke chat

#### `parseChatPayload(eventName, data) → { name, text, uid } | null`
Parse payload event WebSocket ke objek `{ name, text, uid }` yang normalized. Handle berbagai format pesan Free4Talk.

#### `setupWSInterceptor()`
Inject JavaScript ke browser page untuk intercept pesan WebSocket di level socket.io. Expose bridge `window.__onWsMessage(eventName, data)` yang memanggil Node.js via `page.exposeFunction`. Begini cara bot baca chat tanpa polling DOM.

#### `scanRoomParticipants()`
Scan DOM untuk semua participant yang connected, ekstrak UID, nama, dan role. Update `botState.participants`. Dipanggil saat join dan saat MutationObserver detect perubahan.

#### `unmuteMic()` / `muteMic()`
Klik tombol toggle mikrofon di UI Free4Talk. `unmuteMic` tunggu prompt "Turn ON your microphone" dan konfirmasi. Dipanggil sebelum musik mulai dan setelah selesai.

#### `speakTTS(text, opts)`
Pipeline TTS lengkap:
1. Strip emoji dan markdown dari teks
2. Panggil `tts.js → generateTTS()` buat dapat buffer audio
3. Unmute mic kalau belum
4. Inject buffer audio sebagai `Blob URL` ke page
5. Play via `AudioContext` yang terhubung ke WebRTC sender
6. Set `_ttsBusy = true` selama playback buat block voice input
7. Panggil callback waktu selesai

#### `isTTSBusy() → boolean`
Return apakah TTS lagi diputar. Voice processing cek ini buat hindari bot denger dirinya sendiri.

#### `stopAudio()`
Stop semua playback audio — disconnect AudioContext source, stop elemen `<audio>`, set `botState.nowPlaying = null`.

#### `playNext()`
Dequeue lagu berikutnya dari `botState.queue` dan panggil `startStream()`. Handle transisi antar lagu termasuk trigger pre-fetch.

#### `startStream(song)`
Pipeline playback musik lengkap:
1. Unmute mic
2. Panggil `getStreamUrl()` untuk dapat URL audio langsung
3. Buat elemen `<audio>` di page
4. Connect: `<audio>` → `MediaElementSourceNode` → `GainNode` → `AudioContext.destination`
5. Connect juga ke `MediaStreamDestination` WebRTC sender biar stream ke room
6. Monitor `timeupdate` — kirim pesan "Now Playing" saat audio beneran mulai
7. Saat `ended` — panggil `playNext()` atau stop kalau antrian kosong

---

### `voice.js`

Handle pipeline voice conversation — dari nerima chunk audio mentah sampai orkestrasikan STT, deteksi wake word, respons AI, dan TTS.

#### `normalizeForWakeWord(text) → { normal, compact }`
Pre-process transcript mentah Whisper sebelum wake word matching. Fungsi paling penting buat bikin deteksi suara robust. Yang dilakukan:
- Hapus tanda baca, lowercase semua
- Map pola mismatch umum: `gh→g`, `ch→c`, `eo→el`, akhiran `al→el`
- Hapus hyphen (Whisper kadang output `"ghi-cheo"` bukan `"gicel"`)
- Versi `compact`: gabungkan token pendek (≤ 3 karakter) yang mungkin bagian dari nama bot yang ke-split (mis. `["gi", "cel"]` → `"gicel"`)

#### `buildWakeWordSet(botName) → Set<string>`
Generate semua varian fonetik nama bot yang harusnya dianggap wake word. Untuk bot bernama "Gicell", generate varian seperti: `gicell`, `gicel`, `gijel`, `kicel`, `jicel`, `cicel`, `gicol`, `gisal`, dan banyak lagi — covering kemungkinan kesalahan transkripsi Whisper.

#### `levenshtein(a, b) → number`
Hitung edit distance (Levenshtein distance) antara dua string. Dipakai `findFuzzyMatch` untuk tangkap varian wake word yang ga ada di set pre-generated.

#### `findFuzzyMatch(tokens, wakeWords) → boolean`
Untuk setiap kata di token list, cek apakah ada kata di `wakeWords` yang dalam jarak Levenshtein 1. Ini nangkap varian yang sama sekali tak terduga (mis. `"Bicel"`) yang ga ada di set fonetik.

#### `detectWakeWord(transcript, wakeWords) → boolean`
Detektor wake word 3 tahap:
1. **Direct**: apakah ada `wakeWord` sebagai substring dari transcript mentah?
2. **Normalized**: apakah ada setelah normalisasi fonetik?
3. **Fuzzy**: apakah `findFuzzyMatch` return true terhadap token transcript?
Return `true` kalau salah satu tahap cocok.

#### `stripEmojisForTTS(text) → string`
Hapus semua karakter emoji dari teks sebelum dikirim ke TTS engine. Tanpa ini, Edge TTS baca nama emoji dengan suara (mis. "thinking face, grinning face").

#### `handlePeerUtterance(payload, ctx) → Promise<void>`
Entry point utama — dipanggil `server.js` untuk setiap chunk audio peer yang lewat threshold silence. Pipeline lengkap:
1. Cek `isTTSBusy()` — skip kalau bot lagi ngomong (anti-feedback)
2. Cek durasi audio minimum (< 1,5 detik → skip kebisingan)
3. Cek global reply cooldown (3 detik setelah reply terakhir)
4. Kirim buffer audio ke `stt.js → transcribeAudio()`
5. Cek panjang transcript minimum (< 3 karakter → skip)
6. Cek panjang transcript maximum (> 500 karakter → skip sebagai anomali)
7. **Talk Mode path**: kalau `botState.voiceTalkMode`, cek per-track cooldown (8 detik) dan panjang minimum (8 karakter), langsung panggil AI
8. **Wake Word path**: panggil `detectWakeWord()` → cek `STRICT_TRIGGERS` → panggil AI
9. Kirim reply AI ke `speakTTS()`
10. Parse `[CMD:!...]` dari reply AI dan eksekusi via command router
11. Update timestamp cooldown

#### `getVoiceStatus() → object`
Return state voice module saat ini buat dashboard: apakah STT key sudah dikonfigurasi, jumlah key, apakah voice aktif, status talk mode.

---

### `stt.js`

Handle transkripsi audio via Groq Whisper API.

#### `nextGroqKey() → string | null`
Selector key round-robin. Mulai di offset random (biar beberapa instance ga bentrok di key yang sama) dan advance cursor tiap panggilan. Return `null` kalau ga ada key yang dikonfigurasi.

#### `transcribeAudio(audioBuffer, opts) → Promise<string>`
Kirim buffer audio ke Groq Whisper untuk transkripsi. Parameter:
- `audioBuffer`: `Buffer` — data audio mentah dalam format yang didukung Whisper (WebM/Opus, MP3, WAV, M4A)
- `opts.lang`: hint bahasa (`'id'` untuk Indonesia by default)
- `opts.mime`: MIME type audio (`'audio/webm'` by default)

Behavior:
- Coba setiap key secara rotasi
- `429` (rate limit): skip ke key berikutnya langsung
- `401/403` (key invalid): log warning dan coba key berikutnya
- Error lain: log dan lanjutkan rotasi
- Kalau semua key gagal: throw error terakhir

Return transcript sebagai string yang sudah di-trim, atau `''` kalau kosong.

#### `hasValidKeys() → boolean`
Return `true` kalau minimal ada satu Groq API key yang dikonfigurasi dan bukan placeholder.

#### `keyCount() → number`
Return jumlah Groq API key valid yang ter-load.

---

### `tts.js`

Text-to-speech via Microsoft Edge TTS (`msedge-tts`).

#### `sanitize(text) → string`
Siapkan teks sebelum TTS:
- Strip emoji
- Hapus marker markdown bold/italic (`**`, `*`, `_`)
- Hapus code fence
- Collapse spasi dan newline berlebih
- Trim hasil

#### `generateTTS(text, opts) → Promise<Buffer>`
Generate audio dari teks. Parameter:
- `text`: teks yang mau di-speak (otomatis disanitize)
- `opts.voice`: nama voice Edge TTS (default: `id-ID-GadisNeural` — perempuan Indonesia)
- `opts.rate`: kecepatan bicara (`+0%` sampai `+50%`, default `+0%`)
- `opts.pitch`: penyesuaian pitch (default `+0Hz`)

Return `Buffer` berisi data audio (format MP3). Buffer di-return in-memory — tidak ada file temp yang ditulis ke disk.

Pilihan voice Indonesia: `id-ID-GadisNeural` (perempuan), `id-ID-ArdiNeural` (laki-laki).
Pilihan voice Inggris: `en-US-AriaNeural`, `en-US-GuyNeural`, dan 30+ lainnya.

---

### `ai.js`

Otak AI. Kelola memori percakapan, bangun prompt, panggil NIM API, handle web search dan cuaca, parse command dari reply AI.

#### `nextApiKey() → string`
Selector key NIM round-robin — strategi sama dengan `nextGroqKey()` di stt.js.

#### `callNIM(messages, opts) → Promise<string>`
Wrapper low-level NIM API. Parameter:
- `messages`: array `{ role, content }` (format chat OpenAI)
- `opts.max_tokens`: panjang respons maksimal (default 512)
- `opts.temperature`: tingkat random (default 0.85)

Coba setiap key dengan rotasi otomatis saat 429/error. Return string reply asisten.

#### `loadMemory() → object` / `saveMemory(memory)`
Baca/tulis `ai_memory.json`. Objek memori memetakan `senderName → [{ role, content }, ...]` array riwayat percakapan. Memori di-load sekali saat startup dan ditulis ke disk setelah setiap giliran percakapan.

#### `buildSystemPrompt(botName) → string`
Bangun system prompt yang dikirim ke model NIM di setiap request. Default-nya template minimal — edit fungsi ini untuk definisikan kepribadian, aturan, pengetahuan, dan instruksi command bot.

#### `extractCity(msg) → string | null`
Ekstrak nama kota dari pesan menggunakan pola keyword dan daftar 500+ nama kota Indonesia dan internasional. Dipakai untuk menentukan apakah fetch cuaca perlu dilakukan.

#### `setUserContext(sender, key, val)` / `getUserContext(sender, key) → any`
Store context key-value per-user (in-memory). Dipakai untuk lacak hal seperti kota terakhir yang disebutkan user untuk query cuaca.

#### `hasWeatherIntent(msg) → boolean`
Return `true` kalau pesan mengandung keyword cuaca (cuaca, panas, hujan, weather, temperature, dll). Dikombinasikan dengan `extractCity()` untuk putuskan apakah perlu panggil weather API.

#### `cleanHtmlText(s) → string`
Strip HTML tag dan decode HTML entity dari hasil web search sebelum dimasukkan ke konteks AI.

#### `stripBotName(msg, botName) → string`
Hapus nama bot dari awal pesan (mis. `"Gicel, play sesuatu"` → `"play sesuatu"`). Diterapkan sebelum kirim ke AI biar model dapat input yang bersih.

#### `extractSearchQuery(msg) → string | null`
Parse query pencarian dari pesan seperti `"cari lagu jazz"`, `"search cara bikin pasta"`, `"tolong cariin tempat makan enak"`. Return string query atau `null` kalau ga ada intent pencarian.

#### `fetchSearchResults(query) → Promise<Array>`
Scrape hasil pencarian Bing untuk query. Return array `{ title, url, snippet }`. Dipakai kalau AI butuh informasi terkini.

#### `formatSearchContext(query, results) → string`
Format hasil scraping Bing jadi string konteks yang bersih, di-append ke system prompt AI untuk request saat ini.

#### `fetchWeather(cityName) → Promise<string>`
Fetch cuaca real-time dari Open-Meteo API (gratis, tanpa key). Return string terformat berisi suhu saat ini, kondisi cuaca, kelembaban, kecepatan angin, dan waktu lokal. Pakai geocoding untuk konversi nama kota ke koordinat.

#### `askAI(userMessage, senderName, botState) → Promise<string>`
Fungsi respons AI utama. Flow lengkap:
1. Strip nama bot dari awal pesan
2. Coba `tryFunApi()` dulu — kalau handle pesan (shalat, jokes, dll), return respons itu
3. Cek search intent → `fetchSearchResults()` → append konteks ke prompt
4. Cek weather intent → `extractCity()` → `fetchWeather()` → append konteks ke prompt
5. Load riwayat percakapan user
6. Bangun array messages: system prompt + memori + pesan baru
7. Panggil `callNIM()` dengan rotasi multi-key
8. Append kedua sisi ke memori dan simpan
9. Return reply asisten

#### `clearUserMemory(senderName)`
Hapus riwayat percakapan untuk user tertentu. Dipanggil kalau user bilang "lupain" atau "forget".

#### `clearAllMemory()`
Hapus riwayat percakapan semua user. Owner only.

#### `generateOnce(prompt, botState) → Promise<string>`
Panggilan AI sekali tanpa konteks memori. Dipakai untuk pesan welcome room saat join dan pesan one-off lainnya.

#### `parseCommandFromAI(reply, userMessage) → string | null`
Scan reply AI untuk pola `[CMD:!namacommand args]` dan ekstrak string command. Dipakai voice.js dan server.js untuk eksekusi command yang AI putuskan untuk dijalankan. Contoh: kalau AI reply `"Siap! [CMD:!play Playdate]"`, fungsi ini return `"!play Playdate"`.

---

### `commands.js`

Router command dan mesin musik. Handle semua parsing `!command`, manajemen antrian musik, dan efek audio.

#### `parseDuration(ts) → number`
Parse timestamp durasi YouTube (mis. `"3:45"`, `"1:02:30"`) ke total detik.

#### `formatSec(s) → string`
Format durasi dalam detik ke string yang bisa dibaca (`"3:45"`, `"1:02:30"`).

#### `buildBar(progress, width) → string`
Buat progress bar teks untuk display now-playing `!np`. Contoh: `"▓▓▓▓▓▓▒▒▒▒▒▒ 3:12 / 5:40"`.

#### `loadPlugins()`
Scan direktori `./plugins/` dan load setiap file `.js` sebagai plugin. Array `commands` tiap plugin didaftarkan ke command map. Plugin dengan command duplikat akan diingatkan. Dipanggil sekali saat startup.

#### `handleCommand(msg, ctx) → Promise<void>`
Dispatcher command utama. Dipanggil `server.js` untuk pesan yang diawali `!`. Parse nama command dan argumen, resolve handler (core atau plugin), cek permission, dan panggil.

Command core yang dihandle langsung:
- `!play`, `!search`, `!np`, `!skip`, `!stop`, `!queue`/`!q`, `!repeat`/`!r`, `!vol`, `!lirik`
- `!bass`, `!treble`, `!reverb`, `!8d`, `!speed`, `!nightcore`, `!vaporwave`, `!slowed`, `!fx`, `!fxreset`

#### `module.exports.updateUserMap(map)`
Update mapping UID→nama internal yang dipakai command yang referensikan user berdasarkan nama.

#### `module.exports.CORE_COMMANDS`
Array nama command yang dihandle native oleh commands.js. Dipakai plugin loader untuk deteksi konflik.

#### `module.exports.getPluginCommands() → Map`
Return plugin command map yang ter-load. Dipakai `help.js` untuk list semua command yang tersedia secara dinamis.

---

### `economy.js`

Layer akses data sistem ekonomi. Semua data ekonomi disimpan di `economy.json`.

#### `loadEconomyDB() → object`
Baca dan parse `economy.json`. Return objek database lengkap dengan semua record user.

#### `saveEconomyDB(db)`
Tulis database ekonomi kembali ke `economy.json`. Dipanggil setelah mutasi apapun.

#### `formatTime(ms) → string`
Konversi sisa cooldown dalam milidetik ke string yang bisa dibaca (`"5j 30m"`, `"45m 20d"`).

#### `random(min, max) → number`
Return bilangan bulat random antara `min` dan `max` (inklusif). Dipakai gambling, gacha, crime, dan hunting.

#### `getUser(db, userId, name) → object`
Return record ekonomi user dari database, buat record default baru kalau user belum ada. Record default: `coins: 0`, `xp: 0`, `level: 1`, `hp: 100`, `maxHp: 100`, `inventory: []`, `lastDaily: 0`.

#### `checkCooldown(lastTime, cooldownMs) → { ready, remaining }`
Cek apakah periode cooldown sudah lewat sejak `lastTime`. Return `{ ready: true }` kalau cooldown selesai, atau `{ ready: false, remaining: ms }` dengan sisa waktu.

#### `addXp(user, amount) → { leveledUp, newLevel }`
Tambahkan XP ke user dan cek level-up. Return `{ leveledUp: true, newLevel }` kalau XP crossing threshold level, kalau tidak `{ leveledUp: false }`.

---

### `fun_api.js`

Kumpulan integrasi API fun/utilitas. Semua fungsi diorkestrasikan oleh `tryFunApi()`.

#### `safeJsonFetch(url, opts) → Promise<object | null>`
Wrapper `fetch()` dengan error handling. Return JSON yang di-parse atau `null` saat gagal.

#### `extractShalatCity(msg) → string | null`
Ekstrak nama kota dari pesan yang tanya jadwal shalat. Kenali pola seperti `"jadwal sholat di Bandung"`, `"shalat Surabaya"`, dll.

#### `fetchShalat(city) → Promise<object>`
Fetch jadwal shalat hari ini untuk kota Indonesia dari API Kemenag. Return `{ fajr, sunrise, dhuhr, asr, maghrib, isha }`.

#### `formatShalat(d) → string`
Format objek jadwal shalat jadi pesan chat yang bisa dibaca.

#### `hasGombalIntent(msg) → boolean`
Deteksi kalau pesan minta pickup line/gombal. Kenali keyword seperti `"gombalin"`, `"rayuan"`, `"pick up line"`.

#### `getRandomGombal() → object` / `formatGombal(quote) → string`
Return gombal random dari list lokal, diformat sebagai lelucon dua bagian (setup → punchline).

#### `hasJokeIntent(msg) → boolean`
Deteksi kalau user minta jokes. Kenali `"jokes"`, `"cerita lucu"`, `"lawak"`, dll.

#### `fetchDadJoke() → Promise<object>`
Fetch jokes random dari icanhazdadjoke API.

#### `extractTodType(msg) → 'truth' | 'dare' | null`
Tentukan kalau user minta pertanyaan truth atau dare. Kenali phrasing Indonesia dan Inggris.

#### `fetchTod(type) → Promise<object>`
Fetch pertanyaan truth atau dare dari public API.

#### `extractRecipeQuery(msg) → string | null`
Ekstrak query makanan/resep dari pesan seperti `"resep nasi goreng"`, `"cara bikin soto ayam"`.

#### `fetchRecipe(query) → Promise<object | null>`
Cari resep dari TheMealDB API. Return resep pertama yang cocok dengan bahan, takaran, dan instruksi.

#### `formatRecipe(r) → string`
Format objek resep jadi pesan chat multi-baris dengan bahan dan langkah.

#### `hasAyatIntent(msg) → boolean`
Deteksi kalau user minta ayat Quran random. Kenali keyword seperti `"ayat quran"`, `"surah random"`.

#### `fetchAyat() → Promise<object>`
Fetch ayat Quran random dari Al-Quran Cloud API. Return ayat dalam bahasa Arab, terjemahan Indonesia, dan referensi surah + ayat.

#### `tryFunApi(userMessage) → Promise<string | null>`
Dispatcher utama untuk semua fungsi fun API. Cek pesan user terhadap semua detektor intent berurutan:
1. Jadwal shalat
2. Gombal / pickup line
3. Jokes
4. Truth or Dare
5. Resep
6. Ayat Quran

Return string respons yang sudah diformat kalau ada intent yang cocok, atau `null` kalau tidak ada (biar `askAI()` yang handle normal).

---

### `manager.js`

Entry point dan manajer multi-instance. Handle dashboard web UI, autentikasi user, dan lifecycle proses bot.

#### `patchUser(id, fn)`
Terapkan fungsi update ke record user di store in-memory. Dipakai untuk update status online, state bot, dll.

#### `allocPort() → number`
Alokasikan port berikutnya yang tersedia untuk IPC internal instance bot. Mulai dari port base dan increment.

#### `isRoomOccupied(roomUrl, exceptUserId) → boolean`
Cek apakah room URL tertentu sudah di-join oleh instance bot lain. Cegah dua bot join room yang sama bersamaan.

#### `cloneProfileIfNeeded(profileDir)`
Kalau direktori profil user belum ada, salin profil default dari `./profile/` sebagai titik awal. Ini pastikan setiap user bot punya sesi browser yang terisolasi.

#### `createInstance(userId, roomUrl)`
Spawn proses bot baru (child process `server.js`) untuk user dan room tertentu. Setup IPC (stdin/stdout JSON messaging) antara manager dan bot, forward log ke dashboard via Socket.IO.

#### `stopInstance(userId)`
Kirim sinyal stop ke proses bot user yang berjalan dan bersihkan entry instance.

#### `restartInstance(userId)`
Stop dan buat ulang instance bot. Dipakai kalau user ganti URL room atau restart manual dari dashboard.

#### `getBotStatus(userId) → object`
Return ringkasan status saat ini untuk bot user: online/offline, URL room, lagu yang diputar, panjang antrian.

#### `adminSnapshot() → object`
Return snapshot lengkap semua instance yang berjalan untuk panel admin — dipakai untuk render dashboard admin dengan state bot semua user.

#### `pushStatus(userId)`
Emit state bot saat ini ke semua client Socket.IO yang subscribe ke channel user tersebut.

---

### `plugins/`

Semua file plugin ikut interface yang sama:

```js
module.exports = {
    commands: ['namacommand', 'alias'],
    handle: async (cmd, args, msg, ctx) => { ... }
};
```

#### `activities.js`
Handle grinding berbasis aktivitas — aktivitas berdurasi tertentu yang kasih reward coins dan XP saat selesai.

#### `aimode.js`
Implementasi `!aimode on/off` — aktifkan atau nonaktifkan respons AI di text chat.

#### `cd.js`
Utilitas cooldown bersama yang dipakai plugin lain. Sediakan `startCooldown` dan `isOnCooldown`.

#### `crime.js`
Sistem crime. `!crime` coba aksi kriminal dengan probabilitas berhasil (reward coins) atau gagal (penalti coins). Berbasis cooldown.

#### `economy.js` (plugin)
Command facing ekonomi: `!daily`, `!balance`/`!bal`, `!give`, menggunakan fungsi data dari modul core `economy.js`.

#### `fx.js`
Semua command efek audio: `!bass`, `!treble`, `!reverb`, `!8d`, `!speed`, `!nightcore`, `!vaporwave`, `!slowed`, `!fx`, `!fxreset`. Modifikasi objek `botState.fx` yang dibaca chain pemrosesan audio di `commands.js`.

#### `gacha.js`
Sistem gacha pull. `!gacha` habiskan coins untuk item random dari loot table berjenjang (Common / Rare / Epic / Legendary).

#### `gambling.js`
Beberapa command gambling. Termasuk coin flip, dadu, dan tebak angka. Semua game taruhkan coins.

#### `grind_extra.js`
60+ pekerjaan grinding. Tiap pekerjaan punya nama, item equipment yang dibutuhkan, range reward coins, XP, dan cooldown. Contoh: `!farm` (butuh cangkul), `!fish` (butuh pancing), `!mine` (butuh pickaxe), `!code` (butuh laptop), `!barista` (butuh mesin kopi).

#### `help.js`
Command `!help`. Baca `CORE_COMMANDS` dan `getPluginCommands()` secara dinamis untuk bangun daftar command lengkap.

#### `rpg.js`
Sistem combat RPG. `!hunt` — konsumsi stamina dan senjata, reward coins dan XP, ada kemungkinan dapat item. `!heal` — pulihkan HP pakai potion (dari inventory) atau bayar coins. `!adventure` — event random dengan berbagai kemungkinan outcome.

#### `say.js`
`!say <teks>` — buat bot ngomong teks yang diberikan dengan suara di voice room via TTS. Owner/mod only.

#### `shop.js`
Toko item. `!shop` list semua item dengan harga. `!buy <item>` beli item dan tambahkan ke inventory. `!sell <item>` hapus item dan refund sebagian harga.

#### `tutorial.js`
`!tutorial` atau `!start` — kirim user baru walkthrough multi-pesan tentang command tersedia dan cara kerja sistem ekonomi.

#### `voicechat.js`
Command kontrol voice mode. `!voice on/off` — aktifkan atau nonaktifkan voice listening. `!talkmode on/off` — aktifkan atau nonaktifkan talk mode. Keduanya terbatas untuk Owner/Mod.

#### `who.js`
`!who` — list semua participant yang terhubung di room dengan nama dan role mereka.

---

## Voice Mode

### Wake Word Mode (default)

Sebut nama bot di awal kalimat, lalu ucapkan permintaan dalam kalimat yang sama:

```
"Gicel, sekarang jam berapa?"
"Hey Gicell, puterin Perfect dari Ed Sheeran"
"Gicell, stop musiknya dong"
```

Detektor wake word jalan 3 tahap:
1. **Direct** — nama bot literally ada di transcript?
2. **Normalized** — ada setelah normalisasi fonetik?
3. **Fuzzy** — ada token yang dalam jarak 1 edit distance dari nama bot?

Selain itu, meski wake word terdeteksi, bot tetap terapkan **strict trigger filter** — cek bahwa kalimatnya mengandung minimal satu "intent keyword" (verb atau penanda percakapan). Ini cegah trigger ga sengaja kalau orang cuma nyebut namanya tanpa niat minta sesuatu.

### Talk Mode

Hapus kebutuhan wake word. Semua yang ngomong di room langsung diproses dan direspons.

```
!talkmode on     → aktifkan
!talkmode off    → matikan
!talkmode        → toggle
```

Proteksi bawaan di talk mode:
- **Panjang minimum**: utterance di bawah 8 karakter diabaikan (block `"hmm"`, `"ok"`, `"iya"`)
- **Per-user cooldown**: 8 detik antar respons ke speaker yang sama
- **Anti-feedback**: selalu aktif, apapun mode-nya

---

## Referensi Command

### Musik

| Command | Cara pakai | Catatan |
|---|---|---|
| `!play` | `!play <judul atau URL>` | Tambah ke antrian; langsung play kalau antrian kosong |
| `!search` | `!search <judul>` | Tampilkan 10 hasil; pakai `!play <nomor>` untuk pilih |
| `!skip` | `!skip` | Requester bisa skip lagunya sendiri. Owner/mod bisa skip lagu siapapun |
| `!stop` | `!stop` | Stop playback dan bersihkan seluruh antrian. Owner/mod only |
| `!np` | `!np` | Tampilkan lagu yang diputar, progress bar, dan nama requester |
| `!queue` | `!queue` atau `!q` | List antrian saat ini dengan posisi |
| `!repeat` | `!repeat` atau `!r` | Toggle loop untuk lagu saat ini |
| `!vol` | `!vol <0-100>` | Atur volume. `!vol 0` mute, `!vol 100` penuh |
| `!lirik` | `!lirik` | Ambil dan tampilkan lirik lagu yang diputar (via Genius) |

### Efek Audio

| Command | Cara pakai | Catatan |
|---|---|---|
| `!bass` | `!bass <1-15>` atau `!bass off` | Boost frekuensi rendah |
| `!treble` | `!treble <1-15>` atau `!treble off` | Boost frekuensi tinggi |
| `!reverb` | `!reverb on/off` | Efek reverb (nuansa ruang besar/gua) |
| `!8d` | `!8d on/off` | Rotasi stereo (pakai headphone untuk efek terbaik) |
| `!speed` | `!speed <0.25-3.0>` | Kecepatan playback |
| `!nightcore` | `!nightcore` | Preset: speed 1.25x + treble boost |
| `!vaporwave` | `!vaporwave` | Preset: speed 0.8x + bass + reverb |
| `!slowed` | `!slowed` | Preset: speed 0.85x + bass ringan + reverb |
| `!fx` | `!fx` | Tampilkan semua efek yang aktif |
| `!fxreset` | `!fxreset` | Reset semua efek ke default |

### Ekonomi

| Command | Cara pakai | Catatan |
|---|---|---|
| `!daily` | `!daily` | Cooldown 24 jam, reward naik sesuai level |
| `!balance` | `!balance` atau `!bal` | Tampilkan coins, XP, dan level |
| `!shop` | `!shop` atau `!shop 2` | Browse halaman toko item |
| `!buy` | `!buy <nama item>` | Beli item dari toko |
| `!sell` | `!sell <nama item>` | Jual item, refund sebagian |
| `!inv` | `!inv` | Tampilkan inventory dan HP saat ini |
| `!give` | `!give <user> <jumlah>` | Transfer coins ke user lain |

### RPG

| Command | Cara pakai | Catatan |
|---|---|---|
| `!hunt` | `!hunt` | Butuh senjata di inventory dan HP > 20 |
| `!heal` | `!heal` | Pakai potion dari inventory atau bayar coins |
| `!adventure` | `!adventure` | Event random — bisa bagus atau buruk |
| `!grind` | `!grind <pekerjaan>` | 60+ pekerjaan, masing-masing butuh equipment tertentu |

### Kontrol Bot

| Command | Cara pakai | Catatan |
|---|---|---|
| `!voice` | `!voice` | Tampilkan status voice mode saat ini |
| `!voice on/off` | `!voice on` | Owner/mod only |
| `!talkmode` | `!talkmode` | Toggle talk mode |
| `!talkmode on/off` | `!talkmode on` | Paksa state tertentu. Owner/mod only |
| `!aimode` | `!aimode on/off` | Aktifkan/nonaktifkan AI di text chat |
| `!say` | `!say <teks>` | Bot ngomong di voice room. Owner/mod only |

---

## Plugin System

Plugin adalah file `.js` di `./plugins/` yang auto-load saat start. Kamu bisa tambah command baru tanpa sentuh file core sama sekali.

### Plugin dasar

```js
// plugins/ping.js
module.exports = {
    commands: ['ping'],
    handle: async (cmd, args, msg, ctx) => {
        await ctx.sendMessage('Pong!');
    }
};
```

### Plugin lengkap dengan permission dan ekonomi

```js
// plugins/flip.js
const eco = require('../economy');

module.exports = {
    commands: ['flip'],
    handle: async (cmd, args, msg, { sender, sendMessage, log }) => {
        const db   = eco.loadEconomyDB();
        const user = eco.getUser(db, sender.uid, sender.name);
        const bet  = parseInt(args) || 0;

        if (bet <= 0)          return sendMessage('Cara pakai: !flip <jumlah>');
        if (user.coins < bet)  return sendMessage(`Kamu cuma punya ${user.coins} coins.`);

        const menang = Math.random() < 0.5;
        user.coins   = menang ? user.coins + bet : user.coins - bet;
        eco.saveEconomyDB(db);

        log(`${sender.name} flip ${bet} → ${menang ? 'MENANG' : 'KALAH'}`, 'info');
        await sendMessage(menang
            ? `🪙 Heads! Kamu menang ${bet} coins. Saldo: ${user.coins}`
            : `💀 Tails! Kamu kalah ${bet} coins. Saldo: ${user.coins}`
        );
    }
};
```

### Referensi context object

| Property | Type | Keterangan |
|---|---|---|
| `cmd` | `string` | Nama command (mis. `'play'`, `'flip'`) |
| `args` | `string` | Semua teks setelah nama command |
| `msg` | `string` | Pesan asli lengkap |
| `sender.name` | `string` | Nama tampilan user yang kirim command |
| `sender.role` | `string` | Role: `'owner'`, `'moderator'`, `'member'` |
| `sender.uid` | `string` | ID unik user |
| `sendMessage(teks)` | `async Function` | Post teks ke chat room |
| `botState` | `object` | State bot bersama: `queue`, `nowPlaying`, `volume`, `fx`, dll |
| `page` | `Playwright Page` | Akses penuh ke browser page (advanced) |
| `log(msg, level)` | `Function` | Logger dashboard |
| `speakTTS(teks)` | `async Function` | Bot ngomong di voice room |
| `isTTSBusy()` | `Function` | Return `true` kalau TTS lagi diputar |

---

## Troubleshooting

### Bot join tapi chat ga ada respons sama sekali

WebSocket interceptor mungkin gagal ter-install. Cek di log apakah ada `[WS] Participant cache listener active`. Kalau tidak ada, format WebSocket Free4Talk mungkin berubah setelah update platform.

### Voice mode aktif tapi bot ga pernah respon

1. Cek `GROQ_API_KEYS` di `.env` — pastikan valid
2. Jalankan `!voice` di chat — konfirmasi status `ON`
3. Cek log dashboard untuk entry `[VOICE] Utterance dari ...` — kalau tidak muncul, hook audio capture tidak jalan
4. Sebut nama bot dengan jelas di awal kalimat, tunggu 1–2 detik setelah selesai ngomong

### `!play` ketemu lagu tapi audio tidak keluar

1. Pastikan yt-dlp jalan: `yt-dlp --version`
2. Update yt-dlp: `yt-dlp -U` — format YouTube sering berubah
3. Pastikan ffmpeg ter-install: `ffmpeg -version`
4. Cek log untuk entry `[MUSIC]` — akan keliatan persis di mana gagalnya

### STT latensi konsisten > 3 detik

- Cold start Groq free tier — normal, bukan masalah dari pihak kamu
- Tambahkan 2–3 `GROQ_API_KEYS` lagi untuk distribute load
- Cek [status.groq.com](https://status.groq.com) kalau ada issue layanan

### AI lambat atau timeout

- Tambahkan lebih banyak `NIM_API_KEYS` — rotasi otomatis
- NVIDIA NIM free tier bisa lambat di peak time
- Pertimbangkan ganti ke model yang lebih kecil/cepat di `ai.js` → `callNIM()`

### Sesi expired — bot ga bisa login

```bash
rm -rf ./profile/
npm run setup
```

### Dashboard ga bisa dibuka (port conflict)

Edit nomor port di `manager.js`. Cari `3000` dan ganti ke port lain yang bebas.

### "Cannot find module" waktu start

Jalankan `npm install` lagi. Kalau modul tertentu missing, install manual: `npm install <nama-modul>`.

---

## Kontribusi

PR disambut. Untuk perubahan besar, buka issue dulu untuk diskusi.

Guidelines:
- Command baru yang facing user taruh di `./plugins/` — jangan sentuh file core
- Ikuti gaya log yang ada: `log(pesan, 'info'|'success'|'warn'|'error')`
- Jalankan `node --check <file>.js` sebelum submit
- Test dengan setidaknya satu join room beneran untuk konfirmasi tidak ada yang rusak

---

## Changelog

Semua perubahan penting didokumentasikan di sini. Format mengacu pada [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

### [1.1.0] — 2026-05-02

#### 🐛 Perbaikan Bug
- **Volume musik kini persisten antar lagu** (commands.js, server.js)  
  !vol kini berfungsi dengan benar antar perpindahan lagu. Sebelumnya, mengatur volume di lagu pertama tidak berpengaruh ke lagu berikutnya — setiap lagu baru selalu reset ke volume default 10%. Penyebab: !vol hanya mengupdate window._audioElement.volume (elemen audio yang sedang diputar) tapi tidak mengupdate window._botVolume, yang merupakan nilai baseline yang dibaca saat setiap lagu baru dimulai. Fix: !vol kini mengupdate keduanya, dan window._botVolume diinisialisasi dengan benar di startup script audio pipeline.

---

### [1.0.0] — 2026-05-01

#### 🎉 Rilis Perdana
- Bot AI bersuara self-hosted untuk room Free4Talk
- STT real-time via Groq Whisper Large v3 dengan rotasi multi-key
- TTS via Microsoft Edge TTS (18+ pilihan suara)
- Deteksi wake word 3-tahap dengan fuzzy matching (tahan terhadap miskognisi Whisper)
- Talk Mode — bot merespons semua ucapan tanpa perlu wake word
- Streaming musik via yt-dlp langsung ke WebRTC sender track
- Cache URL stream 4 jam dengan pre-fetch background untuk lagu berikutnya
- Pencarian YouTube dengan yt-search, sistem queue lengkap
- AI chat NVIDIA NIM (Qwen 3.5 122B) dengan memori per-user
- Sistem Ekonomi & RPG (koin, XP, level, inventori, gacha)
- Sistem plugin — taruh file .js di plugins/ untuk tambah command
- Dashboard web via Express + Socket.IO
- CLI scaffolding 
px create-gicellbot <nama>
- Dipublikasikan ke npm sebagai [create-gicellbot](https://www.npmjs.com/package/create-gicellbot)

---

## Lisensi

[MIT](LICENSE) — bebas dipakai, dimodifikasi, dan didistribusikan.
