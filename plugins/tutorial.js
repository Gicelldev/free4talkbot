const economy = require('../economy.js');

module.exports = {
    commands: ['tutorial', 'guide', 'cara', 'menu'],

    handle: async (cmd, args, msg, { sender, userMap, sendMessage, db }) => {

        const part1 = `
📚 **TUTORIAL LENGKAP RPG BOT (Part 1/3)** 📚
Selamat datang di dunia RPG! Di sini kamu bisa jadi apa saja: Sultan, Petani, Mafia, atau Penjudii Handal.

💰 **CARA CARI DUIT (PEMULA)**
1.  **!daily** : Absen harian (Wajib! Dapat duit & XP).
2.  **!hunt** : Berburu hewan hutan. Hati-hati HP berkurang!
3.  **!adventure** : Petualangan cari harta karun. Butuh nyali gede.
4.  **!fish** : Mancing ikan (Butuh *Fishing Rod*).
5.  **!mine** : Nambang batu/diamond (Butuh *Pickaxe*).

🛒 **BELANJA & JUALAN**
*   **!shop** : Lihat katalog barang (Alat, Potion, Crate).
*   **!buy <nama/nomor>** : Beli barang. Contoh: \`!buy Axe\` atau \`!buy 1\`.
*   **!sell** : Lihat harga jual barang di tasmu.
*   **!inv** : Cek inventory, status, dan level kamu.
*   **!use <nama>** : Pakai barang (misal Potion buat heal).

❤️ **KESEHATAN PENTING!**
Jangan lupa cek HP kamu. Kalau HP 0, gak bisa kerja!
Beli **Potion** di shop atau Level Up untuk isi darah full.
`;

        const part2 = `
🛠️ **PEKERJAAN & GRINDING (Part 2/3)** 🛠️
Kamu butuh ALAT KHUSUS untuk kerja. Beli di \`!shop\` dulu!

🌲 **ALAM & PERTANIAN**
*   **!chop** (Axe) -> Nebang Kayu 🪵
*   **!farm** (Hoe) -> Tanam Padi 🌾
*   **!dig** (Shovel) -> Gali Tanah 🦴
*   **!pluck** (Gloves) -> Petik Herba 🌿
*   **!shear** (Shears) -> Cukur Domba 🧶
*   **!milk** (Bucket) -> Perah Susu 🥛

🔨 **CRAFTING & KEAHLIAN**
*   **!cook** (Pan) -> Masak Burger 🍔
*   **!build** (Hammer) -> Bikin Kursi 🪑
*   **!sew** (Needle) -> Jahit Kain 🧵
*   **!forge** (Anvil) -> Tempa Pedang ⚔️
*   **!brew** (Cauldron) -> Racik Ramuan 🧪
*   **!repair** (Wrench) -> Perbaiki Mesin ⚙️

🎨 **SENI & TEKNOLOGI**
*   **!paint** (Brush) -> Melukis 🎨
*   **!sing** (Guitar) -> Ngamen 🎵
*   **!hack** (Laptop) -> Hacking Data 💾
*   **!research** (Microscope) -> Penelitian Sains 🔬
*   **!stream** (Mic) -> Tangkap Donasi 🎙️

...dan masih banyak lagi! Cek **!cd** untuk lihat timer kerjamu.
`;

        const part3 = `
🎲 **CRIME & CASINO (Part 3/3)** 🎲
Jalur cepat kaya (atau miskin). Tanggung sendiri akibatnya!

🔫 **KRIMINAL**
*   **!rob <user>** : Rampok duit orang lain! (Butuh *Topeng Maling* biar aman).
*   **!bankrob** : Bobol Bank Utama! Butuh *Lockpick*. Resiko tinggi, hadiah ngeri!
*   **!scavenge** : Mulung barang rongsok (Kerja halal tapi kotor).

🎰 **UPDATE BARU: CASINO**
*   **!slot** : Main Slot Machine. Menang jackpot bisa kaya mendadak!
*   **!flip** : Lempar koin (Head/Tail). Taruhan 50:50.
*   *Tips: Beli **Chip** dulu di shop sebelum main judi!*

🏆 **LEADERBOARD**
*   **!lb** : Cek siapa paling Sultan dan paling Sepuh di server.

Selamat bermain! Jangan lupa istirahat (bohong, grinding terus bos!). 🔥
`;

        await sendMessage(part1.trim());

        await new Promise(r => setTimeout(r, 1000));
        await sendMessage(part2.trim());

        await new Promise(r => setTimeout(r, 1000));
        await sendMessage(part3.trim());
    }
};
