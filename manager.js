'use strict';

// ════════════════════════════════════════════════════════════════════
//  GicellBot — Manager Server
//  node manager.js  →  http://localhost:3000
// ════════════════════════════════════════════════════════════════════

const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const http      = require('http');
const { fork }  = require('child_process');
const express   = require('express');
const session   = require('express-session');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

// ── Config ────────────────────────────────────────────────────────────────────
const BOT_NAME     = 'GicellBot';
const PORT         = 6504;
const BOT_PORT     = 3001;
const USERS_FILE   = path.join(__dirname, 'users.json');
const SECRET_FILE  = path.join(__dirname, '.session_secret');
const MAX_HISTORY  = 30;
const SALT_ROUNDS  = 12;

// Dummy hash for timing-safe login (prevents username enumeration)
const DUMMY_HASH = bcrypt.hashSync('__gicellbot_timing_dummy__', 4);

// ── Session Secret (generated once, stored on disk) ───────────────────────────
let SESSION_SECRET;
try {
    SESSION_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (!SESSION_SECRET || SESSION_SECRET.length < 32) throw new Error();
} catch {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 }); } catch {}
}

// ── Users Storage ─────────────────────────────────────────────────────────────
const loadUsers = () => {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
    catch { return []; }
};
const saveUsers = (u) => fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
const findById  = (id) => loadUsers().find(u => u.id === id) || null;
const findByUsername = (name) => loadUsers().find(
    u => u.username.toLowerCase() === String(name).toLowerCase()
) || null;

function patchUser(id, fn) {
    const users = loadUsers();
    const i = users.findIndex(u => u.id === id);
    if (i === -1) return null;
    fn(users[i]);
    saveUsers(users);
    return users[i];
}

// ── Bot Instances ─────────────────────────────────────────────────────────────
const instances   = new Map(); // userId → { proc, port, roomUrl, status }
const pendingJoin  = new Set(); // userId → currently spawning (race condition lock)
const crashBackoff = new Map(); // userId → { count, until } — exponential crash backoff
const MAX_BOTS     = parseInt(process.env.MAX_BOTS || '10', 10); // default 10

let nextPort = BOT_PORT;

function allocPort() {
    const used = new Set([...instances.values()].map(i => i.port));
    while (used.has(nextPort)) nextPort++;
    return nextPort++;
}

function isRoomOccupied(roomUrl, exceptUserId = null) {
    for (const [uid, inst] of instances) {
        if (uid === exceptUserId) continue;
        if (
            inst.roomUrl === roomUrl &&
            !['STOPPED', 'CRASHED', 'STOPPING'].includes(inst.status)
        ) return true;
    }
    return false;
}

function cloneProfileIfNeeded(profileDir) {
    const masterProfile = path.join(__dirname, 'profile');
    if (fs.existsSync(profileDir)) return; // sudah ada, skip
    if (!fs.existsSync(masterProfile))     return; // master belum ada, skip (fallback ke inject)

    // Clone master profile ke user profile
    console.log(`[PROFILE] Cloning master profile → ${profileDir}`);
    fs.mkdirSync(profileDir, { recursive: true });
    copyDirSync(masterProfile, profileDir);
    console.log(`[PROFILE] Clone selesai.`);
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(s, d);
        } else {
            try { fs.copyFileSync(s, d); } catch (_) {}
        }
    }
}

