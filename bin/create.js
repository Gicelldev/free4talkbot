#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Parse target directory ──────────────────────────────────────────────────
const projectName = process.argv[2];
const targetDir   = projectName
    ? path.resolve(process.cwd(), projectName)
    : process.cwd();

// ── Color helpers (no deps) ─────────────────────────────────────────────────
const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    green:  '\x1b[32m',
    cyan:   '\x1b[36m',
    yellow: '\x1b[33m',
    gray:   '\x1b[90m',
    red:    '\x1b[31m',
};
const ok   = (s) => console.log(`${c.green}✔${c.reset}  ${s}`);
const info = (s) => console.log(`${c.cyan}ℹ${c.reset}  ${s}`);
const warn = (s) => console.log(`${c.yellow}⚠${c.reset}  ${s}`);
const bold = (s) => `${c.bold}${s}${c.reset}`;

// ── Banner ──────────────────────────────────────────────────────────────────
console.log('');
console.log(`${c.bold}${c.cyan}  create-gicellbot${c.reset}`);
console.log(`${c.gray}  Free4Talk AI Voice Bot scaffolder${c.reset}`);
console.log('');

// ── Validate target ─────────────────────────────────────────────────────────
if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir).filter(f => f !== '.git');
    if (files.length > 0) {
        warn(`Directory ${bold(targetDir)} is not empty.`);
        console.log(`   Files found: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}`);
        process.exit(1);
    }
} else {
    fs.mkdirSync(targetDir, { recursive: true });
}

info(`Creating project in ${bold(targetDir)}`);
console.log('');

// ── Files/folders to copy from package root (source of truth) ───────────────
const TEMPLATE_ROOT = path.join(__dirname, '..'); // root of this npm package

const COPY_FILES = [
    'ai.js',
    'commands.js',
    'economy.js',
    'fun_api.js',
    'manager.js',
    'server.js',
    'setup-profile.js',
    'stt.js',
    'tts.js',
    'voice.js',
    '.env.example',
    'plugins',
    'public',
];

// npm renames .gitignore → .npmignore during packaging, so we store it as 'gitignore'
// and restore the dot-prefix in the target project.
const GITIGNORE_SRC = path.join(TEMPLATE_ROOT, 'gitignore');


// ── Copy helper ──────────────────────────────────────────────────────────────
function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

// ── Copy template files ──────────────────────────────────────────────────────
for (const file of COPY_FILES) {
    const src  = path.join(TEMPLATE_ROOT, file);
    const dest = path.join(targetDir, file);
    if (!fs.existsSync(src)) { warn(`Skipping missing: ${file}`); continue; }
    copyRecursive(src, dest);
    ok(`Copied ${c.gray}${file}${c.reset}`);
}

// ── Write bot-specific package.json ─────────────────────────────────────────
const botPkg = {
    name   : projectName || 'gicellbot',
    version: '1.0.0',
    description: 'Free4Talk AI Voice Bot',
    main   : 'manager.js',
    scripts: {
        start: 'node manager.js',
        setup: 'node setup-profile.js',
    },
    dependencies: {
        'bcryptjs'         : '^3.0.3',
        'dotenv'           : '^16.4.5',
        'express'          : '^5.2.1',
        'express-rate-limit': '^8.4.1',
        'express-session'  : '^1.19.0',
        'genius-lyrics'    : '^4.4.7',
        'msedge-tts'       : '^2.0.5',
        'playwright'       : '^1.57.0',
        'socket.io'        : '^4.8.3',
        'youtube-dl-exec'  : '^3.0.28',
        'yt-search'        : '^2.13.1',
    },
};
fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(botPkg, null, 2),
    'utf8'
);
ok('Created package.json');

// ── Default data files ───────────────────────────────────────────────────────
const DEFAULTS = {
    'account.json': JSON.stringify({ username: 'YourBotName' }, null, 2),
    'roles.json'  : JSON.stringify({ owners: [], mods: [] }, null, 2),
};
for (const [file, content] of Object.entries(DEFAULTS)) {
    const dest = path.join(targetDir, file);
    if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, content, 'utf8');
        ok(`Created ${file}`);
    }
}

// ── npm install ──────────────────────────────────────────────────────────────
console.log('');
info('Running npm install...');
try {
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    ok('Dependencies installed');
} catch (e) {
    warn('npm install failed — run it manually inside the project folder.');
}

// ── Done — print next steps ──────────────────────────────────────────────────
const rel = projectName ? projectName : '.';

console.log('');
console.log(`${c.green}${c.bold}  Project ready!${c.reset}`);
console.log('');
console.log('  Next steps:');
console.log('');
if (projectName) {
    console.log(`    ${c.cyan}cd ${projectName}${c.reset}`);
}
console.log(`    ${c.cyan}cp .env.example .env${c.reset}   ${c.gray}# fill in your API keys${c.reset}`);
console.log(`    ${c.cyan}npm run setup${c.reset}           ${c.gray}# log in to Free4Talk (once)${c.reset}`);
console.log(`    ${c.cyan}npm start${c.reset}               ${c.gray}# run the bot${c.reset}`);
console.log('');
console.log(`  Get your free API keys:`);
console.log(`    ${c.gray}Groq (STT/Whisper) →${c.reset} https://console.groq.com`);
console.log(`    ${c.gray}NVIDIA NIM (AI)    →${c.reset} https://build.nvidia.com`);
console.log('');
