const economy = require('../economy.js');

module.exports = {
    commands: ['shop', 'buy', 'inventory', 'inv', 'use', 'sell'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        if (cmd === 'shop') {
            const shop = db.settings.shop;
            if (!shop || typeof shop !== 'object') {
                return await sendMessage('❌ Shop belum dikonfigurasi! Tambahkan data "shop" di economy.json > settings.');
            }
            const items = Object.entries(shop);

            const page = parseInt(args) || 1;
            const limit = 15;
            const totalPages = Math.ceil(items.length / limit);

            if (page < 1 || page > totalPages) return await sendMessage(`❌ Halaman tidak valid! Shop cuma punya ${totalPages} halaman.`);

            const start = (page - 1) * limit;
            const end = start + limit;
            const displayedItems = items.slice(start, end);

            let msg = `🛒 **SHOP RAJA (Page ${page}/${totalPages})** 🛒\n\n`;

            displayedItems.forEach(([itemName, item], i) => {
                const globalIndex = start + i + 1;
                msg += `${globalIndex}. **${itemName}**\n`;
                msg += `   💰 ${item.price} ${db.settings.currency}\n`;
                msg += `   📝 ${item.description}\n`;
            });

            msg += `\n📄 Ketik **!shop ${page + 1}** untuk halaman selanjutnya.`;
            msg += `\n🛒 Beli: **!buy <nama/nomor>**`;

            await sendMessage(msg.trim());
        }

        else if (cmd === 'buy') {
            if (!args) return await sendMessage('❓ Format: !buy <nama item / nomor> [jumlah]');

            const parts = args.split(' ');
            let amount = 1;
            let itemInput = args;

            if (parts.length > 1 && !isNaN(parts[parts.length - 1])) {
                amount = parseInt(parts[parts.length - 1]);
                itemInput = parts.slice(0, -1).join(' ');
            }

            if (amount < 1) amount = 1;

            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);
            const shop = db.settings.shop;
            const shopKeys = Object.keys(shop);

            let itemName = null;

            const index = parseInt(itemInput);
            if (!isNaN(index) && index >= 1 && index <= shopKeys.length) {
                itemName = shopKeys[index - 1];
            } else {
                itemName = shopKeys.find(name =>
                    name.toLowerCase().includes(itemInput.toLowerCase()) ||
                    itemInput.toLowerCase().includes(name.toLowerCase().replace(/[^\w\s]/g, ''))
                );
            }

            if (!itemName) return await sendMessage(`❌ Item "${itemInput}" tidak ditemukan! Ketik !shop untuk lihat daftar.`);

            const item = shop[itemName];
            const totalPrice = item.price * amount;

            if (user.balance < totalPrice) {
                return await sendMessage(`❌ ${sender.name}, balance tidak cukup!\n💰 Total: ${totalPrice} ${db.settings.currency}\n💳 Balance: ${user.balance} ${db.settings.currency}`);
            }

            user.balance -= totalPrice;

            if (!user.inventory) user.inventory = [];

            for (let i = 0; i < amount; i++) {
                user.inventory.push({
                    name: itemName,
                    type: item.type,
                    effect: item.effect,
                    boughtAt: Date.now()
                });
            }

            economy.saveEconomyDB(db);

            await sendMessage(`✅ ${sender.name} membeli ${amount}x ${itemName}!\n💰 -${totalPrice} ${db.settings.currency}\n💳 Balance: ${user.balance} ${db.settings.currency}`);
        }

        else if (cmd === 'sell') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);
            const shop = db.settings.shop;

            const getSellPrice = (itemName) => {
                const prices = {
                    'Chip': 1000,
                    'Gold': 500, 'Diamond': 1000, 'Iron': 100, 'Sampah': 10, 'Batu': 5,

                    'Kayu': 50, 'Padi': 40, 'Tulang': 25, 'Burger': 100, 'Holy Water': 200,
                    'Data Chip': 500, 'Kursi': 150, 'Lukisan': 300, 'Scrap': 30,

                    'Kain': 60, 'Sutra': 120, 'Patung Kayu': 200, 'Vas Bunga': 250, 'Plat Besi': 150,
                    'Pedang Tumpul': 300, 'Spare Part': 100, 'Botol Kaca': 80,

                    'Ramuan': 250, 'Alkohol': 180, 'Roti': 50, 'Steak': 120, 'Jus': 60, 'Kopi': 70,

                    'Herba': 40, 'Kulit': 80, 'Wool': 70, 'Susu': 50, 'Jagung': 45, 'Berry': 30,
                    'Kupu-kupu': 30, 'Kelinci': 150, 'Jejak Hewan': 10,

                    'Formula': 600, 'Bukti': 500, 'Software': 800, 'Racun': 400,

                    'Lagu': 350, 'Novel': 500, 'Sketsa': 100, 'Foto': 150, 'Film': 700,

                    'Receh': 20, 'Tip': 50, 'Tiket': 100, 'Honor': 200, 'Tato': 300,
                    'Anting': 250, 'Rambut': 10, 'Beauty': 150, 'Roh Jahat': 500, 'Karma': 1,
                    'Medali': 400, 'Peta': 200, 'Intel': 600, 'Gaji': 300, 'Fosil': 1000,
                    'Besi Tua': 80
                };

                for (const [key, val] of Object.entries(prices)) {
                    if (itemName.includes(key)) return val;
                }

                const shopKey = Object.keys(shop).find(k => itemName.includes(k));
                if (shopKey) return Math.floor(shop[shopKey].price * 0.5);

                return 0;
            };

            const invMap = {};
            if (user.inventory) {
                user.inventory.forEach(item => {
                    invMap[item.name] = (invMap[item.name] || 0) + 1;
                });
            }
            const invItems = Object.entries(invMap);

            if (!args) {
                if (invItems.length === 0) return await sendMessage('📦 Inventory kosong! Gak ada yang bisa dijual.');

                let sellMsg = `🏪 **PASAR BARANG BEKAS** 🏪\n\n`;
                invItems.forEach(([name, count], i) => {
                    const price = getSellPrice(name);
                    const priceTag = price > 0 ? `💰 ${price}` : '❌ Gak laku';
                    sellMsg += `${i + 1}. ${name} (x${count}) ➡️ ${priceTag}\n`;
                });

                sellMsg += `\nKetik: !sell <nomor> [jumlah]\nContoh: !sell 1 5`;
                return await sendMessage(sellMsg.trim());
            }

            const parts = args.split(' ');
            let targetItemName = '';
            let amount = 1;

            if (!isNaN(parts[0])) {
                const idx = parseInt(parts[0]) - 1;
                if (idx >= 0 && idx < invItems.length) {
                    targetItemName = invItems[idx][0];
                    if (parts.length > 1 && !isNaN(parts[1])) amount = parseInt(parts[1]);
                } else {
                    return await sendMessage('❌ Nomor item salah!');
                }
            } else {
                const nameInput = parts.length > 1 && !isNaN(parts[parts.length - 1]) ? parts.slice(0, -1).join(' ') : args;
                if (parts.length > 1 && !isNaN(parts[parts.length - 1])) amount = parseInt(parts[parts.length - 1]);

                targetItemName = Object.keys(invMap).find(n => n.toLowerCase().includes(nameInput.toLowerCase()));
            }

            if (!targetItemName) return await sendMessage('❌ Item tidak ditemukan di inventory!');

            const ownedCount = invMap[targetItemName];
            if (ownedCount < amount) return await sendMessage(`❌ Barang kurang! Cuma punya ${ownedCount} ${targetItemName}.`);

            const pricePerItem = getSellPrice(targetItemName);
            if (pricePerItem <= 0) return await sendMessage(`❌ ${targetItemName} tidak bisa dijual!`);

            const totalEarned = pricePerItem * amount;

            let removed = 0;
            for (let i = user.inventory.length - 1; i >= 0; i--) {
                if (user.inventory[i].name === targetItemName && removed < amount) {
                    user.inventory.splice(i, 1);
                    removed++;
                }
            }

            user.balance += totalEarned;
            economy.saveEconomyDB(db);

            await sendMessage(`🤝 Deal! Kamu menjual ${amount}x ${targetItemName} seharga ${totalEarned} coins!`);
        }

        else if (cmd === 'inventory' || cmd === 'inv') {
            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);

            const inv = user.inventory || [];

            const countItem = (name) => inv.filter(i => i.name.toLowerCase().includes(name.toLowerCase())).length;

            const healt = user.health || 0;
            const maxHealt = user.maxHealth || 100;
            const armorLevel = countItem('Armor');
            const money = user.balance || 0;
            const level = user.level || 0;
            const exp = user.exp || 0;
            const maxExp = (level + 1) * 1000;
            const rankLevel = Object.values(db.users).sort((a, b) => b.level - a.level).findIndex(u => u.name === user.name) + 1;
            const rankMoney = Object.values(db.users).sort((a, b) => b.balance - a.balance).findIndex(u => u.name === user.name) + 1;

            const itemCounts = {};
            inv.forEach(item => {
                itemCounts[item.name] = (itemCounts[item.name] || 0) + 1;
            });

            const crates = [];
            const tools = [];
            const loot = [];

            Object.entries(itemCounts).forEach(([name, count]) => {
                if (name.includes('Crate')) {
                    crates.push(`${name.replace(' Crate', '')}: *${count}*`);
                } else if (['Pickaxe', 'Axe', 'Hoe', 'Shovel', 'Fishing Rod', 'Sword', 'Armor', 'Laptop', 'Guitar', 'Hammer', 'Brush', 'Flashlight', 'Needle', 'Loom', 'Chisel', 'Clay', 'Torch', 'Anvil', 'Wrench', 'Blower', 'Cauldron', 'Still', 'Oven', 'Grill', 'Blender', 'Roaster', 'Gloves', 'Knife', 'Shears', 'Bucket', 'Sickle', 'Basket', 'Net', 'Cage', 'Compass', 'Microscope', 'Magnifier', 'Server', 'Syringe', 'Pen', 'Typewriter', 'Pencil', 'Camera', 'VideoCam', 'Mic', 'Bowl', 'Harmonica', 'Balls', 'Mask', 'Podium', 'Oil', 'InkGun', 'Piercer', 'Scissors', 'MakeupKit', 'Cross', 'Mat', 'Badge', 'Binoculars', 'Spyglass', 'Shield', 'Crowbar'].some(t => name.includes(t))) {
                    tools.push(`${name} *${count > 1 ? '(x' + count + ')' : '✅'}*`);
                } else {
                    loot.push(`${name}: *${count}*`);
                }
            });

            let armorName = 'Tidak Punya';
            if (armorLevel > 0) armorName = 'Leather Armor';
            if (armorLevel > 5) armorName = 'Iron Armor';

            const xpLeft = maxExp - exp;
            const more = String.fromCharCode(8206);
            const readMore = more.repeat(4001);

            let invMsg = `Inventory *${sender.name}*

Health: *${healt}*
Armor: *${armorName}*
Money: *${money}*
Level: *${level}*
Exp: *${exp}*

*Tools / Alat*
${tools.length > 0 ? tools.join('\n') : '- Tidak punya alat'}

*Inventory / Loot*
${loot.length > 0 ? loot.join('\n') : '- Kosong'}
Total inv: *${inv.length}* item

*Crate*
${crates.length > 0 ? crates.join('\n') : '- Tidak punya crate'}

*Pet*
Kuda: *Tidak Punya*
Rubah: *Tidak Punya*
Kucing: *Tidak Punya*

*Proges*
╭────────────────
│Level *${level}* To Level *${level + 1}*
│Exp *${exp}* -> *${maxExp}* [${xpLeft <= 0 ? `Ready to LevelUP!` : `${xpLeft} XP left`}]
╰────────────────

*achievement*
1.Top level *${rankLevel}*
2.Top Money *${rankMoney}*
${readMore}
Warn: *0*
Banned: *No*`.trim();

            await sendMessage(invMsg);
        }

        else if (cmd === 'use') {
            if (!args) return await sendMessage('❓ Format: !use <nama item>');

            const userId = sender.uid || userMap.get(sender.name) || sender.name;
            const user = economy.getUser(db, userId, sender.name);

            if (!user.inventory || user.inventory.length === 0) return await sendMessage(`❌ ${sender.name}, inventory kosong!`);

            const itemIndex = user.inventory.findIndex(item =>
                item.name.toLowerCase().includes(args.toLowerCase()) ||
                args.toLowerCase().includes(item.name.toLowerCase().replace(/[^\w\s]/g, ''))
            );

            if (itemIndex === -1) return await sendMessage(`❌ Item "${args}" tidak ada di inventory!`);

            const item = user.inventory[itemIndex];

            if (item.type !== 'consumable') return await sendMessage(`❌ ${item.name} tidak bisa digunakan! (Type: ${item.type})`);

            let resultMsg = `✅ ${sender.name} menggunakan ${item.name}!\n\n`;

            if (item.effect.randomReward) {
                const reward = economy.random(item.effect.randomReward.min, item.effect.randomReward.max);
                user.balance += reward;
                resultMsg += `🎁 Dapat ${reward} ${db.settings.currency}!\n💳 Balance: ${user.balance} ${db.settings.currency}`;
            } else if (item.effect.resetCooldown) {
                if (item.effect.resetCooldown === 'hunt') {
                    user.lastHunt = null;
                    resultMsg += `⚡ Hunt cooldown direset!`;
                } else if (item.effect.resetCooldown === 'daily') {
                    user.lastDaily = null;
                    resultMsg += `⚡ Daily cooldown direset!`;
                }
            } else if (item.effect.heal) {
                const healAmount = item.effect.heal;
                const oldHp = user.health || 0;
                user.health = Math.min((user.health || 0) + healAmount, user.maxHealth || 100);
                resultMsg += `❤️ Heal +${healAmount}! HP: ${oldHp} -> ${user.health}`;
            }

            user.inventory.splice(itemIndex, 1);
            economy.saveEconomyDB(db);

            await sendMessage(resultMsg.trim());
        }
    }
};