function createInstance(userId, roomUrl) {
    const profileDir = path.join(__dirname, 'profiles', userId);

    // Auto-clone master profile kalau user belum punya profile
    cloneProfileIfNeeded(profileDir);

    const proc = fork(path.join(__dirname, 'server.js'), [], {
        env: {
            ...process.env,
            AUTO_START_ROOM: roomUrl,
            AUTO_BOT_NAME  : BOT_NAME,
            BOT_PROFILE_DIR: profileDir,
        },
        silent: true,
    });

    const inst = { proc, roomUrl, status: 'STARTING' };
    instances.set(userId, inst);

    // Persist join in history
    patchUser(userId, u => {
        if (!u.bot) u.bot = { currentRoom: null, history: [] };
        u.bot.currentRoom = roomUrl;
        u.bot.history.unshift({ roomUrl, joinedAt: new Date().toISOString(), leftAt: null });
        if (u.bot.history.length > MAX_HISTORY) u.bot.history.length = MAX_HISTORY;
    });

    // Ambil username untuk label terminal
    const getLabel = () => {
        const u = findById(userId);
        return u ? `[BOT:${u.username}]` : `[BOT:${userId.slice(0,6)}]`;
    };

    proc.stdout.on('data', chunk => {
        chunk.toString()
            .replace(/\x1b\[[0-9;]*m/g, '')
            .split('\n').filter(Boolean)
            .forEach(line => {
                if (line.includes('Bot is ONLINE')) { inst.status = 'ONLINE';  pushStatus(userId); }
                if (line.includes('Startup Error')) { inst.status = 'ERROR';   pushStatus(userId); }
                console.log(`${getLabel()} ${line}`);
                io.to(`u:${userId}`).emit('log', line);
                io.to('dev').emit('admin-log', { userId, line });
            });
        io.to('dev').emit('admin-update', adminSnapshot());
    });

    proc.stderr.on('data', chunk => {
        chunk.toString()
            .replace(/\x1b\[[0-9;]*m/g, '')
            .split('\n').filter(Boolean)
            .forEach(line => {
                if (!line.trim()) return;
                const errLine = '[ERR] ' + line.trim();
                console.error(`${getLabel()} ${errLine}`);
                io.to(`u:${userId}`).emit('log', errLine);
            });
    });

    proc.on('exit', code => {
        const crashed = code !== 0 && code !== null;
        inst.status   = crashed ? 'CRASHED' : 'STOPPED';

        patchUser(userId, u => {
            if (u.bot?.history?.[0] && !u.bot.history[0].leftAt)
                u.bot.history[0].leftAt = new Date().toISOString();
            if (u.bot) u.bot.currentRoom = null;
        });

        // ── Crash backoff: cegah spawn loop ─────────────────────────────────
        if (crashed) {
            const prev = crashBackoff.get(userId) || { count: 0, until: 0 };
            const count = prev.count + 1;
            // Backoff exponential: 1st=10s, 2nd=30s, 3rd+=60s
            const delayMs = count === 1 ? 10_000 : count === 2 ? 30_000 : 60_000;
            crashBackoff.set(userId, { count, until: Date.now() + delayMs });
            console.warn(`[MANAGER] ${getLabel()} crashed (${count}x) — spawn lock extended ${delayMs/1000}s`);

            // Lock tetap aktif selama backoff
            if (!pendingJoin.has(userId)) pendingJoin.add(userId);
            setTimeout(() => {
                pendingJoin.delete(userId);
                pushStatus(userId);
                io.to('dev').emit('admin-update', adminSnapshot());
            }, delayMs);
        } else {
            // STOPPED normal — reset crash counter
            crashBackoff.delete(userId);
        }

        pushStatus(userId);
        io.to('dev').emit('admin-update', adminSnapshot());
    });

    pushStatus(userId);
    io.to('dev').emit('admin-update', adminSnapshot());
    return inst;
}


function stopInstance(userId) {
    const inst = instances.get(userId);
    if (!inst || ['STOPPED', 'CRASHED', 'STOPPING'].includes(inst.status)) return false;
    inst.proc.kill('SIGTERM');
    inst.status = 'STOPPING';
    pushStatus(userId);
    io.to('dev').emit('admin-update', adminSnapshot());
    return true;
}

function restartInstance(userId) {
    const inst = instances.get(userId);
    if (!inst) return false;
    const roomUrl = inst.roomUrl;
    stopInstance(userId);
    setTimeout(() => { instances.delete(userId); createInstance(userId, roomUrl); }, 2500);
    return true;
}

function getBotStatus(userId) {
    const inst = instances.get(userId);
    const user = findById(userId);
    return {
        status : inst?.status  || 'OFFLINE',
        roomUrl: inst?.roomUrl || null,
        port   : inst?.port    || null,
        history: user?.bot?.history || [],
    };
}

function adminSnapshot() {
    return loadUsers().map(u => {
        const inst = instances.get(u.id);
        return {
            id       : u.id,
            username : u.username,
            role     : u.role,
            createdAt: u.createdAt,
            botStatus: inst?.status  || 'OFFLINE',
            botRoom  : inst?.roomUrl || null,
        };
    });
}

function pushStatus(userId) {
    io.to(`u:${userId}`).emit('status', getBotStatus(userId));
}

// ── Express ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: false } });

const sessionMw = session({
    secret           : SESSION_SECRET,
    resave           : false,
    saveUninitialized: false,
    name             : 'gb.sid',
    cookie           : { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 },
});

app.set('trust proxy', 1); // Cloudflare / reverse proxy
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMw);

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Share session with Socket.IO
io.use((socket, next) => sessionMw(socket.request, {}, next));

// Login rate limiter: 5 attempts / 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 5,
    skipSuccessfulRequests: true,
    handler: (req, res) => res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' }),
});

// ── Middleware ────────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) =>
    req.session.userId ? next() : res.redirect('/login');

