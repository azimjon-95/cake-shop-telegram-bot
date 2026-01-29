const dayjs = require("dayjs");
const { UZ_MONTHS } = require("./months");

function nowISO() {
    return new Date();
}

function startOfToday() {
    const d = dayjs();
    return d.startOf("day").toDate();
}

function formatDT(d) {
    const dd = dayjs(d);
    return dd.format("YYYY-MM-DD HH:mm");
}

function formatMonthYear(date) {
    const d = new Date(date);
    const monthName = UZ_MONTHS[d.getMonth()]; // 0–11
    const year = String(d.getFullYear()).slice(-2); // 26
    return `${monthName}-${year}`;
}

// ✅ yangi: faqat HH:mm
function formatHM(d) {
    const dd = dayjs(d);
    return dd.format("HH:mm");
}

module.exports = { nowISO, startOfToday, formatDT, formatHM, formatMonthYear };
