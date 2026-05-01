module.exports = {
    commands: ['speed', 'bass', 'treble', 'reverb', '8d', 'nightcore', 'vaporwave', 'slowed', 'fx', 'fxreset'],

    handle: async (cmd, args, msg, { sender, sendMessage, page }) => {
        if (!page) return await sendMessage('❌ Bot belum aktif!');

        // ── !speed [0.25 - 3.0] ────────────────────────────────────
        if (cmd === 'speed') {
            if (!args) {
                const cur = await page.evaluate(() => window._effects.speed);
                return await sendMessage(`⚡ Speed saat ini: ${cur}x\nFormat: !speed [0.25 - 3.0] | contoh: !speed 1.5`);
            }
            const val = parseFloat(args);
            if (isNaN(val) || val < 0.25 || val > 3.0)
                return await sendMessage('❌ Speed harus antara 0.25 - 3.0\nContoh: !speed 1.5');

            await page.evaluate((s) => {
                window._audioElement.playbackRate = s;
                window._effects.speed = s;
            }, val);

            const label = val > 1.2 ? '🐇 Turbo!' : val < 0.9 ? '🐢 Slow!' : '✅ Normal';
            await sendMessage(`⚡ Speed → ${val}x ${label}`);
        }

        // ── !bass [off | 1-15] ─────────────────────────────────────
        else if (cmd === 'bass') {
            if (!args || args.toLowerCase() === 'off') {
                await page.evaluate(() => { window._bassFilter.gain.value = 0; window._effects.bass = 0; });
                return await sendMessage('🔇 Bass boost OFF');
            }
            const lvl = Math.max(1, Math.min(15, parseInt(args) || 5));
            const dB  = lvl * 2;
            await page.evaluate((db) => { window._bassFilter.gain.value = db; window._effects.bass = db; }, dB);
            await sendMessage(`🔊 Bass boost ON → Level ${lvl}/15 (+${dB}dB) 💥`);
        }

        // ── !treble [off | 1-15] ───────────────────────────────────
        else if (cmd === 'treble') {
            if (!args || args.toLowerCase() === 'off') {
                await page.evaluate(() => { window._trebleFilter.gain.value = 0; window._effects.treble = 0; });
                return await sendMessage('🔇 Treble boost OFF');
            }
            const lvl = Math.max(1, Math.min(15, parseInt(args) || 5));
            const dB  = lvl * 2;
            await page.evaluate((db) => { window._trebleFilter.gain.value = db; window._effects.treble = db; }, dB);
            await sendMessage(`✨ Treble boost ON → Level ${lvl}/15 (+${dB}dB) 🎵`);
        }

        // ── !reverb [on | off] ─────────────────────────────────────
        else if (cmd === 'reverb') {
            const isOn = !args || args.toLowerCase() !== 'off';
            await page.evaluate((on) => {
                window._reverbGain.gain.value = on ? 0.45 : 0;
                window._dryGain.gain.value    = on ? 0.6  : 1.0;
                window._effects.reverb = on;
            }, isOn);
            await sendMessage(isOn ? '🏛️ Reverb ON — efek ruangan besar! 🌊' : '🔇 Reverb OFF');
        }

        // ── !8d [on | off] ─────────────────────────────────────────
        else if (cmd === '8d') {
            const isOn = !args || args.toLowerCase() !== 'off';
            await page.evaluate((on) => {
                if (!on) {
                    if (window._8dInterval) { clearInterval(window._8dInterval); window._8dInterval = null; }
                    window._pannerNode.pan.value = 0;
                    window._effects.is8d = false;
                    return;
                }
                if (window._8dInterval) return; // already running
                window._effects.is8d = true;
                let angle = 0;
                window._8dInterval = setInterval(() => {
                    angle += 0.04;
                    window._pannerNode.pan.value = Math.sin(angle);
                }, 30);
            }, isOn);
            await sendMessage(isOn ? '🎧 8D Audio ON — pakai headphone biar kerasa! 🔄' : '🔇 8D Audio OFF');
        }

        // ── !nightcore ─────────────────────────────────────────────
        else if (cmd === 'nightcore') {
            await page.evaluate(() => {
                if (window._8dInterval) { clearInterval(window._8dInterval); window._8dInterval = null; }
                window._pannerNode.pan.value      = 0;
                window._audioElement.playbackRate = 1.25;
                window._bassFilter.gain.value     = 0;
                window._trebleFilter.gain.value   = 8;
                window._reverbGain.gain.value     = 0;
                window._dryGain.gain.value        = 1.0;
                window._effects = { speed: 1.25, bass: 0, treble: 8, reverb: false, is8d: false };
            });
            await sendMessage('🌸 Nightcore mode ON!\n⚡ Speed 1.25x | ✨ Treble +8dB');
        }

        // ── !vaporwave ─────────────────────────────────────────────
        else if (cmd === 'vaporwave') {
            await page.evaluate(() => {
                if (window._8dInterval) { clearInterval(window._8dInterval); window._8dInterval = null; }
                window._pannerNode.pan.value      = 0;
                window._audioElement.playbackRate = 0.8;
                window._bassFilter.gain.value     = 10;
                window._trebleFilter.gain.value   = 0;
                window._reverbGain.gain.value     = 0.3;
                window._dryGain.gain.value        = 0.75;
                window._effects = { speed: 0.8, bass: 10, treble: 0, reverb: true, is8d: false };
            });
            await sendMessage('🌊 Vaporwave mode ON!\n🐢 Speed 0.8x | 🔊 Bass +10dB | 🏛️ Reverb ON');
        }

        // ── !slowed ────────────────────────────────────────────────
        else if (cmd === 'slowed') {
            await page.evaluate(() => {
                if (window._8dInterval) { clearInterval(window._8dInterval); window._8dInterval = null; }
                window._pannerNode.pan.value      = 0;
                window._audioElement.playbackRate = 0.85;
                window._bassFilter.gain.value     = 4;
                window._trebleFilter.gain.value   = 0;
                window._reverbGain.gain.value     = 0.5;
                window._dryGain.gain.value        = 0.55;
                window._effects = { speed: 0.85, bass: 4, treble: 0, reverb: true, is8d: false };
            });
            await sendMessage('💤 Slowed + Reverb ON!\n🐢 Speed 0.85x | 🔊 Bass +4dB | 🏛️ Reverb ON 🌙');
        }

        // ── !fx ────────────────────────────────────────────────────
        else if (cmd === 'fx') {
            const fx = await page.evaluate(() => window._effects);
            const lines = [
                `🎛️ *Audio Effects Status*`,
                `⚡ Speed   : ${fx.speed}x`,
                `🔊 Bass    : ${fx.bass > 0 ? '+' + fx.bass + 'dB' : 'OFF'}`,
                `✨ Treble  : ${fx.treble > 0 ? '+' + fx.treble + 'dB' : 'OFF'}`,
                `🏛️ Reverb  : ${fx.reverb ? 'ON' : 'OFF'}`,
                `🎧 8D Audio: ${fx.is8d ? 'ON' : 'OFF'}`,
                ``,
                `!fxreset untuk reset semua efek`
            ].join('\n');
            await sendMessage(lines);
        }

        // ── !fxreset ───────────────────────────────────────────────
        else if (cmd === 'fxreset') {
            await page.evaluate(() => {
                window._audioElement.playbackRate  = 1.0;
                window._bassFilter.gain.value      = 0;
                window._trebleFilter.gain.value    = 0;
                window._reverbGain.gain.value      = 0;
                window._dryGain.gain.value         = 1.0;
                window._pannerNode.pan.value       = 0;
                if (window._8dInterval) { clearInterval(window._8dInterval); window._8dInterval = null; }
                window._effects = { speed: 1.0, bass: 0, treble: 0, reverb: false, is8d: false };
            });
            await sendMessage('🔄 Semua efek audio direset ke normal!');
        }
    }
};