const requireDev = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = findById(req.session.userId);
    return u?.role === 'developer' ? next() : res.status(403).send(page403());
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const cleanUsername = (s) =>
    String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);

const isValidRoomUrl = (url) => {
    try {
        const u = new URL(url);
        return u.hostname === 'www.free4talk.com' && u.pathname.startsWith('/room/');
    } catch { return false; }
};

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const u = findById(req.session.userId);
    return res.redirect(u?.role === 'developer' ? '/admin' : '/dashboard');
});

// Login
app.get('/login', (req, res) =>
    req.session.userId ? res.redirect('/') : res.send(pageLogin()));

app.post('/login', loginLimiter, async (req, res) => {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || '');
    if (!username || !password)
        return res.send(pageLogin('Username and password are required.'));

    const user = findByUsername(username);
    const hash = user?.passwordHash || DUMMY_HASH;
    const match = await bcrypt.compare(password, hash);

    if (!user || !match) return res.send(pageLogin('Invalid credentials.'));

    req.session.regenerate(err => {
        if (err) return res.send(pageLogin('A session error occurred. Please try again.'));
        Object.assign(req.session, { userId: user.id, username: user.username, role: user.role });
        res.redirect('/');
    });
});

// Register
app.get('/register', (req, res) =>
    req.session.userId ? res.redirect('/') : res.send(pageRegister()));

app.post('/register', async (req, res) => {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || '');
    const confirm  = String(req.body.confirm  || '');

    if (username.length < 3)   return res.send(pageRegister('Username must be at least 3 characters.'));
    if (password.length < 8)   return res.send(pageRegister('Password must be at least 8 characters.'));
    if (password !== confirm)   return res.send(pageRegister('Passwords do not match.'));
    if (findByUsername(username)) return res.send(pageRegister('That username is already taken.'));

    const users = loadUsers();
    const isFirst = users.length === 0;
    const user = {
        id          : crypto.randomBytes(12).toString('hex'),
        username,
        role        : isFirst ? 'developer' : 'user',
        passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
        createdAt   : new Date().toISOString(),
        bot         : { currentRoom: null, history: [] },
    };
    users.push(user);
    saveUsers(users);

    req.session.regenerate(err => {
        if (err) return res.redirect('/login');
        Object.assign(req.session, { userId: user.id, username: user.username, role: user.role });
        res.redirect('/');
    });
});

app.post('/logout', requireAuth, (req, res) =>
    req.session.destroy(() => res.redirect('/login')));

// Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
    const user = findById(req.session.userId);
    if (!user) return req.session.destroy(() => res.redirect('/login'));
    res.send(pageDashboard(user, getBotStatus(req.session.userId)));
});

// Admin
app.get('/admin', requireDev, (req, res) => {
    const user = findById(req.session.userId);
    res.send(pageAdmin(user, adminSnapshot()));
});

// ── API — Bot Control ─────────────────────────────────────────────────────────
app.post('/api/bot/join', requireAuth, (req, res) => {
    const { roomUrl } = req.body;
    const uid = req.session.userId;

    if (!roomUrl || !isValidRoomUrl(roomUrl))
        return res.status(400).json({ error: 'Invalid room URL. Must be a free4talk.com room link.' });

    // Cek kapasitas server
    const activeBots = [...instances.values()].filter(i => ['ONLINE','STARTING'].includes(i.status)).length;
    if (activeBots >= MAX_BOTS)
        return res.status(503).json({ error: `Server penuh (${activeBots}/${MAX_BOTS} bot aktif). Coba lagi nanti.` });

    // Lock: cegah double-spawn dari klik cepat / multiple tab
    if (pendingJoin.has(uid)) {
        const backoff = crashBackoff.get(uid);
        const secsLeft = backoff ? Math.ceil((backoff.until - Date.now()) / 1000) : null;
        const msg = secsLeft > 0
            ? `Bot crashed. Silakan tunggu ${secsLeft} detik sebelum coba lagi.`
            : 'Bot sedang starting. Tunggu sebentar.';
        return res.status(409).json({ error: msg });
    }

    const inst = instances.get(uid);
    if (inst && !['STOPPED', 'CRASHED'].includes(inst.status))
        return res.status(409).json({ error: 'You already have an active bot. Stop it first.' });

    if (isRoomOccupied(roomUrl, uid))
        return res.status(409).json({ error: 'This room is already occupied by another user.' });

    // Bersihkan instance lama yang sudah STOPPED/CRASHED
    if (inst) instances.delete(uid);
    // Reset crash counter saat user secara sadar reconnect
    crashBackoff.delete(uid);

    // Set lock
    pendingJoin.add(uid);
    const newInst = createInstance(uid, roomUrl);

    // Hapus lock setelah ONLINE atau max 60 detik (bukan saat crash — crash handler handle sendiri)
    const clearLockOnline = () => pendingJoin.delete(uid);
    const lockTimeout = setTimeout(clearLockOnline, 60_000);
    newInst.proc.stdout?.once('data', () => setTimeout(() => {
        clearTimeout(lockTimeout);
        clearLockOnline();
    }, 8000));

    res.json({ ok: true });
});


