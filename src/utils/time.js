
// src/utils/time.js
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const { UZ_MONTHS } = require("./months");

function nowISO() {
    return dayjs().tz("Asia/Tashkent").toDate();
}

function startOfToday() {
    return dayjs().tz("Asia/Tashkent").startOf("day").toDate();
}

function formatMonthYear(date = new Date()) {
    const d = dayjs(date).tz("Asia/Tashkent");
    const monthName = UZ_MONTHS[d.month()];
    const year = String(d.year()).slice(-2);
    return `${monthName}-${year}`;
}

function formatHM(d) {
    return dayjs(d).tz("Asia/Tashkent").format("HH:mm");
}

module.exports = { 
    nowISO, 
    startOfToday, 
    formatDT: (d) => dayjs(d).tz("Asia/Tashkent").format("YYYY-MM-DD HH:mm"),
    formatHM, 
    formatMonthYear 
};