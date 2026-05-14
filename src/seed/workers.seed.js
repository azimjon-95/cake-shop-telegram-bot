const Worker = require("../models/Worker");

const mockWorkers = [
    {
        tgId: 39464759,
        username: "Azimjon_M",
        fullName: "Azimjon",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
    {
        tgId: 5470290318,
        username: "-",
        fullName: "Zubayda To'khtanazarova",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
    {
        tgId: 636371190,
        username: "Mamutaliyev1",
        fullName: "Azizjon Mamutaliyev",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
    {
        tgId: 8414914072,
        username: "-",
        fullName: "Gulasal",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
    {
        tgId: 1048497531,
        username: "-",
        fullName: "Gulnoza Xoldarova",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
    // ⚠️ DIQQAT: Yuqoridagi Gulasal bilan tgId bir xil (8414914072)!
    // Agar bu admin account bo'lsa, to'g'ri tgId ni kiriting.
    {
        tgId: 8414914072, // TODO: to'g'ri tgId bilan almashtiring
        username: "totli_sang",
        fullName: "Totli tortlari",
        role: "worker",
        canUseWebApp: true,
        isActive: true,
    },
];

async function seedWorkers() {
    try {
        for (const worker of mockWorkers) {
            const exists = await Worker.findOne({ tgId: worker.tgId });

            if (!exists) {
                await Worker.create(worker);
                console.log(`✅ Worker created: ${worker.username}`);
            } else {
                console.log(`⏭️ Worker exists: ${worker.username}`);
            }
        }

        console.log("🚀 Worker seed completed");
    } catch (err) {
        console.error("❌ Worker seed error:", err.message);
    }
}

module.exports = { seedWorkers };