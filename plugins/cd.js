const economy = require('../economy.js');

module.exports = {
    commands: ['cd', 'cooldown', 'timers'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        const cooldowns = {
            'Daily 📅': { key: 'lastDaily', time: 86400000 },
            'Hunt 🏹': { key: 'lastHunt', time: 120000 },
            'Adventure 🗺️': { key: 'lastAdventure', time: 300000 },
            'Fishing 🎣': { key: 'lastFishing', time: 120000 },
            'Mining ⛏️': { key: 'lastMining', time: 300000 },
            'Rob 🎭': { key: 'lastRob', time: 600000 },
            'Bank Rob 🏦': { key: 'lastBankRob', time: 3600000 },

            'Chop 🪵': { key: 'lastChop', time: 300000 },
            'Farm 🌾': { key: 'lastFarm', time: 300000 },
            'Dig 🦴': { key: 'lastDig', time: 300000 },
            'Cook 🍔': { key: 'lastCook', time: 300000 },
            'Sew 🧵': { key: 'lastSew', time: 300000 },
            'Weave 🧣': { key: 'lastWeave', time: 300000 },
            'Carve 🗿': { key: 'lastCarve', time: 300000 },
            'Sculpt 🏺': { key: 'lastSculpt', time: 300000 },
            'Weld 🛡️': { key: 'lastWeld', time: 300000 },
            'Forge 🗡️': { key: 'lastForge', time: 400000 },
            'Repair ⚙️': { key: 'lastRepair', time: 300000 },
            'Glass 🥃': { key: 'lastGlass', time: 300000 },

            'Brew 🧪': { key: 'lastBrew', time: 300000 },
            'Distill 🍾': { key: 'lastDistill', time: 300000 },
            'Bake 🍞': { key: 'lastBake', time: 300000 },
            'Grill 🥩': { key: 'lastGrill', time: 300000 },
            'Blend 🍹': { key: 'lastBlend', time: 240000 },
            'Roast ☕': { key: 'lastRoast', time: 300000 },

            'Pluck 🌿': { key: 'lastPluck', time: 180000 },
            'Skin 🐄': { key: 'lastSkin', time: 300000 },
            'Shear 🧶': { key: 'lastShear', time: 300000 },
            'Milk 🥛': { key: 'lastMilk', time: 240000 },
            'Harvest 🌽': { key: 'lastHarvest', time: 300000 },
            'Gather 🍒': { key: 'lastGather', time: 240000 },
            'Collect 🦋': { key: 'lastCollect', time: 240000 },
            'Trap 🐇': { key: 'lastTrap', time: 400000 },
            'Track 🐾': { key: 'lastTrack', time: 450000 },

            'Hack 💾': { key: 'lastHack', time: 600000 },
            'Research 🔬': { key: 'lastResearch', time: 600000 },
            'Analyze 🔎': { key: 'lastAnalyze', time: 500000 },
            'Program 📀': { key: 'lastProgram', time: 600000 },
            'Extract ☠️': { key: 'lastExtract', time: 400000 },

            'Sing 🎵': { key: 'lastSing', time: 300000 },
            'Compose 🎼': { key: 'lastCompose', time: 450000 },
            'Write 📖': { key: 'lastWrite', time: 600000 },
            'Draw 📝': { key: 'lastDraw', time: 300000 },
            'Paint 🎨': { key: 'lastPaint', time: 450000 },
            'Photo 📷': { key: 'lastPhoto', time: 300000 },
            'Film 🎬': { key: 'lastFilm', time: 600000 },
            'Stream 🎙️': { key: 'lastStream', time: 600000 },

            'Scavenge 🔩': { key: 'lastScavenge', time: 300000 },
            'Beg 🪙': { key: 'lastBeg', time: 120000 },
            'Busk 🎼': { key: 'lastBusk', time: 240000 },
            'Juggle 🤹': { key: 'lastJuggle', time: 300000 },
            'Perform 🎭': { key: 'lastPerform', time: 400000 },
            'Lecture 🎓': { key: 'lastLecture', time: 600000 },
            'Massage 💆': { key: 'lastMassage', time: 300000 },
            'Tattoo 🐉': { key: 'lastTattoo', time: 400000 },
            'Pierce 💍': { key: 'lastPierce', time: 300000 },
            'Cut 💇': { key: 'lastCut', time: 300000 },
            'Makeup 💄': { key: 'lastMakeup', time: 300000 },

            'Pray 💧': { key: 'lastPray', time: 600000 },
            'Exorcise 👻': { key: 'lastExorcise', time: 600000 },
            'Meditate 🕉️': { key: 'lastMeditate', time: 600000 },
            'Patrol 🏅': { key: 'lastPatrol', time: 600000 },
            'Scout 🗺️': { key: 'lastScout', time: 400000 },
            'Spy 📁': { key: 'lastSpy', time: 600000 },
            'Guard 🛡️': { key: 'lastGuard', time: 600000 },
            'Excavate 🦖': { key: 'lastExcavate', time: 600000 },
            'Salvage ⛓️': { key: 'lastSalvage', time: 400000 },
            'Build 🪑': { key: 'lastBuild', time: 600000 }
        };

        let msgOutput = `⏱️ **Cooldowns ${sender.name}** ⏱️\n\n`;
        let readyCount = 0;
        let activeCount = 0;

        const statusList = [];

        for (const [name, data] of Object.entries(cooldowns)) {
            const lastTime = user[data.key] || 0;
            const check = economy.checkCooldown(lastTime, data.time);

            statusList.push({ name, ready: check.ready, timeLeft: check.timeLeft });
        }

        const activeList = statusList.filter(s => !s.ready);
        const readyList = statusList.filter(s => s.ready);

        if (activeList.length > 0) {
            msgOutput += `⏳ **Tunggu:**\n`;
            activeList.sort((a, b) => a.timeLeft - b.timeLeft).forEach(s => {
                msgOutput += `- ${s.name}: ${economy.formatTime(s.timeLeft)}\n`;
            });
            msgOutput += `\n`;
        }

        msgOutput += `✅ **Siap:** ${readyList.length} Activity! (Ketik !help buat list)\n`;

        if (activeList.length === 0) {
            msgOutput = `⏱️ **Cooldowns ${sender.name}**\n\n🔥 SEMUA SIAP! GASKEUN GRINDING BOS! 🔥`;
        }

        await sendMessage(msgOutput.trim());
    }
};