app.post('/api/bot/stop',    requireAuth, (req, res) => res.json({ ok: stopInstance(req.session.userId) }));
app.post('/api/bot/restart', requireAuth, (req, res) => res.json({ ok: restartInstance(req.session.userId) }));
app.get('/api/bot/status',   requireAuth, (req, res) => res.json(getBotStatus(req.session.userId)));

// ── API — Admin ───────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireDev, (req, res) => res.json(adminSnapshot()));

app.post('/api/admin/bot/stop/:uid', requireDev, (req, res) =>
    res.json({ ok: stopInstance(req.params.uid) }));

app.post('/api/admin/bot/restart/:uid', requireDev, (req, res) =>
    res.json({ ok: restartInstance(req.params.uid) }));

app.delete('/api/admin/users/:uid', requireDev, (req, res) => {
    const { uid } = req.params;
    if (uid === req.session.userId)
        return res.status(400).json({ error: 'You cannot delete your own account.' });
    stopInstance(uid);
    setTimeout(() => instances.delete(uid), 3000);
    saveUsers(loadUsers().filter(u => u.id !== uid));
    io.to('dev').emit('admin-update', adminSnapshot());
    res.json({ ok: true });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {
    const { userId, role } = socket.request.session || {};
    if (!userId) return socket.disconnect(true);
    socket.join(`u:${userId}`);
    socket.emit('status', getBotStatus(userId));
    if (role === 'developer') {
        socket.join('dev');
        socket.emit('admin-update', adminSnapshot());
    }
});

// ── Shared CSS ────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a;--surface:#111;--surface-2:#181818;--surface-3:#1f1f1f;
  --border:#232323;--border-strong:#2e2e2e;
  --text:#f0f0f0;--text-muted:#888;--text-sub:#555;
  --accent:#5865f2;--accent-hover:#4752c4;--accent-dim:rgba(88,101,242,.12);
  --success:#22c55e;--success-dim:rgba(34,197,94,.1);--success-border:rgba(34,197,94,.2);
  --error:#ef4444;--error-dim:rgba(239,68,68,.1);--error-border:rgba(239,68,68,.2);
  --warning:#f59e0b;--warning-dim:rgba(245,158,11,.1);--warning-border:rgba(245,158,11,.2);
  --r:8px;--r-sm:5px;--r-lg:12px;
}
html{height:100%}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100%}
a{color:inherit;text-decoration:none}
button,input{font-family:inherit}

/* ── Auth ── */
.auth-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.auth-logo{font-size:20px;font-weight:700;letter-spacing:-.03em;margin-bottom:6px}
.auth-sub{font-size:13px;color:var(--text-muted);margin-bottom:28px}
.auth-card{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:28px}
.auth-title{font-size:15px;font-weight:600;margin-bottom:20px}
.field{margin-bottom:14px}
.field label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:6px}
.field input{width:100%;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--r);padding:9px 12px;color:var(--text);font-size:13px;outline:none;transition:border-color .15s}
.field input:focus{border-color:var(--accent)}
.btn-block{width:100%;background:var(--accent);color:#fff;border:none;border-radius:var(--r);padding:10px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;margin-top:4px}
.btn-block:hover{background:var(--accent-hover)}
.auth-foot{font-size:12px;color:var(--text-muted);text-align:center;margin-top:14px}
.auth-foot a{color:var(--text-sub);transition:color .15s}
.auth-foot a:hover{color:var(--text)}
.alert{border-radius:var(--r-sm);padding:9px 12px;font-size:12px;margin-bottom:14px;border:1px solid}
.alert-error{background:var(--error-dim);color:var(--error);border-color:var(--error-border)}

/* ── Nav ── */
.nav{position:sticky;top:0;z-index:100;background:rgba(10,10,10,.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);height:52px;padding:0 24px;display:flex;align-items:center;gap:12px}
.nav-brand{font-size:14px;font-weight:700;letter-spacing:-.02em;margin-right:8px}
.nav-sep{width:1px;height:16px;background:var(--border-strong)}
.nav-tabs{display:flex;gap:2px;flex:1}
.nav-tab{font-size:13px;color:var(--text-muted);padding:5px 10px;border-radius:var(--r-sm);transition:background .15s,color .15s;cursor:pointer;border:none;background:none}
.nav-tab:hover,.nav-tab.active{color:var(--text);background:var(--surface-2)}
.nav-user{font-size:12px;color:var(--text-sub);margin-left:auto}
.nav-logout{font-size:12px;color:var(--text-sub);padding:5px 10px;border-radius:var(--r-sm);border:1px solid var(--border);background:none;cursor:pointer;transition:border-color .15s,color .15s}
.nav-logout:hover{border-color:var(--border-strong);color:var(--text)}

/* ── Layout ── */
.page{max-width:820px;margin:0 auto;padding:32px 24px}
.page-wide{max-width:1080px;margin:0 auto;padding:32px 24px}
.section{margin-bottom:28px}
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px}

