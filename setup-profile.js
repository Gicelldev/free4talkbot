'use strict';

/**
 * GicellBot — Profile Setup
 * 
 * Setup profile untuk user tertentu:
 *   node setup-profile.js                    ← single user (./profile/)
 *   node setup-profile.js gilangraja         ← per username (./profiles/<userId>/)
 *   node setup-profile.js <userId>           ← pakai userId langsung
 * 
 * Setelah setup, bot akan otomatis pakai profile ini.
 */

const { chromium } = require('playwright');
const path         = require('path');
const fs           = require('fs');
const readline     = require('readline');

// Arg: bisa username atau userId
const target      = process.argv[2];
const PROFILE_DIR = target
    ? path.join(__dirname, 'profiles', target)   // per-user: profiles/<name>/
    : path.join(__dirname, 'profile');            // single:   profile/

async function main() {
    console.log('\n====================================');
    console.log('  GicellBot — Profile Setup');
    console.log('====================================');
    if (target) {
        console.log(`Target user  : ${target}`);
    } else {
        console.log('Mode         : Single user (shared)');
    }
    console.log(`Profile dir  : ${PROFILE_DIR}`);
    console.log('\nBrowser akan terbuka. Login ke Free4Talk, lalu tekan ENTER.\n');

    // Buat folder kalau belum ada
    fs.mkdirSync(PROFILE_DIR, { recursive: true });

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
        ],
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.free4talk.com/', { waitUntil: 'networkidle' });

    console.log('Browser terbuka di https://www.free4talk.com/');
    console.log('Silakan login (Google / Email / Apple).');
    console.log('\n>>> Setelah login dan sudah muncul dashboard F4T,');
    console.log('>>> tekan ENTER di terminal ini.\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => rl.question('Tekan ENTER untuk menyimpan...', () => {
        rl.close();
        resolve();
    }));

    // Backup localStorage ke account.json (atau profiles/<name>.account.json)
    const lsData = await page.evaluate(() => {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            data[k] = localStorage.getItem(k);
        }
        return data;
    });

    const accountFile = target
        ? path.join(__dirname, `account_${target}.json`)
        : path.join(__dirname, 'account.json');

    fs.writeFileSync(accountFile, JSON.stringify({ localStorage: lsData }, null, 2));
    console.log(`\n[OK] ${accountFile} diperbarui (${Object.keys(lsData).length} keys).`);

    await context.close();
    console.log(`[OK] Profile disimpan ke: ${PROFILE_DIR}`);

    if (target) {
        console.log(`\nProfile user "${target}" siap.`);
        console.log('Saat user login ke manager dan join room → bot otomatis pakai profile ini.\n');
    } else {
        console.log('\nJalankan: node manager.js');
        console.log('Bot akan pakai profile ini secara headless.\n');
    }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
