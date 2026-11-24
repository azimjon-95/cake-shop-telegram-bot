// Kichik test runner (qo'shimcha paket kerak emas; Mongo/Redis kerak emas)
let pass = 0, fail = 0;
const queue = [];
exports.test = (name, fn) => queue.push([name, fn]);
exports.eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || "eq"}: kutilgan ${y}, keldi ${x}`); };
exports.ok = (c, m) => { if (!c) throw new Error(m || "ok"); };
exports.rejectsCode = async (p, code, m) => {
    try { await p; } catch (e) { if (e?.code === code) return; throw new Error(`${m || ""} kutilgan kod ${code}, keldi ${e?.code || e?.message}`); }
    throw new Error(`${m || ""} xato kutilgan edi (${code})`);
};
exports.sleep = (ms) => new Promise(r => setTimeout(r, ms));
exports.run = async (title) => {
    console.log(`\n=== ${title} ===`);
    for (const [name, fn] of queue) {
        try { await fn(); pass++; console.log("  ✓", name); }
        catch (e) { fail++; console.log("  ✗", name, "\n     ", e.message); }
    }
    console.log(`\nNATIJA: ${pass} ok, ${fail} xato`);
    process.exit(fail ? 1 : 0);
};