/* ── Cards ── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg)}
.card-body{padding:20px}
.card-divider{border:none;border-top:1px solid var(--border)}

/* ── Status Panel ── */
.status-panel{display:flex;align-items:center;gap:16px;padding:20px}
.status-indicator{width:10px;height:10px;border-radius:50%;background:var(--text-sub);flex-shrink:0;transition:background .3s}
.status-indicator.online{background:var(--success);box-shadow:0 0 0 3px var(--success-dim);animation:breathe 2.5s ease-in-out infinite}
.status-indicator.starting{background:var(--accent);animation:breathe 1s ease-in-out infinite}
.status-indicator.crashed,.status-indicator.error{background:var(--error)}
.status-indicator.stopping{background:var(--warning)}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.4}}
.status-info{flex:1;min-width:0}
.status-state{font-size:13px;font-weight:600}
.status-room{font-size:12px;color:var(--text-muted);margin-top:2px;font-family:'SF Mono','Fira Code',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status-controls{display:flex;gap:8px;flex-shrink:0}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--r);padding:7px 14px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;transition:opacity .15s,background .15s;white-space:nowrap;gap:6px}
.btn:disabled{opacity:.35;cursor:not-allowed}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--accent-hover)}
.btn-secondary{background:var(--surface-2);color:var(--text-sub);border:1px solid var(--border-strong)}
.btn-secondary:hover:not(:disabled){color:var(--text);border-color:#444}
.btn-danger{background:var(--error-dim);color:var(--error);border:1px solid var(--error-border)}
.btn-danger:hover:not(:disabled){background:rgba(239,68,68,.18)}
.btn-warning{background:var(--warning-dim);color:var(--warning);border:1px solid var(--warning-border)}
.btn-warning:hover:not(:disabled){background:rgba(245,158,11,.18)}

/* ── Join form ── */
.join-row{display:flex;gap:8px;padding:20px}
.join-input{flex:1;background:var(--bg);border:1px solid var(--border-strong);border-radius:var(--r);padding:8px 12px;color:var(--text);font-size:12px;font-family:'SF Mono','Fira Code',monospace;outline:none;transition:border-color .15s;min-width:0}
.join-input:focus{border-color:var(--accent)}
.join-input::placeholder{font-family:inherit;color:var(--text-sub)}
.join-error{font-size:11px;color:var(--error);padding:0 20px 14px;display:none}

/* ── Badges ── */
.badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;border:1px solid transparent}
.b-online{background:var(--success-dim);color:var(--success);border-color:var(--success-border)}
.b-starting{background:var(--accent-dim);color:#818cf8;border-color:rgba(88,101,242,.2)}
.b-offline,.b-stopped{background:var(--surface-3);color:var(--text-muted);border-color:var(--border-strong)}
.b-crashed,.b-error{background:var(--error-dim);color:var(--error);border-color:var(--error-border)}
.b-stopping{background:var(--warning-dim);color:var(--warning);border-color:var(--warning-border)}
.b-developer{background:rgba(88,101,242,.15);color:#818cf8;border-color:rgba(88,101,242,.25)}
.b-user{background:var(--surface-3);color:var(--text-muted);border-color:var(--border-strong)}

/* ── Table ── */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead th{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);padding:10px 16px;text-align:left;border-bottom:1px solid var(--border)}
tbody td{padding:11px 16px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--surface-2)}
.td-code{font-family:'SF Mono','Fira Code',monospace;font-size:11px;color:var(--text-muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-dim{font-size:12px;color:var(--text-muted)}
.td-actions{display:flex;gap:6px;align-items:center}

/* ── Stats ── */
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:18px 20px}
.stat-val{font-size:28px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.stat-lbl{font-size:11px;color:var(--text-muted);margin-top:3px}

/* ── Log terminal ── */
.log-box{display:none;background:#060609;border-top:1px solid var(--border);padding:12px 16px;font-family:'SF Mono','Fira Code',monospace;font-size:11px;height:160px;overflow-y:auto;color:var(--text-muted);line-height:1.6}
.log-box.open{display:block}
.log-ok{color:var(--success)}.log-err{color:var(--error)}.log-cmd{color:var(--warning)}.log-info{color:#60a5fa}

.empty-state{text-align:center;padding:48px 24px;color:var(--text-muted);font-size:13px}

/* ── Responsive ── */
@media(max-width:640px){
  .page,.page-wide{padding:16px 12px}
  .nav{padding:0 14px}
  .stats-grid{grid-template-columns:repeat(2,1fr)}
  .status-panel{flex-wrap:wrap}
  .status-controls{flex-wrap:wrap}
  .join-row{flex-direction:column}
}
@media(max-width:400px){.stats-grid{grid-template-columns:1fr}}
`;

// ── Shared Layout Helpers ─────────────────────────────────────────────────────
function navHtml(username, role) {
    return `<nav class="nav">
  <span class="nav-brand">GicellBot</span>
  <span class="nav-sep"></span>
  <div class="nav-tabs">
    <a href="/dashboard" class="nav-tab${role !== 'developer' ? ' active' : ''}">Dashboard</a>
    ${role === 'developer' ? `<a href="/admin" class="nav-tab active">Admin</a>` : ''}
  </div>
  <span class="nav-user">${username}</span>
  <form method="POST" action="/logout" style="margin:0">
    <button type="submit" class="nav-logout">Sign out</button>
  </form>
</nav>`;
}

function badgeHtml(status) {
    const s = (status || 'OFFLINE').toLowerCase();
    const cls = { online:'b-online', starting:'b-starting', offline:'b-offline',
        stopped:'b-stopped', crashed:'b-crashed', error:'b-error', stopping:'b-stopping' };
    return `<span class="badge ${cls[s] || 'b-offline'}">${status || 'OFFLINE'}</span>`;
}

function indicatorClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'online')               return 'online';
    if (s === 'starting')             return 'starting';
    if (['crashed','error'].includes(s)) return 'crashed';
    if (s === 'stopping')             return 'stopping';
    return '';
}

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-GB', {
            day:'2-digit', month:'short', year:'numeric',
            hour:'2-digit', minute:'2-digit',
        });
    } catch { return iso; }
}

function timeAgo(iso) {
    if (!iso) return '—';
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}

// ── Auth Pages ────────────────────────────────────────────────────────────────
function authShell(title, body) {
    return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — GicellBot</title><style>${CSS}</style></head>
<body><div class="auth-wrap">
<div class="auth-logo">GicellBot</div>
<div class="auth-sub">Bot Management Platform</div>
${body}
</div></body></html>`;
}

function pageLogin(err = '') {
    return authShell('Sign in', `
<div class="auth-card">
  <div class="auth-title">Sign in to your account</div>
  ${err ? `<div class="alert alert-error">${err}</div>` : ''}
  <form method="POST" action="/login">
    <div class="field"><label>Username</label>
      <input type="text" name="username" autocomplete="username" required autofocus>
    </div>
    <div class="field"><label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn-block">Sign in</button>
  </form>
</div>
<div class="auth-foot">Don't have an account? <a href="/register">Create one</a></div>`);
}

function pageRegister(err = '') {
    return authShell('Create account', `
<div class="auth-card">
  <div class="auth-title">Create your account</div>
  ${err ? `<div class="alert alert-error">${err}</div>` : ''}
  <form method="POST" action="/register">
    <div class="field"><label>Username</label>
      <input type="text" name="username" minlength="3" maxlength="32" autocomplete="username" required autofocus>
    </div>
    <div class="field"><label>Password</label>
      <input type="password" name="password" minlength="8" autocomplete="new-password" required>
    </div>
    <div class="field"><label>Confirm Password</label>
      <input type="password" name="confirm" minlength="8" autocomplete="new-password" required>
    </div>
    <button type="submit" class="btn-block">Create account</button>
  </form>
</div>
<div class="auth-foot">Already have an account? <a href="/login">Sign in</a></div>`);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function pageDashboard(user, status) {
    const isActive  = !['OFFLINE', 'STOPPED', 'CRASHED', 'ERROR'].includes(status.status);
    const canRestart= !['OFFLINE', 'STOPPED'].includes(status.status);

    const historyRows = (status.history || []).map(h => `
<tr>
  <td class="td-code" title="${h.roomUrl}">${h.roomUrl}</td>
  <td class="td-dim">${fmtDate(h.joinedAt)}</td>
  <td class="td-dim">${h.leftAt ? fmtDate(h.leftAt) : `<span class="badge b-online">Active</span>`}</td>
  <td style="text-align:right"><button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="prefillRoom('${h.roomUrl}')">Rejoin</button></td>
</tr>`).join('');

    return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — GicellBot</title><style>${CSS}</style></head>
<body>
${navHtml(user.username, user.role)}
<main class="page">

  <!-- Bot Status -->
  <div class="section">
    <div class="section-label">Bot Status</div>
    <div class="card">
      <div class="status-panel" id="status-panel">
        <div class="status-indicator ${indicatorClass(status.status)}" id="s-dot"></div>
        <div class="status-info">
          <div class="status-state" id="s-state">${status.status}</div>
          <div class="status-room" id="s-room">${status.roomUrl || 'Not connected to any room'}</div>
        </div>
        <div class="status-controls">
          <button class="btn btn-danger" id="btn-stop" onclick="botAction('stop')" ${!isActive ? 'disabled' : ''}>Stop</button>
          <button class="btn btn-warning" id="btn-restart" onclick="botAction('restart')" ${!canRestart ? 'disabled' : ''}>Restart</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Join Room -->
  <div class="section">
    <div class="section-label">Connect to Room</div>
    <div class="card">
      <div class="join-row">
        <input class="join-input" id="room-input" type="url" placeholder="https://www.free4talk.com/room/XXXXX">
        <button class="btn btn-primary" id="btn-join" onclick="joinRoom()" ${isActive ? 'disabled' : ''}>Connect</button>
      </div>
      <div class="join-error" id="join-err"></div>
    </div>
  </div>

  <!-- History -->
  <div class="section">
    <div class="section-label">Room History</div>
    <div class="card">
      ${historyRows
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Room</th><th>Connected</th><th>Disconnected</th><th></th></tr></thead>
            <tbody id="history-body">${historyRows}</tbody>
           </table></div>`
        : `<div class="empty-state">No room history yet.</div>`}
    </div>
  </div>

</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
socket.on('status', update);

function update(s) {
  const active  = !['OFFLINE','STOPPED','CRASHED','ERROR'].includes(s.status);
  const canRst  = !['OFFLINE','STOPPED'].includes(s.status);
  document.getElementById('s-state').textContent = s.status;
  document.getElementById('s-room').textContent  = s.roomUrl || 'Not connected to any room';
  const dot = document.getElementById('s-dot');
  dot.className = 'status-indicator' + ({'ONLINE':' online','STARTING':' starting','CRASHED':' crashed','ERROR':' crashed','STOPPING':' stopping'}[s.status] || '');
  document.getElementById('btn-stop').disabled    = !active;
  document.getElementById('btn-restart').disabled = !canRst;
  document.getElementById('btn-join').disabled    = active;
  if (s.history?.length && document.getElementById('history-body')) {
    document.getElementById('history-body').innerHTML = s.history.map(h => \`
      <tr>
        <td class="td-code" title="\${h.roomUrl}">\${h.roomUrl}</td>
        <td class="td-dim">\${fmtDate(h.joinedAt)}</td>
        <td class="td-dim">\${h.leftAt ? fmtDate(h.leftAt) : '<span class="badge b-online">Active</span>'}</td>
        <td style="text-align:right"><button class="btn btn-secondary" style="font-size:11px;padding:4px 10px" onclick="prefillRoom('\${h.roomUrl}')">Rejoin</button></td>
      </tr>\`).join('');
  }
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function joinRoom() {
  const url = document.getElementById('room-input').value.trim();
  if (!url) return showErr('Please enter a room URL.');
  const r = await fetch('/api/bot/join', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ roomUrl: url })
  });
  const d = await r.json();
  if (!r.ok) return showErr(d.error || 'Failed to connect.');
  document.getElementById('room-input').value = '';
  clearErr();
}

async function botAction(action) {
  await fetch('/api/bot/' + action, { method: 'POST' });
}

function prefillRoom(url) {
  document.getElementById('room-input').value = url;
  document.getElementById('room-input').focus();
}

function showErr(msg) {
  const el = document.getElementById('join-err');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 6000);
}
function clearErr() {
  document.getElementById('join-err').style.display = 'none';
}

document.getElementById('room-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
</script>
</body></html>`;
}

// ── Admin ─────────────────────────────────────────────────────────────────────
function pageAdmin(me, data) {
    const totalUsers = data.length;
    const onlineBots = data.filter(u => u.botStatus === 'ONLINE').length;
    const activeBots = data.filter(u => !['OFFLINE','STOPPED'].includes(u.botStatus)).length;

    const rows = data.map(u => {
        const inactive = ['OFFLINE','STOPPED','CRASHED'].includes(u.botStatus);
        const isMe = u.id === me.id;
        return `<tr id="row-${u.id}">
  <td>
    <span style="font-weight:500">${u.username}</span>
    ${isMe ? ` <span class="badge b-developer" style="font-size:9px">you</span>` : ''}
  </td>
  <td><span class="badge b-${u.role}">${u.role}</span></td>
  <td id="bs-${u.id}">${badgeHtml(u.botStatus)}</td>
  <td class="td-code" id="br-${u.id}" title="${u.botRoom || ''}">${u.botRoom || '—'}</td>
  <td class="td-dim">${timeAgo(u.createdAt)}</td>
  <td>
    <div class="td-actions">
      <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px"
        id="fs-${u.id}" onclick="forceStop('${u.id}')" ${inactive ? 'disabled' : ''}>Stop</button>
      <button class="btn btn-warning" style="font-size:11px;padding:4px 10px"
        id="fr-${u.id}" onclick="forceRestart('${u.id}')" ${inactive ? 'disabled' : ''}>Restart</button>
      ${!isMe ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 10px"
        onclick="deleteUser('${u.id}','${u.username}')">Delete</button>` : ''}
    </div>
  </td>
</tr>`;
    }).join('');

    return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — GicellBot</title><style>${CSS}</style></head>
<body>
${navHtml(me.username, me.role)}
<main class="page-wide">

  <!-- Stats -->
  <div class="section">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val" id="stat-users">${totalUsers}</div><div class="stat-lbl">Total Users</div></div>
      <div class="stat-card"><div class="stat-val" id="stat-online">${onlineBots}</div><div class="stat-lbl">Online Bots</div></div>
      <div class="stat-card"><div class="stat-val" id="stat-active">${activeBots}</div><div class="stat-lbl">Active Instances</div></div>
    </div>
  </div>

  <!-- Users Table -->
  <div class="section">
    <div class="section-label">Users & Bots</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th><th>Role</th><th>Bot</th>
              <th>Current Room</th><th>Registered</th><th>Actions</th>
            </tr>
          </thead>
          <tbody id="user-table">
            ${rows || '<tr><td colspan="6" class="empty-state">No users registered.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>

</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const ME = '${me.id}';

socket.on('admin-update', data => {
  document.getElementById('stat-users').textContent  = data.length;
  document.getElementById('stat-online').textContent = data.filter(u => u.botStatus === 'ONLINE').length;
  document.getElementById('stat-active').textContent = data.filter(u => !['OFFLINE','STOPPED'].includes(u.botStatus)).length;
  data.forEach(u => {
    const inactive = ['OFFLINE','STOPPED','CRASHED'].includes(u.botStatus);
    const bs = document.getElementById('bs-' + u.id);
    const br = document.getElementById('br-' + u.id);
    const fs = document.getElementById('fs-' + u.id);
    const fr = document.getElementById('fr-' + u.id);
    if (bs) bs.innerHTML = badge(u.botStatus);
    if (br) { br.textContent = u.botRoom || '—'; br.title = u.botRoom || ''; }
    if (fs) fs.disabled = inactive;
    if (fr) fr.disabled = inactive;
  });
});

function badge(st) {
  const m = {ONLINE:'b-online',STARTING:'b-starting',OFFLINE:'b-offline',STOPPED:'b-stopped',
             CRASHED:'b-crashed',ERROR:'b-error',STOPPING:'b-stopping'};
  return \`<span class="badge \${m[st]||'b-offline'}">\${st||'OFFLINE'}</span>\`;
}

async function forceStop(uid)    { await fetch('/api/admin/bot/stop/'    + uid, { method:'POST' }); }
async function forceRestart(uid) { await fetch('/api/admin/bot/restart/' + uid, { method:'POST' }); }

async function deleteUser(uid, username) {
  if (!confirm(\`Delete "\${username}"? This cannot be undone.\`)) return;
  const r = await fetch('/api/admin/users/' + uid, { method: 'DELETE' });
  if (r.ok) { const row = document.getElementById('row-' + uid); if (row) row.remove(); }
}
</script>
</body></html>`;
}

// ── 403 ───────────────────────────────────────────────────────────────────────
function page403() {
    return `<!DOCTYPE html><html><head><title>403</title>
<style>body{background:#0a0a0a;color:#f0f0f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:56px;font-weight:700;margin:0;letter-spacing:-.04em}p{color:#666;margin:8px 0 24px;font-size:13px}
a{color:#5865f2;font-size:13px}</style></head>
<body><div><h1>403</h1><p>You don't have permission to access this page.</p><a href="/dashboard">Back to Dashboard</a></div></body></html>`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`\nGicellBot Manager  →  http://localhost:${PORT}`);
    console.log(`First user to register becomes developer.\n`);
});
