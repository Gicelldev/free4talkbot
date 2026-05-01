const economy = require('../economy.js');

module.exports = {
    commands: [
        'chop', 'farm', 'dig', 'cook', 'pray', 'hack', 'sing', 'build', 'paint', 'scavenge',
        'brew', 'research', 'sew', 'carve', 'weld', 'weave', 'forge', 'distill', 'pluck', 'skin',
        'shear', 'milk', 'extract', 'analyze', 'compose', 'sculpt', 'exorcise', 'meditate', 'program', 'stream',
        'beg', 'busk', 'juggle', 'perform', 'lecture', 'patrol', 'scout', 'spy', 'guard', 'massage',
        'tattoo', 'pierce', 'cut', 'makeup', 'photo', 'film', 'write', 'draw', 'bake', 'grill',
        'blend', 'roast', 'harvest', 'gather', 'collect', 'trap', 'track', 'excavate', 'salvage', 'repair'
    ],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {
        const userId = sender.uid || userMap.get(sender.name) || sender.name;
        const user = economy.getUser(db, userId, sender.name);

        const activities = {
            'chop': { tool: 'Axe', cdKey: 'lastChop', cdTime: 300000, reward: 'Kayu 🪵', xp: 50, verb: 'menebang pohon' },
            'farm': { tool: 'Hoe', cdKey: 'lastFarm', cdTime: 300000, reward: 'Padi 🌾', xp: 50, verb: 'bertani' },
            'dig': { tool: 'Shovel', cdKey: 'lastDig', cdTime: 300000, reward: 'Tulang 🦴', xp: 40, verb: 'menggali' },
            'cook': { tool: 'Pan', cdKey: 'lastCook', cdTime: 300000, reward: 'Burger 🍔', xp: 60, verb: 'memasak' },
            'pray': { tool: 'Rosary', cdKey: 'lastPray', cdTime: 600000, reward: 'Holy Water 💧', xp: 100, verb: 'berdoa' },
            'hack': { tool: 'Laptop', cdKey: 'lastHack', cdTime: 600000, reward: 'Data Chip 💾', xp: 150, verb: 'hacking' },
            'sing': { tool: 'Guitar', cdKey: 'lastSing', cdTime: 300000, reward: 'Tip (Money)', xp: 70, verb: 'ngamen' },
            'build': { tool: 'Hammer', cdKey: 'lastBuild', cdTime: 600000, reward: 'Kursi 🪑', xp: 80, verb: 'nukang' },
            'paint': { tool: 'Brush', cdKey: 'lastPaint', cdTime: 450000, reward: 'Lukisan 🎨', xp: 80, verb: 'melukis' },
            'scavenge': { tool: 'Flashlight', cdKey: 'lastScavenge', cdTime: 300000, reward: 'Scrap 🔩', xp: 40, verb: 'memulung' },

            'sew': { tool: 'Needle', cdKey: 'lastSew', cdTime: 300000, reward: 'Kain 🧵', xp: 50, verb: 'menjahit' },
            'weave': { tool: 'Loom', cdKey: 'lastWeave', cdTime: 300000, reward: 'Sutra 🧣', xp: 55, verb: 'menenun' },
            'carve': { tool: 'Chisel', cdKey: 'lastCarve', cdTime: 300000, reward: 'Patung Kayu 🗿', xp: 60, verb: 'mengukir' },
            'sculpt': { tool: 'Clay', cdKey: 'lastSculpt', cdTime: 300000, reward: 'Vas Bunga 🏺', xp: 60, verb: 'memahat' },
            'weld': { tool: 'Torch', cdKey: 'lastWeld', cdTime: 300000, reward: 'Plat Besi 🛡️', xp: 65, verb: 'mengelas' },
            'forge': { tool: 'Anvil', cdKey: 'lastForge', cdTime: 400000, reward: 'Pedang Tumpul 🗡️', xp: 70, verb: 'menempa' },
            'repair': { tool: 'Wrench', cdKey: 'lastRepair', cdTime: 300000, reward: 'Spare Part ⚙️', xp: 50, verb: 'memperbaiki mesin' },
            'glass': { tool: 'Blower', cdKey: 'lastGlass', cdTime: 300000, reward: 'Botol Kaca 🥃', xp: 55, verb: 'meniup kaca' },

            'brew': { tool: 'Cauldron', cdKey: 'lastBrew', cdTime: 300000, reward: 'Ramuan 🧪', xp: 60, verb: 'meracik obat' },
            'distill': { tool: 'Still', cdKey: 'lastDistill', cdTime: 300000, reward: 'Alkohol 🍾', xp: 60, verb: 'menyuling' },
            'bake': { tool: 'Oven', cdKey: 'lastBake', cdTime: 300000, reward: 'Roti 🍞', xp: 50, verb: 'memanggang roti' },
            'grill': { tool: 'Grill', cdKey: 'lastGrill', cdTime: 300000, reward: 'Steak 🥩', xp: 55, verb: 'membakar daging' },
            'blend': { tool: 'Blender', cdKey: 'lastBlend', cdTime: 240000, reward: 'Jus 🍹', xp: 40, verb: 'membuat jus' },
            'roast': { tool: 'Roaster', cdKey: 'lastRoast', cdTime: 300000, reward: 'Kopi ☕', xp: 50, verb: 'menyangrai kopi' },

            'pluck': { tool: 'Gloves', cdKey: 'lastPluck', cdTime: 180000, reward: 'Herba 🌿', xp: 30, verb: 'memetik tanaman' },
            'skin': { tool: 'Knife', cdKey: 'lastSkin', cdTime: 300000, reward: 'Kulit 🐄', xp: 50, verb: 'menguliti' },
            'shear': { tool: 'Shears', cdKey: 'lastShear', cdTime: 300000, reward: 'Wool 🧶', xp: 45, verb: 'mencukur domba' },
            'milk': { tool: 'Bucket', cdKey: 'lastMilk', cdTime: 240000, reward: 'Susu 🥛', xp: 40, verb: 'memerah susu' },
            'harvest': { tool: 'Sickle', cdKey: 'lastHarvest', cdTime: 300000, reward: 'Jagung 🌽', xp: 50, verb: 'memanen' },
            'gather': { tool: 'Basket', cdKey: 'lastGather', cdTime: 240000, reward: 'Berry 🍒', xp: 35, verb: 'mengumpulkan buah' },
            'collect': { tool: 'Net', cdKey: 'lastCollect', cdTime: 240000, reward: 'Kupu-kupu 🦋', xp: 35, verb: 'menangkap serangga' },
            'trap': { tool: 'Cage', cdKey: 'lastTrap', cdTime: 400000, reward: 'Kelinci 🐇', xp: 60, verb: 'memasang perangkap' },
            'track': { tool: 'Compass', cdKey: 'lastTrack', cdTime: 450000, reward: 'Jejak Hewan 🐾', xp: 55, verb: 'melacak' },

            'research': { tool: 'Microscope', cdKey: 'lastResearch', cdTime: 600000, reward: 'Formula 🔬', xp: 120, verb: 'meneliti' },
            'analyze': { tool: 'Magnifier', cdKey: 'lastAnalyze', cdTime: 500000, reward: 'Bukti 🔎', xp: 100, verb: 'menganalisa' },
            'program': { tool: 'Server', cdKey: 'lastProgram', cdTime: 600000, reward: 'Software 📀', xp: 150, verb: 'coding' },
            'extract': { tool: 'Syringe', cdKey: 'lastExtract', cdTime: 400000, reward: 'Racun ☠️', xp: 80, verb: 'mengekstrak' },

            'compose': { tool: 'Pen', cdKey: 'lastCompose', cdTime: 450000, reward: 'Lagu 🎼', xp: 90, verb: 'mengarang lagu' },
            'write': { tool: 'Typewriter', cdKey: 'lastWrite', cdTime: 600000, reward: 'Novel 📖', xp: 100, verb: 'menulis novel' },
            'draw': { tool: 'Pencil', cdKey: 'lastDraw', cdTime: 300000, reward: 'Sketsa 📝', xp: 50, verb: 'menggambar' },
            'photo': { tool: 'Camera', cdKey: 'lastPhoto', cdTime: 300000, reward: 'Foto 📷', xp: 60, verb: 'memotret' },
            'film': { tool: 'VideoCam', cdKey: 'lastFilm', cdTime: 600000, reward: 'Film 🎬', xp: 120, verb: 'syuting' },
            'stream': { tool: 'Mic', cdKey: 'lastStream', cdTime: 600000, reward: 'Donasi (Money)', xp: 100, verb: 'streaming' },

            'beg': { tool: 'Bowl', cdKey: 'lastBeg', cdTime: 120000, reward: 'Receh (Money)', xp: 20, verb: 'mengemis' },
            'busk': { tool: 'Harmonica', cdKey: 'lastBusk', cdTime: 240000, reward: 'Tip (Money)', xp: 40, verb: 'ngamen' },
            'juggle': { tool: 'Balls', cdKey: 'lastJuggle', cdTime: 300000, reward: 'Tip (Money)', xp: 50, verb: 'atraksi' },
            'perform': { tool: 'Mask', cdKey: 'lastPerform', cdTime: 400000, reward: 'Tiket 🎫', xp: 80, verb: 'pentas seni' },
            'lecture': { tool: 'Podium', cdKey: 'lastLecture', cdTime: 600000, reward: 'Honor (Money)', xp: 100, verb: 'kuliah' },
            'massage': { tool: 'Oil', cdKey: 'lastMassage', cdTime: 300000, reward: 'Tip (Money)', xp: 60, verb: 'memijat' },
            'tattoo': { tool: 'InkGun', cdKey: 'lastTattoo', cdTime: 400000, reward: 'Tato 🐉', xp: 80, verb: 'mentato' },
            'pierce': { tool: 'Piercer', cdKey: 'lastPierce', cdTime: 300000, reward: 'Anting 💍', xp: 60, verb: 'tindik' },
            'cut': { tool: 'Scissors', cdKey: 'lastCut', cdTime: 300000, reward: 'Rambut 💇', xp: 50, verb: 'potong rambut' },
            'makeup': { tool: 'MakeupKit', cdKey: 'lastMakeup', cdTime: 300000, reward: 'Beauty 💄', xp: 50, verb: 'makeup' },

            'exorcise': { tool: 'Cross', cdKey: 'lastExorcise', cdTime: 600000, reward: 'Roh Jahat 👻', xp: 100, verb: 'mengusir setan' },
            'meditate': { tool: 'Mat', cdKey: 'lastMeditate', cdTime: 600000, reward: 'Karma 🕉️', xp: 100, verb: 'meditasi' },
            'patrol': { tool: 'Badge', cdKey: 'lastPatrol', cdTime: 600000, reward: 'Medali 🏅', xp: 80, verb: 'patroli' },
            'scout': { tool: 'Binoculars', cdKey: 'lastScout', cdTime: 400000, reward: 'Peta 🗺️', xp: 60, verb: 'mengintai' },
            'spy': { tool: 'Spyglass', cdKey: 'lastSpy', cdTime: 600000, reward: 'Intel 📁', xp: 100, verb: 'memata-matai' },
            'guard': { tool: 'Shield', cdKey: 'lastGuard', cdTime: 600000, reward: 'Gaji (Money)', xp: 90, verb: 'berjaga' },
            'excavate': { tool: 'Brush', cdKey: 'lastExcavate', cdTime: 600000, reward: 'Fosil 🦖', xp: 100, verb: 'ekskavasi' },
            'salvage': { tool: 'Crowbar', cdKey: 'lastSalvage', cdTime: 400000, reward: 'Besi Tua ⛓️', xp: 60, verb: 'membongkar' }
        };

        const act = activities[cmd];
        if (!act) return;

        const hasTool = user.inventory.find(i => i.name === act.tool);
        if (!hasTool) {
            return await sendMessage(`❌ Kudu punya **${act.tool}** buat ${cmd}! Beli di !shop.`);
        }

        const lastTime = user[act.cdKey] || 0;
        const check = economy.checkCooldown(lastTime, act.cdTime);
        if (!check.ready) {
            return await sendMessage(`⏳ Santai bos, tunggu ${economy.formatTime(check.timeLeft)} lagi buat ${cmd}.`);
        }

        user[act.cdKey] = Date.now();
        const leveledUp = economy.addXp(user, act.xp);

        let rewardMsg = '';

        if (act.reward.includes('(Money)')) {
            const baseMoney = 50 + (user.level * 10);
            const moneyEarned = economy.random(baseMoney, baseMoney * 3);
            user.balance += moneyEarned;
            rewardMsg = `mendapatkan ${act.reward.replace('(Money)', '')} sebesar 💰 ${moneyEarned} coins!`;
        } else {
            let qty = 1;
            if (Math.random() < 0.25) qty = 2;
            if (Math.random() < 0.05) qty = 3;

            for (let i = 0; i < qty; i++) {
                user.inventory.push({
                    name: act.reward,
                    type: 'material',
                    effect: {},
                    boughtAt: Date.now()
                });
            }
            rewardMsg = `mendapatkan ${qty}x ${act.reward}!`;
        }

        economy.saveEconomyDB(db);

        let msgOutput = `✅ ${sender.name} lagi ${act.verb}... ${rewardMsg}\n⭐ +${act.xp} XP`;
        if (leveledUp) {
            msgOutput += `\n🎉 LEVEL UP! Level ${user.level} (Full Heal + Bonus Coins)`;
        }

        await sendMessage(msgOutput);
    }
};
