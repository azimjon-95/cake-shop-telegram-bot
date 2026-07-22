const { createBot } = require('./src/bot');
const { ensurePinnedMiniAppLinkInGroup } = require('./src/services/pinMessage');

(async () => {
    try {
        const bot = await createBot();
        console.log('🤖 Bot yaratildi...');

        // Majburiy pin
        const result = await ensurePinnedMiniAppLinkInGroup(bot, true);
        console.log('📌 Pin natijasi:', result);
    } catch (e) {
        console.error('❌ XATO:', e?.message || e);
    }
})();