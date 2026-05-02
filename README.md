<div align="center">

# GicellBot

**A self-hosted AI voice bot for Free4Talk voice rooms**

[![npm](https://img.shields.io/npm/v/create-gicellbot?style=flat-square&color=cb3837)](https://www.npmjs.com/package/create-gicellbot)
[![npm downloads](https://img.shields.io/npm/dt/create-gicellbot?style=flat-square&label=downloads&color=blue)](https://www.npmjs.com/package/create-gicellbot)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![Free4Talk](https://img.shields.io/badge/platform-Free4Talk-purple?style=flat-square)](https://free4talk.com)

🇺🇸 English | [🇮🇩 Bahasa Indonesia](README.id.md)

</div>

---

GicellBot is a self-hosted, fully voice-capable AI bot built for [Free4Talk](https://free4talk.com) voice chat rooms. It uses real-time speech recognition to hear what people say, responds out loud through text-to-speech, streams music directly into the WebRTC voice room (no virtual audio device needed), and runs a full economy and RPG system in chat — all in one Node.js process.

**What makes it different from other bots:**
- Completely self-hosted — your data, your server, your keys
- Injects audio directly into WebRTC — no virtual microphone or soundcard needed
- Fuzzy wake word detection — handles Whisper STT misrecognitions like `"Gicil"`, `"Gitel"`, `"Cicel"` and still triggers correctly
- Talk Mode — skip the wake word, bot responds to everything in the room
- AI can execute bot commands from voice — say `"play Playdate"` and it triggers `!play`
- No monthly fees — Groq and NVIDIA NIM both have free tiers that cover normal usage

> Built and maintained by **Gilang Raja** ([@Gicelldev](https://github.com/Gicelldev))

**Quick start:**
```bash
npx create-gicellbot my-bot
cd my-bot && cp .env.example .env
# fill in .env with your API keys
npm run setup   # log into Free4Talk once
npm start
```

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [First Run](#first-run)
- [File Reference](#file-reference)
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
- [Commands Reference](#commands-reference)
- [Plugin System](#plugin-system)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)
- [License](#license)

---

## Features

### 🎙️ Voice Interaction
- Listens to all peers in the voice room via live WebRTC audio track interception
- Transcribes speech in real-time using **Groq Whisper Large v3** (2000 req/day free tier)
- **Wake word detection** with 3-stage fuzzy matching — handles Whisper misrecognitions
- **Talk Mode** — skip the wake word entirely, bot responds to all utterances in the room
- Speaks back using **Microsoft Edge TTS** (18+ voice options, no API key required)
- Anti-feedback loop — bot never responds to its own TTS output

### 🎵 Music
- Search YouTube via `yt-search` and stream audio with `yt-dlp`
- Audio injected directly into the WebRTC sender track via Web Audio API — no virtual device
- Stream URL cache (4h TTL) and pre-fetch for the next queued song
- Deduplication — prevents double yt-dlp calls for the same URL
- Full queue with position tracking and per-song requester name
- Progress messages: Searching → Preparing stream → Now Playing (fires on actual audio start, not on queue add)

### 🤖 AI Chat
- Powered by **NVIDIA NIM** (configurable model, default Qwen 3.5 122B)
- Per-user conversation memory — persisted across restarts in `ai_memory.json`
- Multi-key rotation with auto-failover on 429 or network errors
- Web search via Bing scraping — triggered automatically when user asks to search
- Real-time weather via Open-Meteo API (free, no key) — triggered by city + weather keywords
- Full fun pack: prayer times (Indonesia Kemenag API), jokes, truth/dare, recipes, random Quran verse
- AI can parse and execute bot commands from its own replies (`[CMD:!play ...]`)
- Relevance filter — skips responses when the message is clearly addressed to another user

### 🎮 Economy & RPG
- Virtual currency (coins) earned through work, gambling, crime
- Daily reward with 24h cooldown
- 60+ grinding jobs — each requires specific equipment
- Item shop with buy/sell
- Inventory management per user
- Leveling system with XP — bonus coins on level-up
- HP system for combat-based activities
- Gacha with rarity tiers, gambling games, crime system

---

## Architecture Overview

```
 User speaks
     │
     ▼
 WebRTC track (browser, Playwright)
     │   ScriptProcessorNode captures PCM chunks
     │   Encoded to WebM/Opus in-browser
     │   Sent to Node.js via page.exposeFunction
     ▼
 voice.js — handlePeerUtterance()
     │   Anti-feedback check (isTTSBusy)
     │   3-stage wake word detection
     │       1. Direct substring match
     │       2. Normalized phonetic match
     │       3. Fuzzy Levenshtein match (edit distance ≤ 1)
     ▼
 stt.js — transcribeAudio()
     │   Groq Whisper Large v3 API
     │   Multi-key round-robin rotation
     │   Auto-failover on 429/error
     ▼
 ai.js — askAI()
     │   System prompt + user memory
     │   fun_api.js — prayer times, jokes, truth/dare, recipes, Quran
     │   Web search (Bing scrape) if detected
     │   Weather fetch (Open-Meteo) if detected
     │   NVIDIA NIM API call
     │   parseCommandFromAI() → extracts [CMD:!...] from reply
     ▼
 server.js — speakTTS() + command execution
     │   tts.js — generateTTS() via msedge-tts
     │   Audio injected into WebRTC sender track
     │   Command parsed and routed to commands.js
     ▼
 Voice room — peers hear the reply
```

---

## System Requirements

### Hardware

| Component | Minimum | Recommended |
|---|---|---|
| **RAM** | 1 GB free | 2 GB free |
| **CPU** | 2 cores (x86_64) | 4+ cores |
| **Storage** | 1.5 GB free | 2 GB+ free |
| **Network** | Stable broadband | Low-latency ≤ 50ms |

> **RAM breakdown:** Chromium ~300–400 MB · Voice processing buffers ~150 MB · Music streaming ~50–100 MB · Node.js process ~100 MB. Total: ~700 MB – 750 MB under normal load. Less than 1 GB free RAM will cause lag or crashes under concurrent voice + music.

> **Storage breakdown:** `node_modules` ~300 MB · Playwright Chromium download ~400 MB · Audio temp files ~50 MB · Data files (memory, economy) ~5 MB. Plan for ~800 MB minimum, 1.5 GB comfortable.

### Operating System

| OS | Status | Notes |
|---|---|---|
| Windows 10 / 11 | ✅ Fully supported | Tested daily |
| Ubuntu 20.04 / 22.04 | ✅ Fully supported | Tested on 22.04 LTS |
| Debian 11+ | ✅ Should work | Install Playwright deps first |
| macOS 12+ | ✅ Should work | Less tested |
| ARM / Raspberry Pi | ⚠️ Not recommended | Chromium struggles on ARM |

On Debian/Ubuntu, you may need to install Playwright browser dependencies:
```bash
npx playwright install-deps chromium
```

### Software

| Software | Version | Required For |
|---|---|---|
| **Node.js** | ≥ 18.0.0 | Runtime |
| **npm** | ≥ 8.0.0 | Package management |
| **yt-dlp** | Latest | YouTube audio extraction |
| **ffmpeg** | Any recent | Audio processing (yt-dlp dep) |

**Installing yt-dlp:**
```bash
# Windows (via winget)
winget install yt-dlp

# Windows (via pip)
pip install yt-dlp

# Linux
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# macOS
brew install yt-dlp
```

**Installing ffmpeg:**
```bash
# Windows
winget install ffmpeg

# Linux
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

> **Keep yt-dlp updated.** YouTube changes its internal format regularly, which breaks older yt-dlp versions. Run `yt-dlp -U` every few weeks to avoid music stream failures.

### API Accounts

All APIs used by GicellBot have free tiers. You do not need to pay for anything to run the bot normally.

| Service | What It Does | Free Tier Limit | Sign Up |
|---|---|---|---|
| **Groq** | Speech-to-Text (Whisper Large v3) | 2,000 requests/day per key | [console.groq.com](https://console.groq.com) |
| **NVIDIA NIM** | AI chat responses | Varies by model (~1,000/day) | [build.nvidia.com](https://build.nvidia.com) |
| **Free4Talk** | The platform the bot runs in | Free account | [free4talk.com](https://free4talk.com) |
| **Open-Meteo** | Real-time weather data | Unlimited (no key needed) | Auto-used |
| **Kemenag API** | Indonesian prayer times | Unlimited (no key needed) | Auto-used |
| **Genius** | Song lyrics | Public scraping | Auto-used |

---

## Installation

### Option A — npx (recommended)

```bash
npx create-gicellbot my-bot
cd my-bot
```

Downloads the package from npm, copies all files, runs `npm install`, and prints next steps. Zero manual file management.

### Option B — Clone from GitHub

```bash
git clone https://github.com/Gicelldev/free4talkbot.git my-bot
cd my-bot
npm install
```

### After either option — install Playwright's Chromium

```bash
npx playwright install chromium
```

This downloads the ~400 MB Chromium binary that Playwright uses. Only needs to be done once.

---

## Configuration

### `.env` — all credentials and settings

```bash
cp .env.example .env
```

```env
# ─────────────────────────────────────────────────────────────
#  GROQ — Speech-to-Text (Whisper)
#  Free at https://console.groq.com
#  Add multiple keys separated by commas for higher daily quota.
#  Keys are used in round-robin and auto-skip on rate limit.
# ─────────────────────────────────────────────────────────────
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3

# ─────────────────────────────────────────────────────────────
#  NVIDIA NIM — AI Chat
#  Free at https://build.nvidia.com
#  Multiple keys rotate automatically on 429/error.
# ─────────────────────────────────────────────────────────────
NIM_API_KEYS=nvapi-key1,nvapi-key2

# ─────────────────────────────────────────────────────────────
#  Room to join on bot start
#  Leave blank to set from the dashboard after starting.
# ─────────────────────────────────────────────────────────────
ROOM_URL=https://www.free4talk.com/room/ROOM_ID?key=ROOM_KEY

# ─────────────────────────────────────────────────────────────
#  Bot display name — must match the Free4Talk account name.
#  Also used as the wake word for voice mode.
# ─────────────────────────────────────────────────────────────
BOT_NAME=GicellBot
```

### `account.json`

```json
{ "username": "YourBotName" }
```

Must match the exact display name of the Free4Talk account the bot logs into.

### `roles.json`

```json
{
  "owners": ["USER_UID_HERE"],
  "mods":   ["USER_UID_HERE"]
}
```

UIDs are shown in the bot dashboard logs when a user joins the room. Owners and mods can use restricted commands like `!skip` (other requester's song), `!stop`, `!voice on/off`, `!talkmode`.

### `ai.js` — system prompt

Edit the `buildSystemPrompt(botName)` function to customize the AI's persona, knowledge, and rules. The function receives `botName` and should return a template string. The default is intentionally minimal — add whatever personality, rules, and context you need.

---

## First Run

### Step 1 — Log into Free4Talk

```bash
npm run setup
```

Opens a real Chromium browser window. Log in to the Free4Talk account you want the bot to use. The session is saved to `./profile/` and reused automatically on every subsequent start. You only need to do this once — or again if the session expires.

> Keep the `./profile/` folder. Deleting it means the bot can't log in automatically and you'll need to run setup again.

### Step 2 — Start the bot

```bash
npm start
```

On start, the bot:
1. Launches a headless Chromium instance via Playwright
2. Loads the saved session from `./profile/`
3. Navigates to the room specified in `ROOM_URL`
4. Dismisses the camera/mic permission interstitial
5. Sets up the WebSocket chat interceptor
6. Sets up WebRTC audio track interception for voice listening
7. Starts the MutationObserver for text chat messages
8. Enters the room and sends an AI-generated welcome message

### Step 3 — Access the dashboard

Open `http://localhost:3000` (or the port printed on startup). The dashboard lets you:
- View structured live logs (color-coded by level)
- Change the room URL without restarting
- Start and stop the bot
- See active queue entries
- View connected participants

---

## File Reference

This section documents every major function in each file.

---

### `server.js`

The core of the bot. Handles the browser session, room joining, chat interception, music streaming, TTS playback, and WebRTC setup. ~2100 lines.

#### `getStreamUrl(videoUrl) → Promise<string>`
Fetches the direct audio stream URL for a YouTube video using `yt-dlp`. Includes:
- **4-hour cache** (`_streamUrlCache`) — avoids re-fetching the same URL on skip/replay
- **Request deduplication** (`_pendingFetches`) — prevents two concurrent yt-dlp calls for the same video
- Format priority: `140` (m4a 128k) → `251` (opus) → `250` (opus low) → best audio

#### `preFetchNextSong()`
Called immediately after a song starts playing. Silently fetches the stream URL for the next song in queue, so when skip/transition happens, the URL is already cached and playback starts instantly.

#### `loadRoles()` / `applyStaticRoles()`
Reads `roles.json` and grants Owner/Mod status to users by UID. `applyStaticRoles` re-applies roles to already-connected participants (called after roles.json changes at runtime).

#### `log(msg, type)`
Structured logger. Types: `'info'` (blue) | `'success'` (green) | `'warn'` (yellow) | `'error'` (red) | `'cmd'` | `'ai'`. Logs appear in the dashboard via Socket.IO emit.

#### `updateStatus()`
Broadcasts the current bot state (room URL, volume, now playing, queue length, voice status) to all connected dashboard clients.

#### `updateParticipants()`
Reads connected user elements from the DOM, extracts UIDs and display names, emits the participant list to the dashboard. Called on MutationObserver triggers.

#### `checkEmptyRoom()`
Starts a 30-second countdown when the room becomes empty (all humans leave). If still empty after 30s, the bot leaves automatically.

#### `leaveRoom(reason)`
Gracefully exits the room — stops music, mutes mic, clicks the leave button, emits the offline status. Called on empty room timeout or `!leave` command.

#### `normalizeMsg(text) → string`
Cleans incoming chat messages — strips zero-width characters, normalizes Unicode, trims whitespace. Used before any message processing.

#### `nameOf(uid) → string` / `roleOf(uid) → string`
Resolves a peer socket ID or UID to a display name or role by looking up the internal participant cache (`botState.participants`).

#### `resolveRole(raw) → string`
Normalizes raw role strings from the Free4Talk DOM (`'Owner'`, `'Moderator'`, `'Member'`, etc.) to a consistent lowercase key.

#### `sendMessage(text)`
Posts a text message to the Free4Talk room chat. Uses Playwright to type into the chat input and submit. Handles the case where the input is not yet visible by waiting for it.

#### `recordChat(name, text)`
Appends a chat message to `botState.chatHistory` (rolling 20-message buffer), used as context for the AI relevance filter.

#### `isAddressedToOtherUser(text, participants) → boolean`
Returns `true` if the message appears to be directed at a specific other user (e.g. contains another participant's name). Used to skip AI responses when the message is clearly not meant for the bot.

#### `hasActiveUserConversation(currentSender) → boolean`
Returns `true` if another user is in an active back-and-forth conversation with the bot. Prevents the bot from interjecting when someone else is mid-conversation.

#### `checkAIRelevance(text, botName, senderName, participants, muteUntil) → boolean`
Master relevance gate for AI responses. Returns `true` if the bot should respond to this message. Checks:
- Is voice TTS currently busy? (skip to avoid feedback)
- Is it a command (`!...`)? (commands are handled by commands.js, not AI)
- Is it too short (< 3 chars)?
- Is it addressed to another user?
- Is it from the bot itself?
- Is there an active conversation with someone else?

#### `handleChatMessage(chatData)`
Main handler for incoming room chat messages. Called by the WebSocket interceptor. Processes in this order:
1. Ignore own messages
2. Normalize and clean the text
3. Detect and execute `!commands`
4. Check AI relevance gate
5. If AI mode on, send to `askAI()` and post the response to chat

#### `parseChatPayload(eventName, data) → { name, text, uid } | null`
Parses incoming WebSocket event payloads into a normalized `{ name, text, uid }` object. Handles different Free4Talk message formats (system events, user messages, room join notifications).

#### `setupWSInterceptor()`
Injects JavaScript into the browser page to intercept WebSocket messages at the socket.io level. Exposes a `window.__onWsMessage(eventName, data)` bridge that calls Node.js via `page.exposeFunction`. This is how the bot reads chat messages without polling the DOM.

#### `scanRoomParticipants()`
Scans the DOM for all currently connected participant tiles, extracts their UID, name, and role. Updates `botState.participants`. Called on join and on MutationObserver changes to the participant container.

#### `unmuteMic()` / `muteMic()`
Clicks the microphone toggle button in the Free4Talk UI. `unmuteMic` waits for the "Turn ON your microphone" prompt and confirms it. Called before music starts and after it ends.

#### `speakTTS(text, opts)`
Full TTS pipeline:
1. Strips emojis and markdown from text
2. Calls `tts.js → generateTTS()` to get an audio buffer
3. Unmutes mic if not already
4. Injects the audio buffer as a `Blob URL` into the page
5. Plays it through the injected `AudioContext` connected to the WebRTC sender
6. Sets `_ttsBusy = true` during playback to block voice input
7. Calls the callback when done

#### `isTTSBusy() → boolean`
Returns whether TTS audio is currently playing. Voice processing checks this to avoid the bot hearing itself.

#### `clearPendingSongRequests()`
Clears all pending message queue entries that are waiting for the current song to finish. Called on `!stop`.

#### `stopAudio()`
Stops all audio playback — disconnects the current AudioContext source, stops the `<audio>` element, and sets `botState.nowPlaying = null`.

#### `playNext()`
Dequeues the next song from `botState.queue` and calls `startStream()`. Handles the transition between songs including pre-fetch triggering.

#### `startStream(song)`
The full music playback pipeline:
1. Unmutes mic
2. Calls `getStreamUrl()` to get the direct audio URL
3. Creates an `<audio>` element in the page
4. Connects it: `<audio>` → `MediaElementSourceNode` → `GainNode` → `AudioContext.destination`
5. Also connects to the WebRTC sender's `MediaStreamDestination` so it streams into the room
6. Monitors `timeupdate` — sends "Now Playing" message when audio actually starts
7. On `ended` — calls `playNext()` or stops if queue is empty

---

### `voice.js`

Handles the voice conversation pipeline — from receiving raw audio chunks to orchestrating STT, wake word detection, AI response, and TTS.

#### `normalizeForWakeWord(text) → { normal, compact }`
Pre-processes a raw Whisper transcript before wake word matching. This is the most important function for making voice detection robust. It handles:
- Removes punctuation, lowercases
- Maps common misrecognition patterns: `gh→g`, `ch→c`, `eo→el`, `al-ending→el-ending`
- Removes hyphens (Whisper sometimes outputs `"ghi-cheo"` instead of `"gicel"`)
- `compact` version: merges short tokens (≤3 chars) that might be split parts of the bot's name (e.g. `["gi", "cel"]` → `"gicel"`)

#### `buildWakeWordSet(botName) → Set<string>`
Generates all phonetic variants of the bot name that should count as a wake word. For a bot named "Gicell", this generates variants like: `gicell`, `gicel`, `gijel`, `kicel`, `jicel`, `cicel`, `gicol`, `gisal`, `giçel` and many more — covering the space of likely Whisper transcription errors.

#### `levenshtein(a, b) → number`
Computes the edit distance (Levenshtein distance) between two strings. Used by `findFuzzyMatch` to catch wake word variations that aren't in the pre-generated set.

#### `findFuzzyMatch(tokens, wakeWords) → boolean`
For each word in the token list, checks if any word in `wakeWords` is within Levenshtein distance 1. This catches completely unexpected variants (e.g. `"Bicel"`) that aren't in the pre-generated phonetic set.

#### `detectWakeWord(transcript, wakeWords) → boolean`
The 3-stage wake word detector:
1. **Direct**: Is any `wakeWord` a substring of the raw transcript?
2. **Normalized**: Is any `wakeWord` a substring of the normalized transcript?
3. **Fuzzy**: Does `findFuzzyMatch` return true against the transcript tokens?
Returns `true` if any stage matches.

#### `stripEmojisForTTS(text) → string`
Removes all emoji characters from text before passing it to the TTS engine. Without this, Edge TTS reads emoji names out loud (e.g. "thinking face, grinning face").

#### `handlePeerUtterance(payload, ctx) → Promise<void>`
Main entry point — called by `server.js` for every peer audio chunk that passes the silence threshold. Full pipeline:
1. Check `isTTSBusy()` — skip if bot is currently speaking (anti-feedback)
2. Check minimum audio duration (< 1.5s → skip noise)
3. Check global reply cooldown (3s after last reply)
4. Send audio buffer to `stt.js → transcribeAudio()`
5. Check minimum transcript length (< 3 chars → skip)
6. Check maximum transcript length (> 500 chars → skip as anomaly)
7. **Talk Mode path**: if `botState.voiceTalkMode`, check per-track cooldown (8s) and min length (8 chars), then directly call AI
8. **Wake Word path**: call `detectWakeWord()` → check `STRICT_TRIGGERS` → call AI
9. Send AI reply to `speakTTS()`
10. Parse `[CMD:!...]` from AI reply and execute via command router
11. Update cooldown timestamps

#### `getVoiceStatus() → object`
Returns the current voice module state for the dashboard: whether STT keys are configured, key count, whether voice is active, talk mode status.

---

### `stt.js`

Handles audio transcription via the Groq Whisper API.

#### `nextGroqKey() → string | null`
Round-robin key selector. Starts at a random offset (to prevent multiple instances colliding on the same key) and advances the cursor on each call. Returns `null` if no keys are configured.

#### `transcribeAudio(audioBuffer, opts) → Promise<string>`
Sends an audio buffer to Groq Whisper for transcription. Parameters:
- `audioBuffer`: `Buffer` — raw audio data in any Whisper-supported format (WebM/Opus, MP3, WAV, M4A)
- `opts.lang`: language hint (`'id'` for Indonesian by default)
- `opts.mime`: MIME type of the audio (`'audio/webm'` by default)

Behavior:
- Tries each key in rotation
- On `429` (rate limit): skips to next key immediately
- On `401/403` (invalid key): logs warning and tries next key
- On other errors: logs and continues rotation
- If all keys fail: throws the last error

Returns the transcript as a trimmed string, or `''` if transcription returned empty.

#### `hasValidKeys() → boolean`
Returns `true` if at least one Groq API key is configured and not a placeholder.

#### `keyCount() → number`
Returns the number of valid Groq API keys loaded.

---

### `tts.js`

Text-to-speech generation using Microsoft Edge TTS (`msedge-tts`).

#### `sanitize(text) → string`
Prepares text for TTS:
- Strips emoji (emoji names would be read out loud)
- Removes markdown bold/italic markers (`**`, `*`, `_`)
- Removes code fences
- Collapses multiple spaces and newlines
- Trims result

#### `generateTTS(text, opts) → Promise<Buffer>`
Generates speech audio from text. Parameters:
- `text`: the text to speak (sanitized automatically)
- `opts.voice`: Edge TTS voice name (default: `id-ID-GadisNeural` — Indonesian female)
- `opts.rate`: speaking rate (`+0%` to `+50%`, default `+0%`)
- `opts.pitch`: pitch adjustment (default `+0Hz`)

Returns a `Buffer` containing the audio data (MP3 format). The buffer is returned in-memory — no temp files written to disk.

Available voice options for Indonesian: `id-ID-GadisNeural` (F), `id-ID-ArdiNeural` (M).  
Available for English: `en-US-AriaNeural`, `en-US-GuyNeural`, and 30+ others.

---

### `ai.js`

The AI chat brain. Manages conversation memory, builds prompts, calls the NIM API, handles web search and weather, and parses commands from AI replies.

#### `nextApiKey() → string`
Round-robin NIM API key selector — same strategy as `nextGroqKey()` in stt.js.

#### `callNIM(messages, opts) → Promise<string>`
Low-level NIM API wrapper. Parameters:
- `messages`: array of `{ role, content }` objects (OpenAI chat format)
- `opts.max_tokens`: max response length (default 512)
- `opts.temperature`: randomness (default 0.85)

Tries each key with auto-rotation on 429/error. Returns the assistant's reply string.

#### `loadMemory() → object` / `saveMemory(memory)`
Reads/writes `ai_memory.json`. The memory object maps `senderName → [{ role, content }, ...]` conversation history arrays. Memory is loaded once on startup and written to disk after each conversation turn.

#### `buildSystemPrompt(botName) → string`
Constructs the system prompt passed to the NIM model on every request. The default is a minimal template — edit this function to define the bot's personality, rules, knowledge, and available commands.

#### `extractCity(msg) → string | null`
Extracts a city name from a message using keyword patterns and a 500+ city name list covering Indonesian and international cities. Used to determine whether to trigger a weather fetch.

#### `setUserContext(sender, key, val)` / `getUserContext(sender, key) → any`
Per-user key-value context store (in-memory). Used to track things like a user's last mentioned city for weather queries.

#### `hasWeatherIntent(msg) → boolean`
Returns `true` if the message contains weather-related keywords (cuaca, panas, hujan, weather, temperature, etc.). Combined with `extractCity()` to decide whether to call the weather API.

#### `cleanHtmlText(s) → string`
Strips HTML tags and decodes HTML entities from web search results before including them in the AI context.

#### `stripBotName(msg, botName) → string`
Removes the bot's name from the beginning of a message (e.g. `"Gicel, play something"` → `"play something"`). Applied before sending the message to AI so the model gets clean input.

#### `extractSearchQuery(msg) → string | null`
Parses a search query from messages like `"cari lagu jazz"`, `"search how to make pasta"`, `"tolong cariin tempat makan enak"`. Returns the query string or `null` if no search intent detected.

#### `fetchSearchResults(query) → Promise<Array>`
Scrapes Bing search results for the query. Returns an array of `{ title, url, snippet }` objects. Used when the AI needs current information (news, facts, recent events).

#### `formatSearchContext(query, results) → string`
Formats the scraped search results into a clean context string that gets appended to the AI's system prompt for the current request.

#### `fetchWeather(cityName) → Promise<string>`
Fetches real-time weather from the Open-Meteo API (free, no key). Returns a formatted string with current temperature, weather condition, humidity, wind speed, and local time. Uses geocoding to convert city name to coordinates.

#### `askAI(userMessage, senderName, botState) → Promise<string>`
Main AI response function. Full flow:
1. Strip bot name from start of message
2. Try `tryFunApi()` first — if it handles the message (prayer times, jokes, etc.), return that response
3. Check for search intent → `fetchSearchResults()` → append context to prompt
4. Check for weather intent → `extractCity()` → `fetchWeather()` → append context to prompt
5. Load user's conversation history
6. Build messages array: system prompt + memory + new message
7. Call `callNIM()` with multi-key rotation
8. Append both sides to memory and save
9. Return the assistant's reply

#### `clearUserMemory(senderName)`
Wipes the conversation history for a specific user. Called when the user says "forget" or "lupain semua".

#### `clearAllMemory()`
Wipes conversation history for all users. Owner-only.

#### `generateOnce(prompt, botState) → Promise<string>`
One-shot AI call without memory context. Used for the room welcome message on join and for other one-off generated messages.

#### `parseCommandFromAI(reply, userMessage) → string | null`
Scans the AI's reply for `[CMD:!commandname args]` patterns and extracts the command string. Used by voice.js and server.js to execute commands the AI decides to run. For example, if the AI replies `"Siap! [CMD:!play Playdate]"`, this returns `"!play Playdate"`.

---

### `commands.js`

The command router and music engine. Handles all `!command` parsing, music queue management, and audio effects.

#### `parseDuration(ts) → number`
Parses a YouTube duration timestamp (e.g. `"3:45"`, `"1:02:30"`) into total seconds.

#### `formatSec(s) → string`
Formats a duration in seconds to a human-readable string (`"3:45"`, `"1:02:30"`).

#### `buildBar(progress, width) → string`
Builds a text progress bar for the `!np` now-playing display. Example: `"▓▓▓▓▓▓▒▒▒▒▒▒ 3:12 / 5:40"`.

#### `loadPlugins()`
Scans `./plugins/` directory and loads every `.js` file as a plugin. Each plugin's `commands` array is registered in the command map. Duplicate commands across plugins are warned about. Called once on startup.

#### `handleCommand(msg, ctx) → Promise<void>`
Main command dispatcher. Called by `server.js` for any message starting with `!`. Parses the command name and arguments, resolves the handler (core or plugin), checks permissions, and calls it.

Core commands handled directly:
- `!play`, `!search`, `!np`, `!skip`, `!stop`, `!queue`/`!q`, `!repeat`/`!r`, `!vol`, `!lirik`
- `!bass`, `!treble`, `!reverb`, `!8d`, `!speed`, `!nightcore`, `!vaporwave`, `!slowed`, `!fx`, `!fxreset`

#### `module.exports.updateUserMap(map)`
Updates the internal UID→name mapping used by commands that reference users by name (e.g. `!give`).

#### `module.exports.CORE_COMMANDS`
Array of command names handled natively by commands.js (as opposed to plugins). Used by the plugin loader to detect conflicts.

#### `module.exports.getPluginCommands() → Map`
Returns the loaded plugin command map. Used by `help.js` to dynamically list all available commands.

---

### `economy.js`

Data access layer for the economy system. All economy data is stored in `economy.json`.

#### `loadEconomyDB() → object`
Reads and parses `economy.json`. Returns the full database object with all user records.

#### `saveEconomyDB(db)`
Writes the economy database back to `economy.json`. Called after any mutation (buying, earning, spending, etc.).

#### `formatTime(ms) → string`
Converts a remaining cooldown in milliseconds to a human-readable string (`"5h 30m"`, `"45m 20s"`). Used in cooldown messages.

#### `random(min, max) → number`
Returns a random integer between `min` and `max` (inclusive). Used by gambling, gacha, crime, and hunting.

#### `getUser(db, userId, name) → object`
Returns a user's economy record from the database, creating a fresh default record if the user doesn't exist yet. Default record includes: `coins: 0`, `xp: 0`, `level: 1`, `hp: 100`, `maxHp: 100`, `inventory: []`, `lastDaily: 0`.

#### `checkCooldown(lastTime, cooldownMs) → { ready, remaining }`
Checks if a cooldown period has passed since `lastTime`. Returns `{ ready: true }` if the cooldown is over, or `{ ready: false, remaining: ms }` with the remaining time.

#### `addXp(user, amount) → { leveledUp, newLevel }`
Adds XP to a user and checks for level-up. Returns `{ leveledUp: true, newLevel }` if the XP push crossed a level threshold, otherwise `{ leveledUp: false }`.

---

### `fun_api.js`

Collection of fun/utility API integrations. All functions are orchestrated by `tryFunApi()`.

#### `safeJsonFetch(url, opts) → Promise<object | null>`
Wrapper around `fetch()` with error handling. Returns parsed JSON or `null` on failure. Used by all API-fetching functions.

#### `extractShalatCity(msg) → string | null`
Extracts a city name from messages asking for prayer times. Recognizes patterns like `"jadwal sholat di Bandung"`, `"shalat Surabaya"`, etc.

#### `fetchShalat(city) → Promise<object>`
Fetches today's prayer schedule for an Indonesian city from the Kemenag (Ministry of Religious Affairs) API. Returns `{ fajr, sunrise, dhuhr, asr, maghrib, isha }`.

#### `formatShalat(d) → string`
Formats the prayer schedule object into a readable chat message with prayer names and times.

#### `hasGombalIntent(msg) → boolean`
Detects if the user's message is asking for a pickup line / gombal (Indonesian romantic joke). Recognizes keywords like `"gombalin"`, `"rayuan"`, `"pick up line"`.

#### `getRandomGombal() → object` / `formatGombal(quote) → string`
Returns a random gombal from a local list, formatted as a two-part joke (setup → punchline).

#### `hasJokeIntent(msg) → boolean`
Detects if the user is asking for a joke. Recognizes `"jokes"`, `"cerita lucu"`, `"lawak"`, etc.

#### `fetchDadJoke() → Promise<object>`
Fetches a random joke from the icanhazdadjoke API. Returns `{ setup, punchline }` or a single-line joke string.

#### `extractTodType(msg) → 'truth' | 'dare' | null`
Determines if the user is asking for a truth or dare question. Recognizes both English and Indonesian phrasings.

#### `fetchTod(type) → Promise<object>`
Fetches a truth or dare question from a public API.

#### `extractRecipeQuery(msg) → string | null`
Extracts a food/recipe query from messages like `"resep nasi goreng"`, `"cara bikin soto ayam"`, `"how to make pasta"`.

#### `fetchRecipe(query) → Promise<object | null>`
Searches for a recipe from TheMealDB API. Returns the first matching recipe with ingredients, measurements, and instructions.

#### `formatRecipe(r) → string`
Formats a recipe object into a readable multi-line chat message with ingredients and steps.

#### `hasAyatIntent(msg) → boolean`
Detects if the user is asking for a random Quran verse. Recognizes keywords like `"ayat quran"`, `"surah random"`, `"quran verse"`.

#### `fetchAyat() → Promise<object>`
Fetches a random Quran verse from the Al-Quran Cloud API. Returns the verse in Arabic, Indonesian translation, and surah + ayat reference.

#### `tryFunApi(userMessage) → Promise<string | null>`
Master dispatcher for all fun API functions. Checks the user's message against all intent detectors in priority order:
1. Prayer times
2. Gombal / pickup lines
3. Jokes
4. Truth or Dare
5. Recipes
6. Quran verse

Returns the formatted response string if any intent matched, or `null` if nothing matched (letting `askAI()` handle it normally).

---

### `manager.js`

The entry point and multi-instance manager. Handles the dashboard web UI, user authentication, and bot process lifecycle management.

#### `patchUser(id, fn)`
Applies an update function to a user record in the in-memory user store. Used for updating online status, bot state, etc.

#### `allocPort() → number`
Allocates the next available port for a bot instance's internal IPC. Starts from a base port and increments.

#### `isRoomOccupied(roomUrl, exceptUserId) → boolean`
Checks if a given room URL is already being joined by another bot instance. Prevents two bots from joining the same room simultaneously.

#### `cloneProfileIfNeeded(profileDir)`
If the user's profile directory doesn't exist, copies the default profile from `./profile/` as a starting point. This ensures each user's bot has its own isolated browser session.

#### `copyDirSync(src, dest)`
Synchronous recursive directory copy. Used by `cloneProfileIfNeeded`.

#### `createInstance(userId, roomUrl)`
Spawns a new bot process (a child process running `server.js`) for a given user and room. This is the launchpad for a new bot session. Sets up IPC (stdin/stdout JSON messaging) between manager and bot, forwards logs to the dashboard via Socket.IO.

#### `stopInstance(userId)`
Sends a stop signal to a user's running bot process and cleans up the instance entry.

#### `restartInstance(userId)`
Stops and re-creates a bot instance. Used when the user changes the room URL or manually restarts from the dashboard.

#### `getBotStatus(userId) → object`
Returns the current status summary for a user's bot: online/offline, room URL, now playing, queue length.

#### `adminSnapshot() → object`
Returns a full snapshot of all running instances for the admin panel — used to render the admin dashboard with all users' bot states.

#### `pushStatus(userId)`
Emits the current bot status to all Socket.IO clients subscribed to that user's channel.

---

### `plugins/`

All plugin files follow the same interface:

```js
module.exports = {
    commands: ['commandname', 'alias'],
    handle: async (cmd, args, msg, ctx) => { ... }
};
```

#### `activities.js`
Handles activity-based grinding — timed activities that reward coins and XP on completion. Each activity has a duration, cost to start, and a reward range.

#### `aimode.js`
Implements `!aimode on/off` — enables or disables AI responses in text chat. When off, the bot processes commands but ignores conversational messages.

#### `cd.js`
Shared cooldown utility used by other plugins. Provides `startCooldown(userId, key, ms)` and `isOnCooldown(userId, key)` functions accessible to other plugins.

#### `crime.js`
Crime system. `!crime` attempts a criminal act with some probability of success (coins reward) or failure (coin penalty). Cooldown-based. Success/fail text is random from a list.

#### `economy.js` (plugin)
Implements economy-facing commands: `!daily`, `!balance`/`!bal`, `!give`, using the data functions from `economy.js` (core module).

#### `fx.js`
All audio effect commands: `!bass`, `!treble`, `!reverb`, `!8d`, `!speed`, `!nightcore`, `!vaporwave`, `!slowed`, `!fx`, `!fxreset`. Modifies `botState.fx` object which is read by the audio processing chain in `commands.js`.

#### `gacha.js`
Gacha pull system. `!gacha` spends coins for a randomized item pull from a tiered loot table (Common / Rare / Epic / Legendary).

#### `gambling.js`
Multiple gambling commands. Includes coin flip, dice roll, and number guessing. All games risk coins with configurable multipliers.

#### `grind_extra.js`
60+ grinding jobs. Each job has a name, required equipment item, coin reward range, XP, and cooldown. Example jobs: `!farm` (needs hoe), `!fish` (needs fishing rod), `!mine` (needs pickaxe), `!code` (needs laptop), `!barista` (needs coffee machine).

#### `help.js`
`!help` command. Dynamically reads `CORE_COMMANDS` and `getPluginCommands()` to build a full command list. Groups commands by category.

#### `rpg.js`
RPG combat system. `!hunt` — consumes stamina and a weapon, rewards coins and XP, chance of finding items. `!heal` — restores HP using potions (from inventory) or paying coins. `!adventure` — random event with varying outcomes.

#### `say.js`
`!say <text>` — makes the bot speak the given text out loud in the voice room via TTS. Owner/mod only.

#### `shop.js`
Item shop. `!shop` lists all available items with prices. `!buy <item>` purchases an item and adds it to inventory. `!sell <item>` removes an item and refunds partial value. Item database is hardcoded in the plugin with name, price, description, and category.

#### `tutorial.js`
`!tutorial` or `!start` — sends new users a multi-message walkthrough of available commands and how the economy system works.

#### `voicechat.js`
Voice mode control commands. `!voice on/off` — enables or disables voice listening. `!talkmode on/off` — enables or disables talk mode. Both commands are restricted to Owner/Mod.

#### `who.js`
`!who` — lists all currently connected participants in the room with their names and roles.

---

## Voice Mode

### Wake Word Mode (default)

Say the bot name at the start of your utterance, followed by a command or question:

```
"Gicel, what time is it?"
"Hey Gicell, play Perfect by Ed Sheeran"
"Gicell, stop the music please"
```

The wake word detector runs in 3 stages:
1. **Direct match** — is the bot name literally in the transcript?
2. **Normalized** — is it there after phonetic normalization?
3. **Fuzzy** — is any token within 1 edit distance of the bot name?

This makes detection resilient to Whisper's tendency to mishear Indonesian names.

Additionally, even after a wake word match, the bot applies a **strict trigger filter** — it checks that the utterance contains at least one "intent keyword" (a verb or conversational marker). This prevents accidental triggers when someone just says the name casually without wanting the bot to respond.

### Talk Mode

Removes the wake word requirement. Every utterance in the room goes through STT and directly to AI.

```
!talkmode on     → enable
!talkmode off    → disable
!talkmode        → toggle
```

Built-in protections in talk mode:
- **Minimum length**: utterances under 8 characters are ignored (blocks `"hmm"`, `"ok"`, `"yeah"`)
- **Per-user cooldown**: 8 seconds between responses to the same speaker
- **TTS anti-feedback**: always active regardless of mode

### Audio pipeline for voice responses

When the bot decides to respond by voice:
1. The reply text is sanitized (emojis stripped, markdown removed)
2. `generateTTS()` produces an audio buffer
3. The buffer is encoded as a `Blob URL` and injected into the browser page
4. An `<audio>` element plays the Blob URL through the injected `AudioContext`
5. The same `MediaStreamDestination` used for music connects this output to the WebRTC sender
6. Peers in the room hear the bot speak through its "microphone"

---

## Commands Reference

### Music

| Command | Usage | Notes |
|---|---|---|
| `!play` | `!play <title or URL>` | Adds to queue; plays immediately if queue is empty |
| `!search` | `!search <title>` | Shows top 10 results; use `!play <result number>` to pick |
| `!skip` | `!skip` | Requester can skip their own song. Owner/mod can skip any |
| `!stop` | `!stop` | Stops playback and clears entire queue. Owner/mod only |
| `!np` | `!np` | Shows now playing, duration bar, and requester name |
| `!queue` | `!queue` or `!q` | Lists the current queue with positions |
| `!repeat` | `!repeat` or `!r` | Toggles loop for the current song |
| `!vol` | `!vol <0-100>` | Sets volume. `!vol 0` mutes, `!vol 100` full |
| `!lirik` | `!lirik` | Fetches and displays lyrics from Genius |

### Audio Effects

| Command | Usage | Notes |
|---|---|---|
| `!bass` | `!bass <1-15>` or `!bass off` | Boost low frequencies |
| `!treble` | `!treble <1-15>` or `!treble off` | Boost high frequencies |
| `!reverb` | `!reverb on/off` | Room/cave-style reverb |
| `!8d` | `!8d on/off` | Stereo rotation (use headphones for best effect) |
| `!speed` | `!speed <0.25-3.0>` | Playback speed — `!speed 1.5` for 1.5x |
| `!nightcore` | `!nightcore` | Preset: 1.25x speed + treble boost |
| `!vaporwave` | `!vaporwave` | Preset: 0.8x speed + bass + reverb |
| `!slowed` | `!slowed` | Preset: 0.85x speed + mild bass + reverb |
| `!fx` | `!fx` | Shows all currently active effects |
| `!fxreset` | `!fxreset` | Resets all effects to default |

### Economy

| Command | Usage | Notes |
|---|---|---|
| `!daily` | `!daily` | 24-hour cooldown, reward scales with level |
| `!balance` | `!balance` or `!bal` | Shows coins, XP, and level |
| `!shop` | `!shop` or `!shop 2` | Browse pages of the item shop |
| `!buy` | `!buy <item name>` | Purchase an item from the shop |
| `!sell` | `!sell <item name>` | Sell an item for partial refund |
| `!inv` | `!inv` | Shows your inventory and current HP |
| `!give` | `!give <user> <amount>` | Transfer coins to another user |

### RPG

| Command | Usage | Notes |
|---|---|---|
| `!hunt` | `!hunt` | Requires weapon in inventory and HP > 20 |
| `!heal` | `!heal` | Uses potions from inventory or costs coins |
| `!adventure` | `!adventure` | Random event — good or bad outcomes |
| `!grind` | `!grind <job>` | 60+ jobs, each needs specific equipment |

### Voice & Settings

| Command | Usage | Notes |
|---|---|---|
| `!voice` | `!voice` | Shows current voice mode status |
| `!voice on/off` | `!voice on` | Owner/mod only |
| `!talkmode` | `!talkmode` | Toggles talk mode |
| `!talkmode on/off` | `!talkmode on` | Forces a specific state. Owner/mod only |
| `!aimode` | `!aimode on/off` | Enables/disables AI in text chat |
| `!say` | `!say <text>` | Speaks text in voice room. Owner/mod only |

---

## Plugin System

Plugins are `.js` files in `./plugins/` that load automatically on start. They can add new commands without touching any core files.

### Minimal plugin

```js
// plugins/ping.js
module.exports = {
    commands: ['ping'],
    handle: async (cmd, args, msg, ctx) => {
        await ctx.sendMessage('Pong!');
    }
};
```

### Full plugin with permissions and economy

```js
// plugins/gamble_custom.js
const eco = require('../economy');

module.exports = {
    commands: ['flip'],
    handle: async (cmd, args, msg, { sender, sendMessage, log }) => {
        const db   = eco.loadEconomyDB();
        const user = eco.getUser(db, sender.uid, sender.name);
        const bet  = parseInt(args) || 0;

        if (bet <= 0)          return sendMessage('Usage: !flip <amount>');
        if (user.coins < bet)  return sendMessage(`You only have ${user.coins} coins.`);

        const win  = Math.random() < 0.5;
        user.coins = win ? user.coins + bet : user.coins - bet;
        eco.saveEconomyDB(db);

        log(`${sender.name} flipped ${bet} → ${win ? 'WIN' : 'LOSE'}`, 'info');
        await sendMessage(win
            ? `🪙 Heads! You won ${bet} coins. New balance: ${user.coins}`
            : `💀 Tails! You lost ${bet} coins. New balance: ${user.coins}`
        );
    }
};
```

### Context object reference

| Property | Type | Description |
|---|---|---|
| `cmd` | `string` | The command name (e.g. `'play'`, `'flip'`) |
| `args` | `string` | Everything after the command name |
| `msg` | `string` | The full original message |
| `sender.name` | `string` | Display name of the user who sent the command |
| `sender.role` | `string` | Role: `'owner'`, `'moderator'`, `'member'` |
| `sender.uid` | `string` | User's unique ID |
| `sendMessage(text)` | `async Function` | Posts `text` to the room chat |
| `botState` | `object` | Shared state: `queue`, `nowPlaying`, `volume`, `fx`, `voiceMode`, etc. |
| `page` | `Playwright Page` | Full Playwright page access (advanced use) |
| `log(msg, level)` | `Function` | Dashboard logger |
| `speakTTS(text)` | `async Function` | Makes the bot speak in the voice room |
| `isTTSBusy()` | `Function` | Returns `true` if TTS is currently playing |

---

## Troubleshooting

### Bot joins the room but chat shows nothing

The WebSocket interceptor hook may have failed to install. Check the logs for `[WS] Participant cache listener active`. If missing, the room's WebSocket format may have changed — this occasionally happens after Free4Talk updates.

### Voice mode is on but the bot never responds

1. Check `GROQ_API_KEYS` in `.env` — make sure they're valid
2. Run `!voice` in chat — confirm the status shows `ON`
3. Check the dashboard logs for `[VOICE] Utterance dari ...` entries — if they're not appearing, the audio capture hook isn't running
4. Say the bot name clearly at the start of your utterance and wait 1–2s after you finish speaking before releasing the mic

### `!play` finds the song but audio never starts

1. Verify yt-dlp is working: `yt-dlp --version`
2. Update yt-dlp: `yt-dlp -U` — YouTube format changes break older versions
3. Verify ffmpeg is installed: `ffmpeg -version`
4. Check the logs for `[MUSIC]` entries — they'll show exactly where it fails

### STT latency is consistently > 3 seconds

- Groq's free tier has occasional cold starts (normal, not your problem)
- Add 2–3 more `GROQ_API_KEYS` to distribute load
- Check [status.groq.com](https://status.groq.com) for service issues

### AI replies are slow or timing out

- Add more `NIM_API_KEYS` — multiple keys rotate automatically
- The NVIDIA NIM API free tier can be slow at peak times
- Consider switching to a smaller/faster model in `ai.js` → `callNIM()`

### Session expired — bot can't log in

```bash
rm -rf ./profile/
npm run setup
```

### Dashboard not loading (port conflict)

Edit the port number in `manager.js`. Search for `3000` and change it to any free port (e.g. `3100`, `4000`).

### "Cannot find module" errors

Run `npm install` again. If a specific module is missing, install it manually: `npm install <module-name>`.

---

## Contributing

PRs are welcome. For big changes, open an issue first to discuss.

Guidelines:
- New user-facing commands go in `./plugins/` (don't touch core files)
- Follow the existing log style: `log(message, 'info'|'success'|'warn'|'error')`
- Run `node --check <file>.js` before submitting
- Test with at least one real room join to confirm nothing breaks

---

## Changelog

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

### [1.1.0] — 2026-05-02

#### 🐛 Fixed
- **Volume persistence between songs** (`commands.js`, `server.js`)  
  `!vol` now correctly persists across song transitions. Previously, setting volume on the first song had no effect on subsequent tracks — each new song would reset to the default 10% volume. Root cause: `!vol` only updated `window._audioElement.volume` (the currently playing element) but did not update `window._botVolume`, which is the baseline value read when each new song starts. Fix: `!vol` now updates both, and `window._botVolume` is properly initialized in the audio pipeline startup script.

---

### [1.0.0] — 2026-05-01

#### 🎉 Initial Release
- Self-hosted AI voice bot for Free4Talk voice rooms
- Real-time STT via Groq Whisper Large v3 with multi-key rotation
- TTS via Microsoft Edge TTS (18+ voice options)
- Wake word detection with 3-stage fuzzy matching (handles Whisper misrecognitions)
- Talk Mode — bot responds to all utterances without wake word
- Music streaming via yt-dlp directly into WebRTC sender track
- 4-hour stream URL cache with background pre-fetch for next song
- YouTube search with `yt-search`, full queue system
- NVIDIA NIM AI chat (Qwen 3.5 122B) with per-user memory
- Economy & RPG system (coins, XP, levels, inventory, gacha)
- Plugin system — drop `.js` files into `plugins/` to add commands
- Web dashboard via Express + Socket.IO
- `npx create-gicellbot <name>` CLI scaffolding
- Published to npm as [`create-gicellbot`](https://www.npmjs.com/package/create-gicellbot)

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
