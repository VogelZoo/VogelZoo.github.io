// --- INITIAL STATE & CATEGORIZED EXERCISES ---
const DEFAULT_EXERCISES = [
    { name: "Goblet Squat", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Bench Press", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "One-Arm Row", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Romanian Deadlift", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Seated Shoulder Press", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Reverse Lunge", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Incline Dumbell Press", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Chest Supported Row", category: "Strength", metrics: ["sets", "reps", "weight"] },
    { name: "Farmer Carry", category: "Strength", metrics: ["sets", "weight", "timeSeconds"] },
    { name: "Plank", category: "Core", metrics: ["sets", "timeSeconds"] },
    { name: "Side Plank", category: "Core", metrics: ["sets", "timeSeconds"] },
    { name: "Running", category: "Cardio", metrics: ["distance", "timeMinutes"] },
    { name: "Walking", category: "Cardio", metrics: ["distance", "timeMinutes"] },
    { name: "Biking", category: "Cardio", metrics: ["distance", "timeMinutes"] },
    { name: "Yoga", category: "Mobility/Yoga", metrics: ["timeMinutes"] }
];

const DEFAULT_MEASUREMENTS = [
    { key: "weight", name: "Weight", unit: "lbs" },
    { key: "waist", name: "Waist Size", unit: "in" },
    { key: "blood_pressure", name: "Blood Pressure", unit: "mmHg" }
];

// Blood Pressure is the one built-in measurement that needs two numbers
// (systolic/diastolic) instead of one. Rather than generalizing the whole
// measurement schema, it's handled as a special case wherever a measurement
// value is entered or displayed: `value` holds systolic (so existing
// charting/back-compat code that reads `.value` still works), and a sibling
// `diastolic` field rides alongside it on the log entry.
const BLOOD_PRESSURE_KEY = "blood_pressure";
function isBloodPressureKey(key) { return key === BLOOD_PRESSURE_KEY; }
function formatMeasurementValue(log, unit) {
    if (isBloodPressureKey(log.measurementKey) && log.diastolic !== undefined && log.diastolic !== null) {
        return `${log.value}/${log.diastolic}${unit ? ' ' + unit : ''}`;
    }
    return `${log.value}${unit ? ' ' + unit : ''}`;
}

// A virtual, non-deletable pseudo-exercise used solely by the Timer's
// "Log Total Time" action (see TimerModal.logTotalTime). It is deliberately
// NOT part of DEFAULT_EXERCISES / state.exercises — it never appears in the
// exercise picker, Manage Exercises, or the Plan dropdown — but its history
// entries flow through the exact same edit/save/History pipeline as any
// other exercise by name-matching against this constant wherever
// state.exercises.find(...) is used for log-entry rendering.
const TOTAL_TIME_EXERCISE_NAME = "Total Exercise Time";
const TOTAL_TIME_EXERCISE_DEF = { name: TOTAL_TIME_EXERCISE_NAME, category: null, emoji: "⏱️", metrics: ["timeMinutes"] };

// Resolves an exercise definition by name, including the virtual
// Total Exercise Time entry — use this instead of state.exercises.find(...)
// anywhere a history entry's exerciseName might be the virtual one.
function findExerciseDef(name) {
    if (name === TOTAL_TIME_EXERCISE_NAME) return TOTAL_TIME_EXERCISE_DEF;
    return state.exercises.find(e => e.name === name);
}

const FIELD_LABELS = {
    sets: { label: "Sets", type: "number", placeholder: "0", step: "1" },
    reps: { label: "Reps", type: "number", placeholder: "0", step: "1" },
    weight: { label: "Weight (lbs)", type: "number", placeholder: "0.0", step: "0.5" },
    timeSeconds: { label: "Time (Seconds)", type: "number", placeholder: "60", step: "1" },
    timeMinutes: { label: "Time (Minutes)", type: "number", placeholder: "30", step: "1" },
    distance: { label: "Distance (miles)", type: "number", placeholder: "0.00", step: "0.01" }
};

const INTENSITY_COLORS = {
    1: "#4b5563",
    2: "#65a30d",
    3: "#d97706",
    4: "#ea580c",
    5: "#dc2626",
    "Default": "#2563eb"
};

function getIntensityColor(value) {
    if (!value || value < 1) return INTENSITY_COLORS["Default"];
    return INTENSITY_COLORS[Math.round(value)] || INTENSITY_COLORS["Default"];
}

// Haptic feedback via the Vibration API. Supported on Android Chrome
// (including installed PWAs); iOS Safari has no Vibration API at all, even
// when installed to the home screen, so this silently no-ops there.
function haptic(type) {
    if (!("vibrate" in navigator)) return;
    try {
        switch (type) {
            case "light":
                navigator.vibrate(8);
                break;
            case "success":
                navigator.vibrate([12, 40, 12]);
                break;
            case "warning":
                navigator.vibrate([20, 50, 20]);
                break;
            default:
                navigator.vibrate(10);
        }
    } catch (e) {
        // Ignore — vibration is a nice-to-have, never block on it.
    }
}

// Local-date (not UTC) "YYYY-MM-DD" formatter — avoids the day rolling over
// early/late depending on the user's timezone offset from UTC.
function getLocalDateString(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- CHART AGGREGATION (daily / weekly / monthly) ---
// Shared by the Progress Insight chart and the Average Intensity chart so
// both respond to the same granularity toggle. Caps output to the most
// recent MAX_CHART_POINTS buckets — older points are simply not displayed,
// per spec, rather than being dropped before aggregation.
let chartGranularity = "daily";
const MAX_CHART_POINTS = 50;

function setChartGranularity(granularity) {
    chartGranularity = granularity;
    renderStats();
}

// Returns a stable bucket key + a representative "anchor" date (used for
// chart x-axis labels and chronological sorting) for a given YYYY-MM-DD
// date string and granularity.
function getPeriodBucket(dateStr, granularity) {
    if (granularity === "daily") {
        return { key: dateStr, anchorDate: dateStr };
    }

    const d = new Date(dateStr + "T00:00:00");

    if (granularity === "weekly") {
        // ISO-style week: Monday as the start of the week.
        const dayOfWeek = d.getDay(); // 0=Sun..6=Sat
        const diffToMonday = (dayOfWeek === 0) ? -6 : (1 - dayOfWeek);
        const monday = new Date(d);
        monday.setDate(d.getDate() + diffToMonday);
        const key = getLocalDateString(monday);
        return { key, anchorDate: key };
    }

    if (granularity === "monthly") {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const key = `${year}-${month}`;
        const anchorDate = `${year}-${month}-01`;
        return { key, anchorDate };
    }

    return { key: dateStr, anchorDate: dateStr };
}

// Generic aggregator: groups `entries` into period buckets by `dateField`,
// averages every key returned by `numericFieldsFn` (called once per entry),
// and returns buckets sorted chronologically, capped to the most recent
// MAX_CHART_POINTS (oldest buckets are dropped after aggregation).
//
// numericFieldsFn(entry) => { fieldName: number, ... } — every field present
// is averaged across all entries that land in the same bucket. Non-numeric
// metadata can be carried through via extraFieldsFn(entries) => {...}, which
// receives the full array of raw entries in that bucket (e.g. to compute a
// rounded average intensity for dot coloring).
function aggregateByPeriod(entries, granularity, dateField, numericFieldsFn, extraFieldsFn) {
    const buckets = new Map(); // key -> { anchorDate, items: [...] }

    entries.forEach(entry => {
        const { key, anchorDate } = getPeriodBucket(entry[dateField], granularity);
        if (!buckets.has(key)) buckets.set(key, { anchorDate, items: [] });
        buckets.get(key).items.push(entry);
    });

    let result = Array.from(buckets.entries()).map(([key, bucket]) => {
        const fieldSums = {};
        const fieldCounts = {};

        bucket.items.forEach(entry => {
            const fields = numericFieldsFn(entry);
            Object.entries(fields).forEach(([fieldName, val]) => {
                if (!Number.isFinite(val)) return;
                fieldSums[fieldName] = (fieldSums[fieldName] || 0) + val;
                fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
            });
        });

        const averaged = {};
        Object.keys(fieldSums).forEach(fieldName => {
            averaged[fieldName] = fieldSums[fieldName] / fieldCounts[fieldName];
        });

        const extra = extraFieldsFn ? extraFieldsFn(bucket.items) : {};

        return {
            periodKey: key,
            date: bucket.anchorDate,
            count: bucket.items.length,
            ...averaged,
            ...extra
        };
    });

    result.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Most recent N buckets — older points are not displayed.
    if (result.length > MAX_CHART_POINTS) {
        result = result.slice(result.length - MAX_CHART_POINTS);
    }

    return result;
}

// Human-friendly x-axis label for a bucket anchor date, tuned per granularity.
function formatPeriodLabel(anchorDate, granularity) {
    const d = new Date(anchorDate + "T00:00:00");
    if (granularity === "monthly") {
        return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    if (granularity === "weekly") {
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return anchorDate.substring(5);
}

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// --- INLINE SVG ICONS (replace fixed UI emoji in the drawer + Log Modal;
// per-exercise/category emoji chosen by the user are left as-is) ---
const ICON_RULER = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="9" width="19" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M6 9v2.4M9.5 9v3.4M13 9v2.4M16.5 9v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_DUMBBELL = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="19" y="9" width="3" height="6" rx="1" fill="currentColor"/><rect x="5" y="7" width="2.4" height="10" rx="1" fill="currentColor"/><rect x="16.6" y="7" width="2.4" height="10" rx="1" fill="currentColor"/><rect x="7.4" y="11" width="9.2" height="2" fill="currentColor"/></svg>`;
const ICON_CLOCK = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 9v4l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 2h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_CALENDAR = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17" stroke="currentColor" stroke-width="1.6"/><path d="M8 3v3M16 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_SAVE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 4h11l3 3v13H5V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="8" y="4" width="7" height="5" stroke="currentColor" stroke-width="1.6"/><rect x="7.5" y="13" width="9" height="6" stroke="currentColor" stroke-width="1.6"/></svg>`;

function measurementIconHtml() { return ICON_RULER; }

const categoryEmojis = {
    'Strength': '💪',
    'Core': '🧘‍♂️',
    'Cardio': '🏃‍♂️',
    'Mobility/Yoga': '🧘',
    'Default': '🏋️'
};

let state = {
    exercises: JSON.parse(localStorage.getItem("ee_exercises")) || DEFAULT_EXERCISES,
    history: JSON.parse(localStorage.getItem("ee_history")) || [],
    plans: JSON.parse(localStorage.getItem("ee_plans")) || [],
    measurements: JSON.parse(localStorage.getItem("ee_measurements")) || DEFAULT_MEASUREMENTS,
    measurementLogs: JSON.parse(localStorage.getItem("ee_measurement_logs")) || [],
    // Total Time is its own record category — parallel to exercises and
    // measurements — rather than a pseudo-exercise embedded in `history`.
    // Each entry is { id, date, minutes }. See migrateTotalTimeEntries()
    // for one-time migration of older backups that still have Total Time
    // rows embedded in history.
    totalTimeLogs: JSON.parse(localStorage.getItem("ee_total_time_logs")) || [],
    // In-memory only (never persisted) — which 7-Day Horizon card is
    // highlighted. Purely visual now that the inline log form (and its
    // log-date field) is gone; tapping a card just moves this highlight.
    selectedHorizonDate: getLocalDateString(new Date())
};

document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
    setupLog2StarRating();
});

function initApp() {
    if (!Array.isArray(state.measurements)) state.measurements = DEFAULT_MEASUREMENTS;
    if (!Array.isArray(state.measurementLogs)) state.measurementLogs = [];
    if (!Array.isArray(state.totalTimeLogs)) state.totalTimeLogs = [];
    migrateIntensityData();
    migrateTotalTimeEntries();
    saveState();
    evaluateTodayPlans();
    renderPlanExerciseSelector();
    renderPlanList();
    populateChartFilter();
    renderStats();
    renderManageExercises();
    renderManageMeasurements();
    renderStreakWidget();
    renderTodayExercisesCard();
    renderTrackKpis();
    renderStatsKpis();
}

function migrateIntensityData() {
    const legacyMap = { "Low": 1, "Medium": 3, "High": 5 };
    let changed = false;
    state.history.forEach(h => {
        if (typeof h.intensity === "string") {
            if (legacyMap[h.intensity] !== undefined) {
                h.intensity = legacyMap[h.intensity];
            } else if (h.intensity.trim() === "") {
                h.intensity = null;
            } else {
                let parsed = parseInt(h.intensity, 10);
                h.intensity = Number.isFinite(parsed) ? parsed : null;
            }
            changed = true;
        } else if (h.intensity === undefined) {
            h.intensity = null;
            changed = true;
        }
    });
    if (changed) saveState();
}

// One-time migration: older backups/sessions stored Total Time as a
// pseudo-exercise entry inside `history` (exerciseName === TOTAL_TIME_EXERCISE_NAME).
// That polluted exercise-only stats like "Most Logged Exercise". This pulls
// any such entries out into state.totalTimeLogs (their own category) and
// strips them from history. Safe to call every load — a no-op once migrated.
function migrateTotalTimeEntries() {
    const embedded = state.history.filter(h => h.exerciseName === TOTAL_TIME_EXERCISE_NAME);
    if (embedded.length === 0) return false;

    embedded.forEach(entry => {
        state.totalTimeLogs.push({
            id: entry.id,
            date: entry.date,
            minutes: (entry.data && entry.data.timeMinutes) || 0
        });
    });
    state.history = state.history.filter(h => h.exerciseName !== TOTAL_TIME_EXERCISE_NAME);
    state.totalTimeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
    return true;
}

function saveState() {
    localStorage.setItem("ee_exercises", JSON.stringify(state.exercises));
    localStorage.setItem("ee_history", JSON.stringify(state.history));
    localStorage.setItem("ee_plans", JSON.stringify(state.plans));
    localStorage.setItem("ee_measurements", JSON.stringify(state.measurements));
    localStorage.setItem("ee_measurement_logs", JSON.stringify(state.measurementLogs));
    localStorage.setItem("ee_total_time_logs", JSON.stringify(state.totalTimeLogs));
    if (typeof BackupSync !== "undefined") BackupSync.notifyStateChanged();
}

function getCategoryEmoji(category) {
    return categoryEmojis[category] || categoryEmojis['Default'];
}

// --- SYSTEM NAVIGATION ---
// Bottom nav now covers exactly 4 tabs: track, stats, timer, history.
// Plan / Custom Exercise / Custom Measurement / Backup&Data moved into the
// hamburger SettingsDrawer, and are no longer top-level views.
function switchView(viewId) {
    haptic('light');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));

    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    const navBtn = document.getElementById(`nav-${viewId}`);
    if (navBtn) navBtn.classList.add('active');

    if (viewId === 'track') {
        evaluateTodayPlans();
        renderStreakWidget();
        renderTodayExercisesCard();
        renderTrackKpis();
    }
    if (viewId === 'stats') { populateChartFilter(); renderStats(); renderStatsKpis(); }
    if (viewId === 'history') { renderStats(); /* keeps history-grouped-container fresh */ }
    if (viewId === 'timer') { TimerModal.refreshUI(); }
}

// --- CORE STREAK TRACKING ENGINE ---
// The standalone floating streak card is gone — its value now feeds the
// Track tab's top KPI row (see renderTrackKpis) and the Stats tab's streak
// KPI card (see renderStatsKpis). This function is kept as the canonical
// "recompute and push the streak number wherever it's displayed" entry
// point, since several call sites already invoke it by name.
function renderStreakWidget() {
    let currentStreak = calculateStreak();
    const trackEl = document.getElementById("kpi-streak-value");
    if (trackEl) trackEl.textContent = currentStreak;
    const statsEl = document.getElementById("kpi2-streak-value");
    if (statsEl) statsEl.innerHTML = `${currentStreak} <span class="kpi-card-unit">days</span>`;
    return currentStreak;
}

function calculateStreak() {
    let todayStr = getLocalDateString(new Date());
    let checkDate = new Date(todayStr + "T00:00:00");
    let streak = 0;

    // Build unique tracking map of logged historical event dates
    let historyDates = new Set(state.history.map(h => h.date));

    // Guard checking if any action occurred today or yesterday to continue loop validation
    let yesterdayStr = getLocalDateString(new Date(new Date().setDate(new Date().getDate() - 1)));
    if (!historyDates.has(todayStr) && !historyDates.has(yesterdayStr)) {
        // If nothing logged today or yesterday, check if yesterday was an explicit scheduled plan rest day
        let yesterdayPlan = getPlannedExercisesForDate(new Date(new Date().setDate(new Date().getDate() - 1)));
        let yesterdayWasRest = (yesterdayPlan.length === 0 || isRestDayExplicitlyScheduled(new Date(new Date().setDate(new Date().getDate() - 1))));
        if (!yesterdayWasRest) return 0;
    }

    // Step backwards through time to count consecutive successful days
    for (let i = 0; i < 365; i++) {
        let loopDateStr = getLocalDateString(checkDate);
        let isExplicitRest = isRestDayExplicitlyScheduled(new Date(checkDate));

        if (historyDates.has(loopDateStr) || isExplicitRest) {
            streak++;
        } else {
            // Break loop if today is a non-rest day that has not been logged yet
            if (i === 0 && loopDateStr === todayStr) {
                // Skip breaking, user still has time to complete today's log
            } else {
                break;
            }
        }
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
}

function isRestDayExplicitlyScheduled(targetDate) {
    const d = new Date(targetDate);
    d.setHours(0, 0, 0, 0);
    const dayOfWeek = d.getDay();
    const ds = getLocalDateString(d);

    return state.plans.some(plan => {
        if (plan.exercise !== '__rest__') return false;
        if (plan.type === 'weekly') return parseInt(plan.day) === dayOfWeek;
        if (plan.type === 'interval' && plan.startDate) {
            const start = new Date(plan.startDate + 'T00:00:00');
            start.setHours(0, 0, 0, 0);
            const diff = Math.round((d - start) / 86400000);
            return diff >= 0 && diff % parseInt(plan.interval) === 0;
        }
        return false;
    });
}

// --- INTERPOLATED ACTIVITY ENGINE & ADVANCED SCHEDULING ---
// Now purely a "recompute everything that depends on plans/history" entry
// point — the old inline-form date suggestion box is gone, and exercise
// selection now happens via LogModal, which doesn't need a priority list.
function evaluateTodayPlans() {
    render7DayHorizon(new Date());
    renderTodayExercisesCard();
    renderTrackKpis();
}

function getPlannedExercisesForDate(targetDate) {
    let matches = [];
    let queryDate = new Date(targetDate);
    queryDate.setHours(0,0,0,0);

    // 1. Process weekly scheduled routines — sorted by the plan's `order`
    // field (set via drag-reorder in the Plan tab) so downstream consumers
    // (7-Day Horizon tags, Today's Exercises card, chart dropdown stars)
    // all reflect the same superset ordering the user arranged.
    let weeklyMatchesForDay = state.plans.filter(plan =>
        plan.type === 'weekly' && plan.exercise !== "__rest__" && parseInt(plan.day) === queryDate.getDay()
    );
    weeklyMatchesForDay.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    weeklyMatchesForDay.forEach(plan => matches.push(plan.exercise));

    // 2. Process interval-based routines with rest-day adjustments
    state.plans.forEach(plan => {
        if (plan.type === 'interval') {
            let start = new Date(plan.startDate + "T00:00:00");
            start.setHours(0,0,0,0);
            
            if (queryDate < start) return;

            // Step forward day by day from the start date to evaluate the intervals
            let workingDate = new Date(start);
            let intervalDayCounter = 0;

            while (workingDate <= queryDate) {
                let isWorkingRestDay = isRestDayExplicitlyScheduled(workingDate);

                if (isWorkingRestDay) {
                    // Rest days are skipped entirely for interval counting
                    if (workingDate.getTime() === queryDate.getTime()) {
                        return; // It's a rest day, so nothing is scheduled
                    }
                } else {
                    if (intervalDayCounter % parseInt(plan.interval) === 0) {
                        if (workingDate.getTime() === queryDate.getTime()) {
                            matches.push(plan.exercise);
                        }
                    }
                    intervalDayCounter++;
                }
                workingDate.setDate(workingDate.getDate() + 1);
            }
        }
    });

    return matches;
}

// Compact "prev setpoint" string for an exercise, e.g. "3 sets × 10 reps × @135lbs"
// built from whichever metrics that exercise tracks, using its most recent
// logged entry. Returns "" if there's no prior entry to show.
const SETPOINT_FORMAT_ORDER = ["sets", "reps", "weight", "distance", "timeMinutes", "timeSeconds"];

function formatPrevSetpoint(exerciseName) {
    const entry = getPreviousEntry(exerciseName);
    if (!entry || !entry.data) return "";

    const parts = [];
    SETPOINT_FORMAT_ORDER.forEach(key => {
        const val = entry.data[key];
        if (val === undefined || val === null) return;
        if (key === "sets") parts.push(`${val} sets`);
        else if (key === "reps") parts.push(`${val} reps`);
        else if (key === "weight") parts.push(`@${val}lbs`);
        else if (key === "distance") parts.push(`${val}mi`);
        else if (key === "timeMinutes") parts.push(`${val}min`);
        else if (key === "timeSeconds") parts.push(`${val}s`);
    });

    return parts.join(" × ");
}

// --- TODAY'S EXERCISES CARD (Track tab) ---
// Always reflects the actual calendar "today", independent of whatever date
// is selected in the inline log form above it. Each instance of a scheduled
// exercise gets its own row — if scheduled 2x today, two rows render, and
// each flips to "Edit" independently as soon as its own instance is logged
// (matched oldest-logged-first against scheduled order).
function renderTodayExercisesCard() {
    const container = document.getElementById("today-exercises-list");
    const card = document.getElementById("today-exercises-card");
    if (!container || !card) return;

    const today = new Date();
    const todayStr = getLocalDateString(today);
    const scheduledToday = getPlannedExercisesForDate(today).filter(name => name !== "__rest__");

    if (scheduledToday.length === 0) {
        card.classList.add("hidden");
        container.innerHTML = "";
        return;
    }
    card.classList.remove("hidden");

    // Today's logged entries per exercise name, oldest-first, so the Nth
    // scheduled instance of an exercise maps to the Nth entry logged today.
    let loggedTodayByName = {};
    state.history.forEach(entry => {
        if (entry.date === todayStr) {
            if (!loggedTodayByName[entry.exerciseName]) loggedTodayByName[entry.exerciseName] = [];
            loggedTodayByName[entry.exerciseName].push(entry);
        }
    });
    Object.values(loggedTodayByName).forEach(list => list.sort((a, b) => a.id - b.id));

    let seenSoFar = {};
    container.innerHTML = scheduledToday.map(name => {
        const instanceIdx = (seenSoFar[name] = (seenSoFar[name] || 0) + 1);
        const todaysLogs = loggedTodayByName[name] || [];
        const matchedEntry = todaysLogs[instanceIdx - 1] || null;
        const isDone = !!matchedEntry;

        const ex = state.exercises.find(e => e.name === name);
        const emoji = (ex && ex.emoji) ? ex.emoji : getCategoryEmoji(ex && ex.category);
        const safeName = name.replace(/'/g, "\\'");
        const prevSetpoint = formatPrevSetpoint(name);
        const prevIntensity = getMostRecentIntensityForExercise(name);
        const prevStarsHtml = prevIntensity
            ? `<span class="te-prev-stars">${'★'.repeat(prevIntensity)}${'☆'.repeat(5 - prevIntensity)}</span>`
            : "";
        const prevLineHtml = (prevSetpoint || prevStarsHtml)
            ? `<span class="te-prev-setpoint">${prevSetpoint}${prevStarsHtml}</span>`
            : "";

        const actionBtn = isDone
            ? `<button type="button" class="te-log-btn te-log-done" onclick="initEditEntry(${matchedEntry.id})">Edit</button>`
            : `<button type="button" class="te-log-btn" onclick="LogModal.quickLogExercise('${safeName}')">Log</button>`;

        return `
            <div class="today-exercise-row${isDone ? ' te-done' : ''}">
                <span class="te-name-group">
                    <span class="te-name">${emoji} ${name}</span>
                    ${prevLineHtml}
                </span>
                ${actionBtn}
            </div>
        `;
    }).join("");
}

// --- TRACK TAB: top 4-up KPI row ---
function renderTrackKpis() {
    renderStreakWidget(); // pushes streak into kpi-streak-value

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Workouts this week (last 7 rolling days)
    const recentEntries = state.history.filter(h => new Date(h.date + "T00:00:00") >= sevenDaysAgo);
    const weekCountEl = document.getElementById("kpi-week-count-value");
    if (weekCountEl) weekCountEl.textContent = recentEntries.length;

    // 7-day average intensity (entries with a rating only)
    const ratedRecent = recentEntries.filter(h => h.intensity && h.intensity > 0);
    const avgIntensity = ratedRecent.length > 0
        ? (ratedRecent.reduce((sum, h) => sum + h.intensity, 0) / ratedRecent.length)
        : null;
    const intensityEl = document.getElementById("kpi-week-intensity-value");
    if (intensityEl) intensityEl.textContent = avgIntensity !== null ? avgIntensity.toFixed(1) : "—";

    // Current weight (most recent "weight" measurement log, default measurement key "weight")
    const weightLogs = state.measurementLogs.filter(l => l.measurementKey === "weight");
    const latestWeight = weightLogs.length > 0
        ? [...weightLogs].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        : null;
    const weightEl = document.getElementById("kpi-weight-value");
    if (weightEl) {
        if (latestWeight) {
            const m = state.measurements.find(x => x.key === "weight");
            weightEl.textContent = `${latestWeight.value}${m ? m.unit : ''}`;
        } else {
            weightEl.textContent = "—";
        }
    }
}

// --- STATS TAB: 2x2 KPI grid ---
function renderStatsKpis() {
    renderStreakWidget(); // pushes streak into kpi2-streak-value

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // --- Avg Intensity (7d) + mini bar graph (per-day avg intensity, last 7 days) ---
    const dayBuckets = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dayBuckets.push(getLocalDateString(d));
    }
    const intensityByDay = dayBuckets.map(dateStr => {
        const entries = state.history.filter(h => h.date === dateStr && h.intensity && h.intensity > 0);
        if (entries.length === 0) return 0;
        return entries.reduce((sum, h) => sum + h.intensity, 0) / entries.length;
    });
    const ratedDayValues = intensityByDay.filter(v => v > 0);
    const avgIntensity7d = ratedDayValues.length > 0
        ? (ratedDayValues.reduce((a, b) => a + b, 0) / ratedDayValues.length)
        : null;

    const intensityValueEl = document.getElementById("kpi2-intensity-value");
    if (intensityValueEl) intensityValueEl.textContent = avgIntensity7d !== null ? avgIntensity7d.toFixed(1) : "—";

    const intensityBarsEl = document.getElementById("kpi2-intensity-bars");
    if (intensityBarsEl) {
        intensityBarsEl.innerHTML = intensityByDay.map(v => {
            const heightPct = Math.max(8, (v / 5) * 100);
            const color = v > 0 ? getIntensityColor(Math.round(v)) : "#374151";
            return `<div class="kmb-bar" style="height:${heightPct}%; background-color:${color};"></div>`;
        }).join("");
    }

    // --- Streak dots: last 7 days, orange if a workout was completed that day ---
    const streakDotsEl = document.getElementById("kpi2-streak-dots");
    if (streakDotsEl) {
        const loggedDateSet = new Set(state.history.map(h => h.date));
        streakDotsEl.innerHTML = dayBuckets.map(dateStr => {
            const active = loggedDateSet.has(dateStr);
            return `<span class="ksd-dot${active ? ' ksd-active' : ''}"></span>`;
        }).join("");
    }

    // --- Weight + 2-week mini line graph ---
    const weightLogsSorted = [...state.measurementLogs]
        .filter(l => l.measurementKey === "weight")
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const weightValueEl = document.getElementById("kpi2-weight-value");
    const weightMeas = state.measurements.find(m => m.key === "weight");
    if (weightValueEl) {
        const latest = weightLogsSorted[weightLogsSorted.length - 1];
        weightValueEl.textContent = latest ? `${latest.value}${weightMeas ? weightMeas.unit : ''}` : "—";
    }
    const weightGraphEl = document.getElementById("kpi2-weight-graph");
    if (weightGraphEl) {
        const twoWeeksAgo = new Date(today);
        twoWeeksAgo.setDate(today.getDate() - 14);
        const recentWeights = weightLogsSorted.filter(l => new Date(l.date + "T00:00:00") >= twoWeeksAgo);
        weightGraphEl.innerHTML = renderMiniLineSvg(recentWeights.map(l => l.value));
    }

    // --- Workouts by day (last 7 days) bar graph + this-week count ---
    const workoutCountByDay = dayBuckets.map(dateStr => state.history.filter(h => h.date === dateStr).length);
    const workoutsThisWeek = workoutCountByDay.reduce((a, b) => a + b, 0);
    const workoutsValueEl = document.getElementById("kpi2-workouts-value");
    if (workoutsValueEl) workoutsValueEl.textContent = workoutsThisWeek;
    const workoutsBarsEl = document.getElementById("kpi2-workouts-bars");
    if (workoutsBarsEl) {
        const maxCount = Math.max(1, ...workoutCountByDay);
        workoutsBarsEl.innerHTML = workoutCountByDay.map(c => {
            const heightPct = c > 0 ? Math.max(12, (c / maxCount) * 100) : 4;
            return `<div class="kmb-bar" style="height:${heightPct}%; background-color:${c > 0 ? '#2563eb' : '#374151'};"></div>`;
        }).join("");
    }

    renderProgressOverview();
}

// Tiny inline sparkline used by the Stats KPI cards. Returns "" (blank) if
// there isn't enough data to draw a meaningful trend.
function renderMiniLineSvg(values) {
    if (!values || values.length < 2) return `<span class="text-muted" style="font-size:0.65rem;">Not enough data</span>`;
    const width = 100;
    const height = 32;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;
    const denom = Math.max(values.length - 1, 1);
    const points = values.map((v, i) => {
        const x = (i / denom) * width;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const path = "M " + points.join(" L ");
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// --- Full-width Progress Overview summary (Stats tab) ---
function renderProgressOverview() {
    const body = document.getElementById("progress-overview-body");
    if (!body) return;

    const rows = [];

    // Total lifetime sessions
    rows.push({ label: "Total Workouts Logged", value: state.history.length });

    // Most logged exercise
    if (state.history.length > 0) {
        const counts = {};
        state.history.forEach(h => { counts[h.exerciseName] = (counts[h.exerciseName] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        rows.push({ label: "Most Logged Exercise", value: `${top[0]} (${top[1]}x)` });
    }

    // Weight change over last 30 days
    const weightLogsSorted = [...state.measurementLogs]
        .filter(l => l.measurementKey === "weight")
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (weightLogsSorted.length >= 2) {
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        const inWindow = weightLogsSorted.filter(l => new Date(l.date + "T00:00:00") >= thirtyDaysAgo);
        const baseline = inWindow.length >= 2 ? inWindow[0] : weightLogsSorted[0];
        const latest = weightLogsSorted[weightLogsSorted.length - 1];
        const delta = latest.value - baseline.value;
        const meas = state.measurements.find(m => m.key === "weight");
        const unit = meas ? meas.unit : "";
        const sign = delta > 0 ? "+" : "";
        const trendClass = delta > 0 ? "po-up" : (delta < 0 ? "po-down" : "");
        rows.push({ label: "Weight Change (30d)", value: `${sign}${delta.toFixed(1)}${unit}`, cls: trendClass });
    }

    // Current streak (reuse calculation)
    rows.push({ label: "Current Streak", value: `${calculateStreak()} days` });

    if (rows.length === 0) {
        body.innerHTML = `<p class="text-muted">Log a few workouts to see your progress summary.</p>`;
        return;
    }

    body.innerHTML = rows.map(r => `
        <div class="progress-overview-row">
            <span class="po-label">${r.label}</span>
            <span class="po-value${r.cls ? ' ' + r.cls : ''}">${r.value}</span>
        </div>
    `).join("");
}

function render7DayHorizon(baseDate) {
    const container = document.getElementById("calendar-horizon-view");
    container.innerHTML = "";
    const activeLogDate = state.selectedHorizonDate;

    // First pass: gather each day's data and find the max item count so all
    // 7 cards can share a tall-enough events area (prevents clipped text).
    let daysData = [];
    let maxItemCount = 1;
    for (let i = 0; i < 7; i++) {
        let futureDate = new Date(baseDate);
        futureDate.setDate(baseDate.getDate() + i);

        let dayTargets = getPlannedExercisesForDate(futureDate);
        let isRest = isRestDayExplicitlyScheduled(futureDate);
        let itemCount = isRest ? 1 : Math.max(dayTargets.length, 1);
        if (itemCount > maxItemCount) maxItemCount = itemCount;

        daysData.push({ futureDate, dayTargets, isRest });
    }

    const perItemHeight = 16; // approx line-height + margin per tag, in px
    const eventsMinHeight = maxItemCount * perItemHeight;

    daysData.forEach(({ futureDate, dayTargets, isRest }, i) => {
        let dayLabel = i === 0 ? "Today" : DAYS_SHORT[futureDate.getDay()];
        let dateString = getLocalDateString(futureDate);

        let dayCard = document.createElement("div");
        dayCard.className = `cal-day-card ${dateString === activeLogDate ? 'today' : ''}`;

        dayCard.style.display = "flex";
        dayCard.style.flexDirection = "column";
        dayCard.style.minHeight = "fit-content"; 
        dayCard.style.height = "auto";
        dayCard.style.padding = "0.5rem";

        // Purely visual now — selecting a day just moves the highlight ring.
        // There's no inline form/date field left for this to feed into.
        dayCard.onclick = () => {
            haptic('light');
            state.selectedHorizonDate = dateString;
            render7DayHorizon(new Date());
        };

        let loggedCountsForDay = {};
        state.history.forEach(entry => {
            if (entry.date === dateString) {
                loggedCountsForDay[entry.exerciseName] = (loggedCountsForDay[entry.exerciseName] || 0) + 1;
            }
        });

        // Strike through exactly as many instances of each exercise as have
        // been logged for this date — if it's scheduled 2x and only 1 is
        // logged, one tag shows completed and the other stays active.
        let seenSoFar = {};
        let tagsHtml = dayTargets.map(t => {
            seenSoFar[t] = (seenSoFar[t] || 0) + 1;
            let isDone = seenSoFar[t] <= (loggedCountsForDay[t] || 0);
            return `
            <span class="cal-event-tag${isDone ? ' completed' : ''}">
                ${t}
            </span>
        `;
        }).join("");
        
        if (isRest) {
            tagsHtml = `<span class="text-muted" style="font-size:0.65rem; display:block; margin-top:2px;">Rest</span>`;
        } else if (dayTargets.length === 0) {
            tagsHtml = `<span class="text-muted" style="font-size:0.65rem; display:block; margin-top:2px;">—</span>`;
        }

        dayCard.innerHTML = `
            <div class="cal-day-title" style="font-weight: bold;">${dayLabel}</div>
            <div class="text-muted" style="font-size:0.65rem; margin-bottom: 4px;">${futureDate.getMonth()+1}/${futureDate.getDate()}</div>
            <div class="cal-day-events" style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px; min-height: ${eventsMinHeight}px;">${tagsHtml}</div>
        `;
        container.appendChild(dayCard);
    });
}

// --- DROPDOWN ELEMENT SELECTOR INJECTIONS ---
// Used to populate both the inline log form's dropdown and the Plan
// drawer's dropdown. The inline log form is gone (logging now goes through
// LogModal, which builds its own picker), so this only feeds plan-exercise.
function renderPlanExerciseSelector() {
    const selectPlan = document.getElementById("plan-exercise");
    if (!selectPlan) return;

    let organizedExercises = [...state.exercises].sort((a, b) => {
        let catA = a.category || "Uncategorized";
        let catB = b.category || "Uncategorized";
        if (catA !== catB) return catA.localeCompare(catB);
        return a.name.localeCompare(b.name);
    });

    let regularOptionsByGroup = {};
    organizedExercises.forEach(ex => {
        let cat = ex.category || "Uncategorized";
        if (!regularOptionsByGroup[cat]) regularOptionsByGroup[cat] = [];
        regularOptionsByGroup[cat].push(`<option value="${ex.name}">${ex.name}</option>`);
    });

    let planHtml = "";
    Object.entries(regularOptionsByGroup).forEach(([category, options]) => {
        planHtml += `<optgroup label="${category}">` + options.join("") + `</optgroup>`;
    });
    selectPlan.innerHTML = planHtml;
}

// Finds the entry for a given exercise whose `date` is chronologically most
// recent — comparing actual date values, not array/insertion order (history
// is normally kept sorted, but backfilled or imported entries can break that
// assumption, so this never relies on it).
function getMostRecentEntryForExercise(exerciseName, requireIntensity = false) {
    let best = null;
    state.history.forEach(entry => {
        if (entry.exerciseName !== exerciseName) return;
        if (requireIntensity && (!entry.intensity || entry.intensity <= 0)) return;
        if (!best || new Date(entry.date) > new Date(best.date)) {
            best = entry;
        }
    });
    return best;
}

function getPreviousEntry(exerciseName) {
    return getMostRecentEntryForExercise(exerciseName, false);
}

function getMostRecentIntensityForExercise(exerciseName) {
    const entry = getMostRecentEntryForExercise(exerciseName, true);
    return entry ? entry.intensity : null;
}

// --- LOG MODAL: parallel field-builder + star-rating helpers ---
// Mirrors buildDynamicFormFields / setStarRatingValue exactly, but scoped to
// the Log Modal's own element IDs (log2-*) so the inline Track-tab form and
// the modal never fight over the same DOM nodes.
function buildLog2DynamicFormFields(exerciseName, existingData = null) {
    const container = document.getElementById("log2-dynamic-fields-container");
    if (!container) return;
    container.innerHTML = "";

    const exercise = findExerciseDef(exerciseName);
    if (!exercise || !exercise.metrics) return;

    const previousEntry = getPreviousEntry(exerciseName);

    exercise.metrics.forEach(fieldKey => {
        const fieldMeta = FIELD_LABELS[fieldKey];
        if (!fieldMeta) return;

        const div = document.createElement("div");
        div.className = "form-group";

        let valAttr = "";
        let placeholderVal = fieldMeta.placeholder;

        if (existingData && existingData[fieldKey] !== undefined) {
            valAttr = `value="${existingData[fieldKey]}"`;
        } else if (previousEntry && previousEntry.exerciseName === exerciseName && previousEntry.data[fieldKey] !== undefined) {
            placeholderVal = `Prev: ${previousEntry.data[fieldKey]}`;
        }

        div.innerHTML = `
            <label for="log2-field-${fieldKey}">${fieldMeta.label}</label>
            <input type="${fieldMeta.type}" id="log2-field-${fieldKey}" name="${fieldKey}" ${valAttr} placeholder="${placeholderVal}" step="${fieldMeta.step}" inputmode="decimal" required>
        `;
        container.appendChild(div);
    });
}

function setLog2StarRatingValue(value) {
    const val = parseInt(value, 10) || 0;
    const hiddenInput = document.getElementById("log2-intensity");
    if (hiddenInput) hiddenInput.value = val;

    document.querySelectorAll("#log2-intensity-stars .star").forEach(star => {
        const starVal = parseInt(star.dataset.val, 10);
        star.classList.toggle("active", starVal <= val);
    });

    updateLog2IntensityPreview();
}

function updateLog2IntensityPreview() {
    const exerciseName = document.getElementById("log2-exercise-name");
    const hiddenInput = document.getElementById("log2-intensity");
    if (!exerciseName || !hiddenInput) return;

    const currentVal = parseInt(hiddenInput.value, 10) || 0;
    let previewVal = 0;
    if (currentVal === 0 && exerciseName.value) {
        previewVal = getMostRecentIntensityForExercise(exerciseName.value) || 0;
    }

    document.querySelectorAll("#log2-intensity-stars .star").forEach(star => {
        const starVal = parseInt(star.dataset.val, 10);
        star.classList.toggle("preview", currentVal === 0 && starVal <= previewVal);
    });
}

function setupLog2StarRating() {
    const stars = document.querySelectorAll("#log2-intensity-stars .star");
    const hiddenInput = document.getElementById("log2-intensity");
    if (!hiddenInput) return;

    stars.forEach(star => {
        star.addEventListener("click", () => {
            haptic('light');
            const clickedVal = parseInt(star.dataset.val, 10);
            const currentVal = parseInt(hiddenInput.value, 10) || 0;
            const newVal = (clickedVal === currentVal) ? 0 : clickedVal;
            setLog2StarRatingValue(newVal);
        });
    });
}

function triggerConfirmationModal(title, text, confirmCallback) {
    const modal = document.getElementById("confirmation-modal");
    document.getElementById("modal-title").innerText = title;
    document.getElementById("modal-body").innerText = text;
    
    modal.classList.remove("hidden");

    const cancelBtn = document.getElementById("modal-cancel-btn");
    const confirmBtn = document.getElementById("modal-confirm-btn");

    const closeHandler = () => {
        modal.classList.add("hidden");
        // Clear listeners to prevent duplicate triggers
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    cancelBtn.onclick = closeHandler;
    confirmBtn.onclick = () => {
        haptic('warning');
        confirmCallback();
        closeHandler();
    };
}

// --- EXERCISE MANAGEMENT MODAL PANEL PIPELINES ---
function renderManageExercises() {
    const container = document.getElementById("manage-exercises-container");
    if (!container) return;
    container.innerHTML = "";

    if (state.exercises.length === 0) {
        container.innerHTML = `<p class="text-muted">No configuration templates available.</p>`;
        return;
    }

    let sortedList = [...state.exercises].sort((a,b) => a.name.localeCompare(b.name));

    sortedList.forEach(ex => {
        const item = document.createElement("div");
        item.className = "exercise-manage-item";
        
        let logCount = state.history.filter(h => h.exerciseName === ex.name).length;
        let countBadge = logCount > 0 ? `<span class="badge" style="background:#1e293b; color:#9ca3af; margin-left:0.5rem;">${logCount} logged</span>` : '';

        item.innerHTML = `
            <div>
                <strong>${ex.emoji || getCategoryEmoji(ex.category)} ${ex.name}</strong> ${countBadge}
                <div class="text-muted" style="font-size:0.75rem; margin-top:0.15rem;">Fields: ${ex.metrics.join(", ")}</div>
            </div>
            <div class="history-item-actions">
                <span class="action-link" onclick="initExerciseEdit('${ex.name.replace(/'/g, "\\'")}')">Edit</span>
                <span class="action-link delete" onclick="initExerciseDelete('${ex.name.replace(/'/g, "\\'")}')">Del</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function initExerciseEdit(exName) {
    const exIdx = state.exercises.findIndex(e => e.name === exName);
    if (exIdx === -1) return;
    const ex = state.exercises[exIdx];

    document.getElementById("exercise-form-title").innerText = "Edit Custom Exercise";
    document.getElementById("edit-exercise-index").value = exIdx;
    document.getElementById("new-ex-name").value = ex.name;
    document.getElementById("new-ex-emoji").value = ex.emoji || "";
    document.getElementById("new-ex-category").value = ex.category;

    const checkboxes = document.querySelectorAll('#custom-exercise-form input[name="metric"]');
    checkboxes.forEach(cb => {
        cb.checked = ex.metrics.includes(cb.value);
    });

    if (!document.getElementById("cancel-ex-edit-btn")) {
        const btnContainer = document.getElementById("exercise-action-buttons");
        btnContainer.style.gridTemplateColumns = "1fr 1fr";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.id = "cancel-ex-edit-btn";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.innerText = "Cancel";
        cancelBtn.onclick = cancelExerciseEdit;
        btnContainer.appendChild(cancelBtn);
    }
    document.getElementById("submit-exercise-btn").innerText = "Update Template Specs";
}

function cancelExerciseEdit() {
    document.getElementById("exercise-form-title").innerText = "Add Custom Exercise";
    document.getElementById("edit-exercise-index").value = "";
    document.getElementById("custom-exercise-form").reset();
    document.getElementById("submit-exercise-btn").innerText = "Create Exercise";

    const cancelBtn = document.getElementById("cancel-ex-edit-btn");
    if (cancelBtn) cancelBtn.remove();
    document.getElementById("exercise-action-buttons").style.gridTemplateColumns = "1fr";
}

function initExerciseDelete(exName) {
    let logCount = state.history.filter(h => h.exerciseName === exName).length;

    if (logCount > 0) {
        triggerConfirmationModal(
            "Cascade Dangerous Deletion", 
            `Warning: "${exName}" contains ${logCount} logged activity entries. Deleting this exercise template will permanently wipe all associated historic logs.`, 
            () => executeExerciseDeletion(exName)
        );
    } else {
        executeExerciseDeletion(exName);
    }
}

function executeExerciseDeletion(exName) {
    state.exercises = state.exercises.filter(e => e.name !== exName);
    state.history = state.history.filter(h => h.exerciseName !== exName);
    state.plans = state.plans.filter(p => p.exercise !== exName);
    
    saveState();
    initApp();
    cancelExerciseEdit();
}

// --- MEASUREMENT MANAGEMENT MODAL PANEL PIPELINES (mirrors exercise management) ---
function renderManageMeasurements() {
    const container = document.getElementById("manage-measurements-container");
    if (!container) return;
    container.innerHTML = "";

    if (!state.measurements || state.measurements.length === 0) {
        container.innerHTML = `<p class="text-muted">No measurements configured.</p>`;
        return;
    }

    let sortedList = [...state.measurements].sort((a, b) => a.name.localeCompare(b.name));

    sortedList.forEach(m => {
        const item = document.createElement("div");
        item.className = "exercise-manage-item";

        let logCount = state.measurementLogs.filter(l => l.measurementKey === m.key).length;
        let countBadge = logCount > 0 ? `<span class="badge" style="background:#1e293b; color:#9ca3af; margin-left:0.5rem;">${logCount} logged</span>` : '';

        item.innerHTML = `
            <div>
                <strong>${ICON_RULER} ${m.name}</strong> ${countBadge}
                <div class="text-muted" style="font-size:0.75rem; margin-top:0.15rem;">Unit: ${m.unit}</div>
            </div>
            <div class="history-item-actions">
                <span class="action-link" onclick="initMeasurementEdit('${m.key}')">Edit</span>
                <span class="action-link delete" onclick="initMeasurementDelete('${m.key}')">Del</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function initMeasurementEdit(key) {
    const idx = state.measurements.findIndex(m => m.key === key);
    if (idx === -1) return;
    const m = state.measurements[idx];

    document.getElementById("measurement-form-title").innerText = "Edit Measurement";
    document.getElementById("edit-measurement-key").value = m.key;
    document.getElementById("new-meas-name").value = m.name;
    document.getElementById("new-meas-unit").value = m.unit;

    if (!document.getElementById("cancel-meas-edit-btn")) {
        const btnContainer = document.getElementById("measurement-action-buttons");
        btnContainer.style.gridTemplateColumns = "1fr 1fr";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.id = "cancel-meas-edit-btn";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.innerText = "Cancel";
        cancelBtn.onclick = cancelMeasurementEdit;
        btnContainer.appendChild(cancelBtn);
    }
    document.getElementById("submit-measurement-btn").innerText = "Update Measurement";
}

function cancelMeasurementEdit() {
    document.getElementById("measurement-form-title").innerText = "Add a Custom Measurement";
    document.getElementById("edit-measurement-key").value = "";
    document.getElementById("custom-measurement-form").reset();
    document.getElementById("submit-measurement-btn").innerText = "Create Measurement";

    const cancelBtn = document.getElementById("cancel-meas-edit-btn");
    if (cancelBtn) cancelBtn.remove();
    document.getElementById("measurement-action-buttons").style.gridTemplateColumns = "1fr";
}

function initMeasurementDelete(key) {
    const m = state.measurements.find(x => x.key === key);
    if (!m) return;
    let logCount = state.measurementLogs.filter(l => l.measurementKey === key).length;

    if (logCount > 0) {
        triggerConfirmationModal(
            "Cascade Dangerous Deletion",
            `Warning: "${m.name}" contains ${logCount} logged entries. Deleting this measurement will permanently wipe all associated historic logs.`,
            () => executeMeasurementDeletion(key)
        );
    } else {
        executeMeasurementDeletion(key);
    }
}

function executeMeasurementDeletion(key) {
    state.measurements = state.measurements.filter(m => m.key !== key);
    state.measurementLogs = state.measurementLogs.filter(l => l.measurementKey !== key);

    saveState();
    initApp();
    cancelMeasurementEdit();
}

// Slug-ify a display name into a stable storage key, ensuring uniqueness
// against existing measurement keys (appends -2, -3, ... on collision).
function slugifyMeasurementName(name, excludeKey = null) {
    let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "measurement";
    let candidate = base;
    let n = 2;
    while (state.measurements.some(m => m.key === candidate && m.key !== excludeKey)) {
        candidate = `${base}-${n}`;
        n++;
    }
    return candidate;
}

// --- HISTORICAL TRACK LOG EDIT PIPELINES ---
// Editing a logged entry from History now opens the Log Modal directly into
// its exercise-entry step (pre-filled), rather than the old inline form.
function initEditEntry(id) {
    const entry = state.history.find(h => h.id === id);
    if (!entry) return;

    haptic('light');
    document.getElementById("log-modal").classList.remove("hidden");
    LogModal.openExerciseForm(entry.exerciseName, entry);
}

// Mirrors initEditEntry/deleteEntry, but for the Total Time category, which
// now lives in its own state.totalTimeLogs array rather than history.
function initEditTotalTimeLog(id) {
    const entry = state.totalTimeLogs.find(t => t.id === id);
    if (!entry) return;

    haptic('light');
    document.getElementById("log-modal").classList.remove("hidden");
    LogModal.openTotalTimeForm(entry);
}

function deleteTotalTimeLog(id) {
    if (confirm("Are you sure you want to delete this historical total time entry?")) {
        state.totalTimeLogs = state.totalTimeLogs.filter(t => t.id !== id);
        saveState();
        initApp();
    }
}

function deleteEntry(id) {
    if (confirm("Are you sure you want to delete this historical entry?")) {
        state.history = state.history.filter(h => h.id !== id);
        saveState();
        initApp();
    }
}

function deletePlan(id) {
    if (confirm("Are you sure you want to delete this plan?")) {
        state.plans = state.plans.filter(p => p.id !== id);
        saveState();
        initApp();
    }
}

// --- COMPREHENSIVE PROGRESS MATRIX INTERACTIVE GRAPH Engine ---
function renderIntensityChart() {
    const container = document.getElementById("intensity-graph-container");
    const heading = document.getElementById("intensity-chart-heading");
    if (!container) return;

    if (heading) {
        const labelByGranularity = { daily: "Average Intensity by Day", weekly: "Average Intensity by Week", monthly: "Average Intensity by Month" };
        heading.innerText = labelByGranularity[chartGranularity] || "Average Intensity by Day";
    }

    // Only entries with an actual intensity rating contribute to the average.
    const ratedEntries = state.history.filter(entry => entry.intensity && entry.intensity > 0);

    const buckets = aggregateByPeriod(
        ratedEntries,
        chartGranularity,
        "date",
        (entry) => ({ intensity: entry.intensity })
    );

    if (buckets.length < 2) {
        container.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Log a star rating on 2+ ${chartGranularity === 'daily' ? 'days' : chartGranularity === 'weekly' ? 'weeks' : 'months'} to see this trend.</p>`;
        return;
    }

    let avgData = buckets.map(b => ({ date: b.date, avg: b.intensity }));

    const width = 440;
    const height = 180;
    const paddingLeft = 28;
    const paddingRight = 14;
    const paddingTop = 20;
    const paddingBottom = 28;
    const usableWidth = width - paddingLeft - paddingRight;
    const usableHeight = height - paddingTop - paddingBottom;
    const xDenom = Math.max(avgData.length - 1, 1);
    const slotWidth = usableWidth / Math.max(avgData.length, 1);
    const barWidth = Math.max(4, Math.min(26, slotWidth * 0.6));

    let bars = avgData.map((d, idx) => {
        let x = paddingLeft + (idx / xDenom) * usableWidth;
        let barHeightPx = (Math.min(d.avg, 5) / 5) * usableHeight;
        let y = (height - paddingBottom) - barHeightPx;
        let color = getIntensityColor(Math.round(d.avg));
        return `
            <rect x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeightPx}" fill="${color}" rx="2"/>
            <text x="${x}" y="${y - 4}" font-size="7" fill="#f3f4f6" text-anchor="middle">${d.avg.toFixed(1)}</text>
        `;
    }).join("");

    container.innerHTML = `
        <div class="svg-chart-container">
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                <text x="${paddingLeft - 4}" y="${height - paddingBottom}" font-size="7" fill="#9ca3af" text-anchor="end">0</text>
                <text x="${paddingLeft - 4}" y="${paddingTop + 4}" font-size="7" fill="#9ca3af" text-anchor="end">5</text>
                ${bars}
                <text x="${paddingLeft}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="start">${formatPeriodLabel(avgData[0].date, chartGranularity)}</text>
                <text x="${width - paddingRight}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="end">${formatPeriodLabel(avgData[avgData.length - 1].date, chartGranularity)}</text>
            </svg>
        </div>
    `;
}

// --- COMPREHENSIVE PROGRESS MATRIX INTERACTIVE GRAPH Engine ---
function populateChartFilter() {
    const filterSelect = document.getElementById("chart-exercise-select");
    const wrapper = document.getElementById("chart-filter-wrapper");
    if (!filterSelect || !wrapper) return;

    let chartableExercises = state.exercises.filter(ex => {
        let count = state.history.filter(h => h.exerciseName === ex.name).length;
        return count >= 2;
    });

    // Total Exercise Time is now its own record category (state.totalTimeLogs)
    // rather than a pseudo-exercise in state.history — checked and included
    // separately, in its own "Other" group further down.
    const totalTimeCount = state.totalTimeLogs.length;
    const isTotalTimeChartable = totalTimeCount >= 2;

    let chartableMeasurements = (state.measurements || []).filter(m => {
        let count = state.measurementLogs.filter(l => l.measurementKey === m.key).length;
        return count >= 2;
    });

    if (chartableExercises.length === 0 && chartableMeasurements.length === 0 && !isTotalTimeChartable) {
        wrapper.classList.add("hidden");
        return;
    }
    wrapper.classList.remove("hidden");

    let currentSelection = filterSelect.value;

    // Pinned "Today's Exercises" group — only the subset of today's scheduled
    // exercises that already qualify for charting (2+ entries), starred and
    // listed first, in addition to their normal spot further down. Ordered
    // to match the Plan tab's drag-reordered sequence for today, same as
    // the 7-Day Horizon tags and Today's Exercises card.
    const scheduledTodayOrdered = getPlannedExercisesForDate(new Date()).filter(name => name !== "__rest__");
    const todayOrderIndex = new Map();
    scheduledTodayOrdered.forEach((name, idx) => {
        if (!todayOrderIndex.has(name)) todayOrderIndex.set(name, idx);
    });
    const chartableToday = chartableExercises.filter(ex => todayOrderIndex.has(ex.name));

    let html = "";
    if (chartableToday.length > 0) {
        let opts = [...chartableToday]
            .sort((a, b) => todayOrderIndex.get(a.name) - todayOrderIndex.get(b.name))
            .map(ex => `<option value="ex:${ex.name}">⭐ ${ex.name}</option>`)
            .join("");
        html += `<optgroup label="Today's Exercises">${opts}</optgroup>`;
    }

    // Group exercises by category, same ordering convention as the log/plan dropdowns
    let byCategory = {};
    chartableExercises.forEach(ex => {
        let cat = ex.category || "Uncategorized";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(ex);
    });

    Object.keys(byCategory).sort().forEach(cat => {
        let opts = byCategory[cat]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(ex => `<option value="ex:${ex.name}">${ex.name}</option>`)
            .join("");
        html += `<optgroup label="${cat}">${opts}</optgroup>`;
    });

    if (isTotalTimeChartable) {
        html += `<optgroup label="Other"><option value="tt:total">${TOTAL_TIME_EXERCISE_NAME}</option></optgroup>`;
    }

    if (chartableMeasurements.length > 0) {
        let opts = [...chartableMeasurements]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(m => `<option value="meas:${m.key}">${m.name}</option>`)
            .join("");
        html += `<optgroup label="Measurements">${opts}</optgroup>`;
    }

    filterSelect.innerHTML = html;

    if (currentSelection && Array.from(filterSelect.options).some(o => o.value === currentSelection)) {
        filterSelect.value = currentSelection;
    }
}

// Simple single-line trend chart for a measurement (no dual-axis volume calc,
// no intensity coloring — measurements don't carry an intensity rating).
// Simple single-line trend chart for a measurement (no dual-axis volume calc,
// no intensity coloring — measurements don't carry an intensity rating).
// `sortedBuckets` are pre-aggregated by the caller via aggregateByPeriod —
// each item has { date (anchor), value } after averaging.
function renderMeasurementChart(measurementKey, sortedBuckets, graphContainer, legendBlock) {
    if (legendBlock) legendBlock.style.display = "none";

    if (sortedBuckets.length < 2) {
        const unitWord = chartGranularity === 'daily' ? 'days' : chartGranularity === 'weekly' ? 'weeks' : 'months';
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Log this measurement on 2+ ${unitWord} to view progression.</p>`;
        return;
    }

    const m = state.measurements.find(x => x.key === measurementKey);
    const unitLabel = m ? m.unit : "";
    const nameLabel = m ? m.name : measurementKey;

    const width = 440;
    const height = 200;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 30;
    const paddingBottom = 30;

    let vals = sortedBuckets.map(l => l.value);
    let minVal = Math.min(...vals) * 0.95;
    let maxVal = Math.max(...vals) * 1.05;
    if (maxVal === minVal) { minVal -= 5; maxVal += 5; }
    let range = maxVal - minVal;

    const xDenom = Math.max(sortedBuckets.length - 1, 1);
    let points = sortedBuckets.map((entry, idx) => {
        let x = paddingLeft + (idx / xDenom) * (width - paddingLeft - paddingRight);
        let y = (height - paddingBottom) - ((entry.value - minVal) / range) * (height - paddingTop - paddingBottom);
        return { x, y, value: entry.value, date: entry.date };
    });

    let linePath = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

    let dots = points.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#2563eb" stroke="#1e1e24" stroke-width="1"/>
        <text x="${p.x}" y="${p.y - 8}" font-size="7" font-weight="bold" fill="#f3f4f6" text-anchor="middle">${Number(p.value.toFixed(2))}</text>
    `).join("");

    graphContainer.innerHTML = `
        <div class="svg-chart-container">
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem; text-align:center;">
                ${nameLabel}${unitLabel ? ` (${unitLabel})` : ""}
            </div>
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>

                <path d="${linePath}" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                ${dots}

                <text x="${points[0].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="start">${formatPeriodLabel(points[0].date, chartGranularity)}</text>
                <text x="${points[points.length - 1].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="end">${formatPeriodLabel(points[points.length - 1].date, chartGranularity)}</text>
            </svg>
        </div>
    `;
}

// Single-line trend chart for Total Exercise Time — mirrors
// renderMeasurementChart's shape (no dual-axis, no intensity coloring),
// but for the dedicated state.totalTimeLogs category rather than a
// measurement. `sortedBuckets` are pre-aggregated by the caller via
// aggregateByPeriod, each item has { date (anchor), value } in minutes.
function renderTotalTimeChart(sortedBuckets, graphContainer, legendBlock) {
    if (legendBlock) legendBlock.style.display = "none";

    if (sortedBuckets.length < 2) {
        const unitWord = chartGranularity === 'daily' ? 'days' : chartGranularity === 'weekly' ? 'weeks' : 'months';
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Log Total Time on 2+ ${unitWord} to view progression.</p>`;
        return;
    }

    const width = 440;
    const height = 200;
    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 30;
    const paddingBottom = 30;

    let vals = sortedBuckets.map(l => l.value);
    let minVal = Math.min(...vals) * 0.95;
    let maxVal = Math.max(...vals) * 1.05;
    if (maxVal === minVal) { minVal -= 5; maxVal += 5; }
    if (minVal < 0) minVal = 0;
    let range = maxVal - minVal;

    const xDenom = Math.max(sortedBuckets.length - 1, 1);
    let points = sortedBuckets.map((entry, idx) => {
        let x = paddingLeft + (idx / xDenom) * (width - paddingLeft - paddingRight);
        let y = (height - paddingBottom) - ((entry.value - minVal) / range) * (height - paddingTop - paddingBottom);
        return { x, y, value: entry.value, date: entry.date };
    });

    let linePath = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

    let dots = points.map(p => `
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="#2563eb" stroke="#1e1e24" stroke-width="1"/>
        <text x="${p.x}" y="${p.y - 8}" font-size="7" font-weight="bold" fill="#f3f4f6" text-anchor="middle">${Number(p.value.toFixed(1))}</text>
    `).join("");

    graphContainer.innerHTML = `
        <div class="svg-chart-container">
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem; text-align:center;">
                ${TOTAL_TIME_EXERCISE_NAME} (minutes)
            </div>
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>

                <path d="${linePath}" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                ${dots}

                <text x="${points[0].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="start">${formatPeriodLabel(points[0].date, chartGranularity)}</text>
                <text x="${points[points.length - 1].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="end">${formatPeriodLabel(points[points.length - 1].date, chartGranularity)}</text>
            </svg>
        </div>
    `;
}

function renderStats() {
    const summary = document.getElementById("stats-summary");
    const groupedContainer = document.getElementById("history-grouped-container");
    const graphContainer = document.getElementById("graph-container");
    const legendBlock = document.getElementById("chart-legend");
    const filterSelect = document.getElementById("chart-exercise-select");

    const totalLogCount = state.history.length
        + (state.measurementLogs ? state.measurementLogs.length : 0)
        + (state.totalTimeLogs ? state.totalTimeLogs.length : 0);

    if (totalLogCount === 0) {
        summary.innerHTML = `<p class="text-muted">Complete your first log to start tracking metrics.</p>`;
        groupedContainer.innerHTML = `<p class="text-muted">No historic timeline data logs detected.</p>`;
        graphContainer.innerHTML = "";
        if (legendBlock) legendBlock.style.display = "none";
        return;
    }

    const rawSelection = filterSelect.value;
    const isMeasurementSelected = rawSelection.startsWith("meas:");
    const isTotalTimeSelected = rawSelection === "tt:total";
    const targetExercise = (isMeasurementSelected || isTotalTimeSelected) ? null : rawSelection.replace(/^ex:/, "");
    const targetMeasurementKey = isMeasurementSelected ? rawSelection.replace(/^meas:/, "") : null;

    let exerciseHistory = [];
    if (targetExercise) {
        exerciseHistory = state.history
            .filter(entry => entry.exerciseName === targetExercise)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    let measurementHistory = [];
    if (targetMeasurementKey) {
        measurementHistory = aggregateByPeriod(
            state.measurementLogs.filter(entry => entry.measurementKey === targetMeasurementKey),
            chartGranularity,
            "date",
            (entry) => ({ value: entry.value })
        );
    }

    let totalTimeHistory = [];
    if (isTotalTimeSelected) {
        totalTimeHistory = aggregateByPeriod(
            state.totalTimeLogs,
            chartGranularity,
            "date",
            (entry) => ({ value: entry.minutes })
        );
    }

    if (targetMeasurementKey) {
        renderMeasurementChart(targetMeasurementKey, measurementHistory, graphContainer, legendBlock);
    } else if (isTotalTimeSelected) {
        renderTotalTimeChart(totalTimeHistory, graphContainer, legendBlock);
    } else if (!targetExercise || exerciseHistory.length < 2) {
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Select or complete an exercise or measurement with 2+ entries to view progression.</p>`;
        if (legendBlock) legendBlock.style.display = "none";
    } else {
        if (legendBlock) legendBlock.style.display = "flex";
        
        let sampleEntry = exerciseHistory[0].data;
        let keys = Object.keys(sampleEntry);

        // Standard Primary Axis Configurations
        let primaryMetricKey = keys.includes("weight") ? "weight" : 
                             keys.includes("distance") ? "distance" : 
                             keys.includes("timeSeconds") ? "timeSeconds" : "timeMinutes";

        if (!keys.includes(primaryMetricKey) && keys.length > 0) {
            primaryMetricKey = keys[0]; // Adaptive fallback
        }

        let secondaryMetricLabel = "";
        let hasSecondaryAxis = false;

        // Dynamic Dual-Axis Calculation Configurations
        let calculatedData = exerciseHistory.map(entry => {
            let primaryVal = entry.data[primaryMetricKey] || 0;
            let secondaryVal = 0;

            if (keys.includes("sets") && keys.includes("reps") && keys.includes("weight")) {
                secondaryMetricLabel = "Volume (sets×reps×wt)";
                secondaryVal = (entry.data["sets"] || 0) * (entry.data["reps"] || 0) * (entry.data["weight"] || 0);
                hasSecondaryAxis = true;
            } else if (keys.includes("sets") && keys.includes("reps")) {
                secondaryMetricLabel = "Volume (sets×reps)";
                secondaryVal = (entry.data["sets"] || 0) * (entry.data["reps"] || 0);
                hasSecondaryAxis = true;
            } else if (keys.includes("sets") && (keys.includes("timeSeconds") || keys.includes("timeMinutes"))) {
                let timeKey = keys.includes("timeSeconds") ? "timeSeconds" : "timeMinutes";
                secondaryMetricLabel = "Volume (sets×time)";
                secondaryVal = (entry.data["sets"] || 0) * (entry.data[timeKey] || 0);
                hasSecondaryAxis = true;
            } else if (keys.includes("distance") && (keys.includes("timeMinutes") || keys.includes("timeSeconds"))) {
                secondaryMetricLabel = "Speed (MPH)";
                let minutes = keys.includes("timeMinutes") ? (entry.data["timeMinutes"] || 0) : ((entry.data["timeSeconds"] || 0) / 60);
                secondaryVal = minutes > 0 ? ((entry.data["distance"] || 0) / (minutes / 60)) : 0;
                secondaryVal = parseFloat(secondaryVal.toFixed(2));
                hasSecondaryAxis = true;
            }

            return {
                date: entry.date,
                intensity: entry.intensity,
                primary: primaryVal,
                secondary: secondaryVal
            };
        });

        // Aggregate per-entry data into daily/weekly/monthly buckets. Primary
        // and secondary values are averaged across entries in the same
        // bucket; intensity is averaged too (rounded only at render time,
        // for dot coloring), per spec.
        let aggregatedData = aggregateByPeriod(
            calculatedData,
            chartGranularity,
            "date",
            (entry) => {
                const fields = { primary: entry.primary };
                if (hasSecondaryAxis) fields.secondary = entry.secondary;
                if (entry.intensity && entry.intensity > 0) fields.intensity = entry.intensity;
                return fields;
            }
        );

        if (aggregatedData.length < 2) {
            graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Select or complete an exercise or measurement with 2+ entries to view progression.</p>`;
            if (legendBlock) legendBlock.style.display = "none";
        } else {

        calculatedData = aggregatedData;

        // Compute Boundary Limits
        let primaryVals = calculatedData.map(d => d.primary);
        let minPri = Math.min(...primaryVals) * 0.9;
        let maxPri = Math.max(...primaryVals) * 1.1;
        if (maxPri === minPri) { minPri -= 10; maxPri += 10; }
        if (minPri < 0) minPri = 0;
        let rangePri = maxPri - minPri;

        let minSec = 0, maxSec = 0, rangeSec = 1;
        if (hasSecondaryAxis) {
            let secondaryVals = calculatedData.map(d => d.secondary);
            minSec = Math.min(...secondaryVals) * 0.9;
            maxSec = Math.max(...secondaryVals) * 1.1;
            if (maxSec === minSec) { minSec -= 10; maxSec += 10; }
            if (minSec < 0) minSec = 0;
            rangeSec = maxSec - minSec;
        }

        const width = 440;
        const height = 200;
        const paddingLeft = 40;
        const paddingRight = hasSecondaryAxis ? 40 : 20;
        const paddingTop = 30;
        const paddingBottom = 30;

        const xDenom = Math.max(calculatedData.length - 1, 1);
        let points = calculatedData.map((d, idx) => {
            let x = paddingLeft + (idx / xDenom) * (width - paddingLeft - paddingRight);
            let yPri = (height - paddingBottom) - ((d.primary - minPri) / rangePri) * (height - paddingTop - paddingBottom);
            let ySec = hasSecondaryAxis ? ((height - paddingBottom) - ((d.secondary - minSec) / rangeSec) * (height - paddingTop - paddingBottom)) : 0;
            return { x, yPri, ySec, ...d };
        });

        let primaryLinePath = `M ${points[0].x} ${points[0].yPri} ` + points.slice(1).map(p => `L ${p.x} ${p.yPri}`).join(" ");
        let secondaryLinePath = hasSecondaryAxis ? (`M ${points[0].x} ${points[0].ySec} ` + points.slice(1).map(p => `L ${p.x} ${p.ySec}`).join(" ")) : "";

        let primaryDots = points.map(p => {
            let color = getIntensityColor(p.intensity);
            return `
                <circle cx="${p.x}" cy="${p.yPri}" r="4" fill="${color}" stroke="#1e1e24" stroke-width="1"/>
                <text x="${p.x}" y="${p.yPri - 6}" font-size="7" font-weight="bold" fill="#f3f4f6" text-anchor="middle">${Number(p.primary.toFixed(1))}</text>
            `;
        }).join("");

        let secondaryDots = hasSecondaryAxis ? points.map(p => `
            <circle cx="${p.x}" cy="${p.ySec}" r="3.5" fill="#10b981" stroke="#1e1e24" stroke-width="1"/>
            <text x="${p.x}" y="${p.ySec + 11}" font-size="7" font-weight="bold" fill="#10b981" text-anchor="middle">${Number(p.secondary.toFixed(1))}</text>
        `).join("") : "";

        let secondaryAxisHtml = hasSecondaryAxis ? `
            <line x1="${width - paddingRight}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#10b981" stroke-width="1" stroke-opacity="0.5"/>
            <text x="${width - paddingRight}" y="${paddingTop + 10}" font-size="8" fill="#10b981" text-anchor="end">${secondaryMetricLabel}</text>
        ` : '';

        graphContainer.innerHTML = `
            <div class="svg-chart-container">
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.5rem; text-align:center; display:flex; justify-content:center; gap:1rem;">
                    <span><span style="display:inline-block; width:10px; height:2px; background:#9ca3af; margin-right:3px; vertical-align:middle;"></span>${FIELD_LABELS[primaryMetricKey].label} (Solid)</span>
                    ${hasSecondaryAxis ? `<span><span style="display:inline-block; width:10px; height:2px; background:#10b981; margin-right:3px; vertical-align:middle;"></span>${secondaryMetricLabel} (Green)</span>` : ''}
                </div>
                <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                    <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                    <line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#374151" stroke-width="1"/>
                    ${secondaryAxisHtml}

                    <path d="${primaryLinePath}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    ${hasSecondaryAxis ? `<path d="${secondaryLinePath}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="2,2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
                    
                    ${primaryDots}
                    ${secondaryDots}

                    <text x="${points[0].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="start">${formatPeriodLabel(points[0].date, chartGranularity)}</text>
                    <text x="${points[points.length - 1].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="end">${formatPeriodLabel(points[points.length - 1].date, chartGranularity)}</text>
                </svg>
            </div>
        `;
        }
    }

    const totalMeasurementLogs = state.measurementLogs ? state.measurementLogs.length : 0;
    const totalTimeLogCount = state.totalTimeLogs ? state.totalTimeLogs.length : 0;
    summary.innerHTML = `<p><strong>Total Lifetime Logs:</strong> ${state.history.length} exercise sessions, ${totalMeasurementLogs} measurements, ${totalTimeLogCount} total-time entries</p>`;

    // --- COMPACT GROUP BY DAY TIMELINE COMPILATION (exercises + measurements + total time merged) ---
    let dailyGroups = {};
    state.history.forEach(entry => {
        if (!dailyGroups[entry.date]) dailyGroups[entry.date] = [];
        dailyGroups[entry.date].push({ _kind: "exercise", ...entry });
    });
    (state.measurementLogs || []).forEach(entry => {
        if (!dailyGroups[entry.date]) dailyGroups[entry.date] = [];
        dailyGroups[entry.date].push({ _kind: "measurement", ...entry });
    });
    (state.totalTimeLogs || []).forEach(entry => {
        if (!dailyGroups[entry.date]) dailyGroups[entry.date] = [];
        dailyGroups[entry.date].push({ _kind: "totaltime", ...entry });
    });

    let sortedDaysKeys = Object.keys(dailyGroups).sort((a,b) => new Date(b) - new Date(a));

    groupedContainer.innerHTML = sortedDaysKeys.map(dateStr => {
        let displayDayObj = new Date(dateStr + "T00:00:00");
        let dayHeaderLabel = displayDayObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
        let dayItems = dailyGroups[dateStr];

        return `
            <div class="history-day-block">
                <div class="history-day-block-title">${dayHeaderLabel}</div>
                <ul class="list-group">
                    ${dayItems.map(item => {
                        if (item._kind === "measurement") {
                            const m = state.measurements.find(x => x.key === item.measurementKey);
                            const mName = m ? m.name : item.measurementKey;
                            const mUnit = m ? m.unit : "";
                            return `
                                <li class="list-group-item">
                                    <div><strong>${measurementIconHtml()} ${mName}</strong><br><span class="text-muted" style="font-size:0.8rem;">${formatMeasurementValue(item, mUnit)}</span></div>
                                    <div class="history-item-actions">
                                        <span class="action-link" onclick="TrackingModal.editLog(${item.id})">Edit</span>
                                        <span class="action-link delete" onclick="TrackingModal.deleteLog(${item.id})">Del</span>
                                    </div>
                                </li>
                            `;
                        }

                        if (item._kind === "totaltime") {
                            return `
                                <li class="list-group-item">
                                    <div><strong>${ICON_CLOCK} ${TOTAL_TIME_EXERCISE_NAME}</strong><br><span class="text-muted" style="font-size:0.8rem;">${item.minutes}min</span></div>
                                    <div class="history-item-actions">
                                        <span class="action-link" onclick="initEditTotalTimeLog(${item.id})">Edit</span>
                                        <span class="action-link delete" onclick="deleteTotalTimeLog(${item.id})">Del</span>
                                    </div>
                                </li>
                            `;
                        }

                        let metricStr = Object.entries(item.data).map(([k, v]) => {
                            let unit = k === 'timeSeconds' ? 's' : k === 'timeMinutes' ? 'm' : k === 'distance' ? 'mi' : k === 'weight' ? 'lbs' : ` ${k}`;
                            return `${v}${unit}`;
                        }).join(" | ");

                        let intBadge = item.intensity ? `<span class="badge-intensity" style="background-color:${getIntensityColor(item.intensity)};">${'★'.repeat(item.intensity)}</span>` : '';
                        const _hEx = findExerciseDef(item.exerciseName);
                        const _hEmoji = (_hEx && _hEx.emoji) ? _hEx.emoji : getCategoryEmoji(_hEx?.category);

                        return `
                            <li class="list-group-item">
                                <div><strong>${_hEmoji} ${item.exerciseName}</strong>${intBadge}<br><span class="text-muted" style="font-size:0.8rem;">${metricStr}</span></div>
                                <div class="history-item-actions">
                                    <span class="action-link" onclick="initEditEntry(${item.id})">Edit</span>
                                    <span class="action-link delete" onclick="deleteEntry(${item.id})">Del</span>
                                </div>
                            </li>
                        `;
                    }).join("")}
                </ul>
            </div>
        `;
    }).join("");

    renderIntensityChart();
}

// --- APP EVENT LISTENER ATTACHMENTS ---
function setupEventListeners() {
    document.getElementById("plan-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const type = document.getElementById("schedule-type").value;
        const restToggle = document.getElementById("plan-rest-toggle");
        const isRest = restToggle && restToggle.checked;

        const dayVal = type === 'weekly' ? document.getElementById("plan-day").value : null;
        const sameDayCount = (!isRest && type === 'weekly')
            ? state.plans.filter(p => p.type === 'weekly' && p.exercise !== "__rest__" && String(p.day) === String(dayVal)).length
            : 0;

        const newPlan = {
            id: Date.now(),
            exercise: isRest ? "__rest__" : document.getElementById("plan-exercise").value,
            type: type,
            day: dayVal,
            interval: type === 'interval' ? document.getElementById("plan-interval").value : null,
            startDate: type === 'interval' ? document.getElementById("plan-start-date").value : null,
            order: sameDayCount
        };

        state.plans.push(newPlan);
        saveState();
        haptic('success');
        initApp();
    });

    document.getElementById("custom-exercise-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const editIdxStr = document.getElementById("edit-exercise-index").value;
        const name = document.getElementById("new-ex-name").value.trim();
        const category = document.getElementById("new-ex-category").value;
        const checkedBoxes = e.target.querySelectorAll('input[name="metric"]:checked');
        let selectedMetrics = Array.from(checkedBoxes).map(cb => cb.value);

        if (selectedMetrics.length === 0) {
            alert("Please check at least one tracking field metric.");
            return;
        }

        const emojiField = document.getElementById('new-ex-emoji');
        const emoji = emojiField ? emojiField.value.trim() || null : null;

        if (editIdxStr !== "") {
            let idx = parseInt(editIdxStr);
            let oldName = state.exercises[idx].name;

            if (oldName.toLowerCase() !== name.toLowerCase() && state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
                alert("This exercise name already exists.");
                return;
            }

            state.history.forEach(h => {
                if (h.exerciseName === oldName) h.exerciseName = name;
            });
            state.plans.forEach(p => {
                if (p.exercise === oldName) p.exercise = name;
            });

            // Preserve existing emoji if field left blank on edit
            const existingEmoji = state.exercises[idx].emoji || null;
            state.exercises[idx] = { name, category, emoji: emoji !== null ? emoji : existingEmoji, metrics: selectedMetrics };
        } else {
            if (state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
                alert("This exercise name already exists.");
                return;
            }
            state.exercises.push({ name: name, category: category, emoji: emoji, metrics: selectedMetrics });
        }

        saveState();
        haptic('success');
        cancelExerciseEdit();
        initApp();
    });

    document.getElementById("custom-measurement-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const editKey = document.getElementById("edit-measurement-key").value;
        const name = document.getElementById("new-meas-name").value.trim();
        const unit = document.getElementById("new-meas-unit").value.trim();

        if (!name || !unit) return;

        if (editKey) {
            let idx = state.measurements.findIndex(m => m.key === editKey);
            if (idx === -1) return;
            // Name-collision check against other measurements (case-insensitive)
            if (state.measurements.some(m => m.key !== editKey && m.name.toLowerCase() === name.toLowerCase())) {
                alert("This measurement name already exists.");
                return;
            }
            state.measurements[idx] = { ...state.measurements[idx], name, unit };
        } else {
            if (state.measurements.some(m => m.name.toLowerCase() === name.toLowerCase())) {
                alert("This measurement name already exists.");
                return;
            }
            const key = slugifyMeasurementName(name);
            state.measurements.push({ key, name, unit });
        }

        saveState();
        haptic('success');
        cancelMeasurementEdit();
        initApp();
    });

    document.getElementById("tracking-log-form").addEventListener("submit", (e) => TrackingModal.submit(e));
    document.getElementById("log-exercise-form").addEventListener("submit", (e) => LogModal.submitExercise(e));
    document.getElementById("log-measurement-form").addEventListener("submit", (e) => LogModal.submitMeasurement(e));
    document.getElementById("log-totaltime-form").addEventListener("submit", (e) => LogModal.submitTotalTime(e));
}

function toggleScheduleInputs() {
    const type = document.getElementById("schedule-type").value;
    document.getElementById("weekly-inputs").classList.toggle("hidden", type !== "weekly");
    document.getElementById("interval-inputs").classList.toggle("hidden", type !== "interval");
}

function renderPlanList() {
    const container = document.getElementById("organized-plan-view");
    if (!container) return;
    container.innerHTML = "";

    if (state.plans.length === 0) {
        container.innerHTML = `<p class="text-muted">No scheduled routines set up yet.</p>`;
        return;
    }

    let weeklyPlans = state.plans.filter(p => p.type === 'weekly');
    let intervalPlans = state.plans.filter(p => p.type === 'interval');

    let html = `<div class="schedule-section-title">Weekly Schedule</div>`;

    const dragHandleSvg = `<svg class="drag-handle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/></svg>`;

    const sortedDaysIndices = [1, 2, 3, 4, 5, 6, 0];
    sortedDaysIndices.forEach(dayIdx => {
        let dayPlans = weeklyPlans.filter(p => parseInt(p.day) === dayIdx);
        
        html += `
            <div class="plan-day-block" data-day-idx="${dayIdx}">
                <div class="plan-day-block-title">${DAYS_LONG[dayIdx]}</div>
                ${(() => {
                    const restPlan = dayPlans.find(p => p.exercise === "__rest__");
                    const exPlans = dayPlans.filter(p => p.exercise !== "__rest__")
                        .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
                    let h = "";
                    if (restPlan) h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0;font-size:0.85rem;"><span>Rest Day</span><button onclick="deletePlan(${restPlan.id})" class="badge" style="background:#4b5563;border:none;color:white;cursor:pointer;">X</button></div>`;
                    if (!restPlan && exPlans.length === 0) h += '<p class="text-muted" style="font-size:0.8rem;padding:0.25rem 0;">—</p>';
                    if (exPlans.length > 0) {
                        h += '<ul class="list-group plan-day-ul">' + exPlans.map(plan => `
                            <li class="list-group-item plan-order-item" data-plan-id="${plan.id}">
                                <span class="plan-order-item-main">
                                    <span class="drag-handle" aria-label="Reorder">${dragHandleSvg}</span>
                                    <span>${plan.exercise}</span>
                                </span>
                                <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626;border:none;color:white;cursor:pointer;">X</button>
                            </li>
                        `).join("") + '</ul>';
                        if (exPlans.length > 1) {
                            h += `<p class="text-muted" style="font-size:0.7rem;margin-top:0.35rem;">Drag to reorder — grouped exercises form a superset.</p>`;
                        }
                    }
                    return h;
                })()}
            </div>
        `;
    });

    if (intervalPlans.length > 0) {
        intervalPlans.sort((a, b) => parseInt(a.interval) - parseInt(b.interval));
        html += `<div class="schedule-section-title">Interval Schedules</div><div class="plan-day-block"><ul class="list-group">`;
        html += intervalPlans.map(plan => `
            <li class="list-group-item">
                <div><strong>Every ${plan.interval} Days</strong>: ${plan.exercise} <br><span class="text-muted" style="font-size:0.75rem;">Starts ${plan.startDate}</span></div>
                <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button>
            </li>
        `).join("");
        html += `</ul></div>`;
    }

    container.innerHTML = html;
    setupPlanDragReorder();
}

// --- DRAG-AND-DROP REORDERING OF PLANNED EXERCISES WITHIN A DAY ---
// Pointer Events (not HTML5 DnD) so the same code path works for mouse and
// touch alike. Reordering is scoped per-day (each plan-day-ul is its own
// drag container) — grouping exercises together within a day is how the
// user expresses a superset.
let planDragState = null;

function setupPlanDragReorder() {
    document.querySelectorAll('.plan-day-ul').forEach(ul => {
        ul.querySelectorAll('.plan-order-item[data-plan-id]').forEach(li => {
            const handle = li.querySelector('.drag-handle');
            if (!handle) return;
            handle.addEventListener('pointerdown', (e) => startPlanDrag(e, li, ul));
        });
    });
}

function startPlanDrag(e, li, ul) {
    e.preventDefault();
    haptic('light');
    const items = Array.from(ul.querySelectorAll('.plan-order-item[data-plan-id]'));
    planDragState = { li, ul, items, startY: e.clientY };
    li.classList.add('dragging');
    try { li.setPointerCapture(e.pointerId); } catch (err) {}
    li.addEventListener('pointermove', onPlanDragMove);
    li.addEventListener('pointerup', onPlanDragEnd);
    li.addEventListener('pointercancel', onPlanDragEnd);
}

function onPlanDragMove(e) {
    if (!planDragState) return;
    const { li } = planDragState;
    const deltaY = e.clientY - planDragState.startY;
    li.style.transform = `translateY(${deltaY}px)`;

    const draggedRect = li.getBoundingClientRect();
    const draggedMidY = draggedRect.top + draggedRect.height / 2;
    const items = Array.from(planDragState.ul.querySelectorAll('.plan-order-item[data-plan-id]'));
    const draggedIdx = items.indexOf(li);

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        if (item === li) continue;
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (idx < draggedIdx && draggedMidY < midY) {
            item.parentNode.insertBefore(li, item);
            planDragState.startY = e.clientY;
            li.style.transform = '';
            break;
        } else if (idx > draggedIdx && draggedMidY > midY) {
            item.parentNode.insertBefore(li, item.nextSibling);
            planDragState.startY = e.clientY;
            li.style.transform = '';
            break;
        }
    }
}

function onPlanDragEnd(e) {
    if (!planDragState) return;
    const { li, ul } = planDragState;
    li.style.transform = '';
    li.classList.remove('dragging');
    li.removeEventListener('pointermove', onPlanDragMove);
    li.removeEventListener('pointerup', onPlanDragEnd);
    li.removeEventListener('pointercancel', onPlanDragEnd);

    const orderedIds = Array.from(ul.querySelectorAll('.plan-order-item[data-plan-id]'))
        .map(item => parseInt(item.dataset.planId, 10));
    orderedIds.forEach((id, idx) => {
        const plan = state.plans.find(p => p.id === id);
        if (plan) plan.order = idx;
    });
    saveState();
    haptic('light');
    planDragState = null;
    renderPlanList();
}

// --- TIMER MODAL (idle / running(green) / paused(orange) state machine) ---
const TimerModal = {
    state: "idle",       // "idle" | "running" | "paused"
    startedAt: 0,         // timestamp when current running segment began
    elapsedMs: 0,         // accumulated elapsed time across pauses
    currentLapStartMs: 0, // total-elapsed offset at which the current (live) lap began
    laps: [],             // array of { label, elapsedMs, splitMs }
    intervalId: null,

    open() {
        haptic('light');
        switchView('timer');
        this.renderLaps();
        this.updateDisplay();
    },

    // The timer lives in its own bottom-nav tab now rather than a modal, so
    // there's nothing to dismiss — kept as a no-op since it may still be
    // referenced from older call sites.
    close() {},

    start() {
        haptic('light');
        this.state = "running";
        this.startedAt = Date.now();
        if (!this.intervalId) {
            this.intervalId = setInterval(() => this.updateDisplay(), 100);
        }
        this.refreshUI();
    },

    pause() {
        haptic('light');
        this.elapsedMs += Date.now() - this.startedAt;
        this.state = "paused";
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.refreshUI();
    },

    lap() {
        haptic('light');
        const totalElapsed = this.getElapsedMs();
        const prevTotal = this.laps.length > 0 ? this.laps[this.laps.length - 1].elapsedMs : 0;
        this.laps.push({
            label: `Lap ${this.laps.length + 1}`,
            elapsedMs: totalElapsed,
            splitMs: totalElapsed - prevTotal
        });
        this.currentLapStartMs = totalElapsed;
        this.renderLaps();
        this.updateDisplay();
    },

    stop() {
        haptic('warning');
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.state = "idle";
        this.elapsedMs = 0;
        this.startedAt = 0;
        this.currentLapStartMs = 0;
        this.laps = [];
        this.refreshUI();
        this.renderLaps();
    },

    // Logs the current elapsed time (while paused) to the workout history as
    // a "Total Exercise Time" entry — a standalone time record not tied to
    // any specific exercise. Does not stop or reset the timer, so the user
    // can keep going and log again later if needed.
    logTotalTime() {
        const elapsedMs = this.getElapsedMs();
        if (elapsedMs < 1000) return; // nothing meaningful to log yet

        const minutes = Math.round((elapsedMs / 60000) * 100) / 100; // 2 decimal places
        haptic('success');

        state.totalTimeLogs.unshift({
            id: Date.now(),
            date: getLocalDateString(new Date()),
            minutes: minutes
        });
        state.totalTimeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
        saveState();

        const hint = document.getElementById("timer-log-hint");
        if (hint) {
            hint.textContent = `Logged ${this.formatMs(elapsedMs)} to workout log ✓`;
            clearTimeout(this._logHintTimer);
            this._logHintTimer = setTimeout(() => { hint.textContent = ""; }, 2500);
        }

        // Refresh anything on Track/Stats that depends on history, without
        // tearing down the running timer UI itself.
        renderTodayExercisesCard();
        renderTrackKpis();
    },

    getElapsedMs() {
        if (this.state === "running") {
            return this.elapsedMs + (Date.now() - this.startedAt);
        }
        return this.elapsedMs;
    },

    // Time elapsed since the most recent lap (or since start, if no laps yet).
    getCurrentLapMs() {
        return Math.max(0, this.getElapsedMs() - this.currentLapStartMs);
    },

    formatMs(ms) {
        const totalTenths = Math.floor(ms / 100);
        const tenths = totalTenths % 10;
        const totalSeconds = Math.floor(ms / 1000);
        const seconds = totalSeconds % 60;
        const minutes = Math.floor(totalSeconds / 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
    },

    updateDisplay() {
        const display = document.getElementById("timer-display");
        const lapDisplay = document.getElementById("timer-lap-display");
        if (display) display.innerText = this.formatMs(this.getElapsedMs());
        if (lapDisplay) {
            // Only meaningful while a session is actually active (running or
            // paused mid-session) — idle has no lap to show.
            const showLap = this.state === "running" || (this.state === "paused" && this.elapsedMs > 0);
            if (showLap) {
                lapDisplay.innerText = `Lap ${this.formatMs(this.getCurrentLapMs())}`;
                lapDisplay.classList.remove("hidden");
            } else {
                lapDisplay.classList.add("hidden");
            }
        }
    },

    // Updates header icon color, modal control set (idle/running/paused), and state label
    refreshUI() {
        this.updateDisplay();

        const timerBtn = document.getElementById("nav-timer");
        const stateLabel = document.getElementById("timer-state-label");
        const idleControls = document.getElementById("timer-controls-idle");
        const runningControls = document.getElementById("timer-controls-running");
        const pausedControls = document.getElementById("timer-controls-paused");
        const lapsWrapper = document.getElementById("timer-laps-wrapper");

        if (timerBtn) timerBtn.classList.remove("timer-icon-running", "timer-icon-paused");
        idleControls.classList.add("hidden");
        runningControls.classList.add("hidden");
        pausedControls.classList.add("hidden");

        if (this.state === "running") {
            if (timerBtn) timerBtn.classList.add("timer-icon-running");
            stateLabel.innerText = "Running";
            runningControls.classList.remove("hidden");
            lapsWrapper.classList.remove("hidden");
        } else if (this.state === "paused") {
            if (timerBtn) timerBtn.classList.add("timer-icon-paused");
            stateLabel.innerText = "Paused";
            pausedControls.classList.remove("hidden");
            lapsWrapper.classList.toggle("hidden", this.laps.length === 0);
        } else {
            stateLabel.innerText = "Ready";
            idleControls.classList.remove("hidden");
            lapsWrapper.classList.add("hidden");
        }
    },

    renderLaps() {
        const list = document.getElementById("timer-laps-list");
        if (!list) return;
        if (this.laps.length === 0) {
            list.innerHTML = `<li class="list-group-item text-muted" style="justify-content:center;">No laps yet</li>`;
            return;
        }
        // Most recent lap first
        list.innerHTML = this.laps.slice().reverse().map(lap => `
            <li class="list-group-item">
                <span>${lap.label}</span>
                <span>${this.formatMs(lap.splitMs)} <span class="text-muted">(${this.formatMs(lap.elapsedMs)})</span></span>
            </li>
        `).join("");
    }
};


const TrackingModal = {
    open() {
        haptic('light');
        this.renderPicker();
        this.backToPicker();
        document.getElementById("tracking-modal").classList.remove("hidden");
    },

    close() {
        document.getElementById("tracking-modal").classList.add("hidden");
    },

    renderPicker() {
        const list = document.getElementById("tracking-measurement-list");
        if (!list) return;
        list.innerHTML = "";

        let sorted = [...state.measurements].sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach(m => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tracking-measurement-option";
            btn.onclick = () => TrackingModal.openLogForm(m.key);
            btn.innerHTML = `
                <span class="tm-name">${ICON_RULER} ${m.name}</span>
                <span class="tm-unit">${m.unit}</span>
            `;
            list.appendChild(btn);
        });
    },

    backToPicker() {
        document.getElementById("tracking-picker-step").classList.remove("hidden");
        document.getElementById("tracking-log-form").classList.add("hidden");
        document.getElementById("tracking-log-edit-id").value = "";
        document.getElementById("tracking-modal-title").innerText = "Tracking";
    },

    openLogForm(measurementKey, existingLog = null) {
        const m = state.measurements.find(x => x.key === measurementKey);
        if (!m) return;

        document.getElementById("tracking-picker-step").classList.add("hidden");
        const form = document.getElementById("tracking-log-form");
        form.classList.remove("hidden");

        document.getElementById("tracking-log-measurement-key").value = measurementKey;
        const isBp = isBloodPressureKey(measurementKey);
        document.getElementById("tracking-log-field-label").innerText = isBp ? `Systolic (${m.unit})` : `${m.name} (${m.unit})`;
        document.getElementById("tracking-modal-title").innerText = `Log ${m.name}`;
        document.getElementById("tracking-log-diastolic-group").classList.toggle("hidden", !isBp);

        const valueInput = document.getElementById("tracking-log-value");
        const diastolicInput = document.getElementById("tracking-log-diastolic");
        const dateInput = document.getElementById("tracking-log-date");
        const submitBtn = document.getElementById("tracking-log-submit-btn");

        if (existingLog) {
            document.getElementById("tracking-log-edit-id").value = existingLog.id;
            valueInput.value = existingLog.value;
            diastolicInput.value = existingLog.diastolic !== undefined ? existingLog.diastolic : "";
            dateInput.value = existingLog.date;
            submitBtn.innerText = "Update";
        } else {
            document.getElementById("tracking-log-edit-id").value = "";
            valueInput.value = "";
            diastolicInput.value = "";
            const mostRecent = [...state.measurementLogs]
                .filter(l => l.measurementKey === measurementKey)
                .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            valueInput.placeholder = mostRecent ? `Prev: ${mostRecent.value}` : "0.0";
            diastolicInput.placeholder = mostRecent && mostRecent.diastolic !== undefined ? `Prev: ${mostRecent.diastolic}` : "0";
            dateInput.value = getLocalDateString(new Date());
            submitBtn.innerText = "Save";
        }
        valueInput.focus();
    },

    submit(e) {
        e.preventDefault();
        const measurementKey = document.getElementById("tracking-log-measurement-key").value;
        const editId = document.getElementById("tracking-log-edit-id").value;
        const value = parseFloat(document.getElementById("tracking-log-value").value);
        const date = document.getElementById("tracking-log-date").value;
        const isBp = isBloodPressureKey(measurementKey);
        const diastolicRaw = document.getElementById("tracking-log-diastolic").value;
        const diastolic = isBp && diastolicRaw !== "" ? parseFloat(diastolicRaw) : undefined;

        if (!measurementKey || !date || !Number.isFinite(value)) return;

        if (editId) {
            let idx = state.measurementLogs.findIndex(l => l.id === parseInt(editId));
            if (idx !== -1) {
                state.measurementLogs[idx].value = value;
                state.measurementLogs[idx].date = date;
                if (isBp) state.measurementLogs[idx].diastolic = diastolic;
                else delete state.measurementLogs[idx].diastolic;
            }
        } else {
            const newLog = {
                id: Date.now(),
                date: date,
                measurementKey: measurementKey,
                value: value
            };
            if (isBp && diastolic !== undefined) newLog.diastolic = diastolic;
            state.measurementLogs.unshift(newLog);
        }

        saveState();
        haptic('success');
        this.close();
        initApp();
    },

    // Opens the log form pre-filled for editing, used from the History Logs By Day list
    editLog(id) {
        const log = state.measurementLogs.find(l => l.id === id);
        if (!log) return;
        this.renderPicker();
        document.getElementById("tracking-modal").classList.remove("hidden");
        this.openLogForm(log.measurementKey, log);
    },

    deleteLog(id) {
        if (confirm("Are you sure you want to delete this historical measurement entry?")) {
            state.measurementLogs = state.measurementLogs.filter(l => l.id !== id);
            saveState();
            initApp();
        }
    }
};

// --- LOG MODAL (global "+" entry point) ---
// 3-step flow: Exercise vs Measurement -> pick which one -> entry fields.
// Saving goes through the exact same state mutations as the inline
// Track-tab form (for exercises) and the Tracking modal (for measurements),
// so there's one source of truth for what a "save" actually does.
const LogModal = {
    step: "kind", // "kind" | "exercise-pick" | "measurement-pick" | "exercise-form" | "measurement-form"

    open() {
        haptic('light');
        this.goToKind();
        document.getElementById("log-modal").classList.remove("hidden");
    },

    close() {
        document.getElementById("log-modal").classList.add("hidden");
    },

    _setStep(step, title, showBack) {
        this.step = step;
        document.getElementById("log-step-kind").classList.toggle("hidden", step !== "kind");
        document.getElementById("log-step-exercise-pick").classList.toggle("hidden", step !== "exercise-pick");
        document.getElementById("log-step-measurement-pick").classList.toggle("hidden", step !== "measurement-pick");
        document.getElementById("log-exercise-form").classList.toggle("hidden", step !== "exercise-form");
        document.getElementById("log-measurement-form").classList.toggle("hidden", step !== "measurement-form");
        document.getElementById("log-totaltime-form").classList.toggle("hidden", step !== "totaltime-form");
        document.getElementById("log-modal-title").innerText = title;
        document.getElementById("log-modal-back-btn").style.visibility = showBack ? "visible" : "hidden";
    },

    goToKind() {
        this._setStep("kind", "Log", false);
    },

    // Back navigation mirrors the forward path: form -> pick -> kind.
    // Total Time has no intermediate pick step, so its form goes straight
    // back to kind, same as the others end up doing.
    back() {
        this.goToKind();
    },

    chooseKind(kind) {
        haptic('light');
        if (kind === "exercise") {
            this.renderExercisePicker();
            this._setStep("exercise-pick", "Choose Exercise", true);
        } else if (kind === "measurement") {
            this.renderMeasurementPicker();
            this._setStep("measurement-pick", "Choose Measurement", true);
        } else if (kind === "totaltime") {
            this.openTotalTimeForm();
        }
    },

    // Total Time is its own entry type (not an exercise, not a measurement)
    // — a standalone time record, same underlying history entry shape the
    // Timer's "Log Total Time" button has always produced, just entered
    // manually with a date/minutes form instead of read off a running clock.
    openTotalTimeForm(existingEntry = null) {
        document.getElementById("log2-tt-edit-id").value = existingEntry ? existingEntry.id : "";
        document.getElementById("log2-tt-minutes").value = existingEntry ? (existingEntry.minutes ?? "") : "";
        document.getElementById("log2-tt-date").value = existingEntry ? existingEntry.date : getLocalDateString(new Date());
        document.getElementById("log2-tt-submit-btn").innerText = existingEntry ? "Update Entry" : "Save Entry";
        this._setStep("totaltime-form", existingEntry ? "Edit Total Time" : "Log Total Time", true);
        document.getElementById("log2-tt-minutes").focus();
    },

    submitTotalTime(e) {
        e.preventDefault();
        const editingId = document.getElementById("log2-tt-edit-id").value;
        const date = document.getElementById("log2-tt-date").value;
        const minutes = parseFloat(document.getElementById("log2-tt-minutes").value);
        if (!date || !Number.isFinite(minutes)) return;

        if (editingId) {
            let index = state.totalTimeLogs.findIndex(t => t.id === parseInt(editingId));
            if (index !== -1) {
                state.totalTimeLogs[index].date = date;
                state.totalTimeLogs[index].minutes = minutes;
            }
        } else {
            state.totalTimeLogs.unshift({
                id: Date.now(),
                date: date,
                minutes: minutes
            });
        }

        state.totalTimeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
        saveState();
        haptic('success');
        this.close();
        initApp();
    },

    renderExercisePicker() {
        const list = document.getElementById("log-exercise-pick-list");
        if (!list) return;
        list.innerHTML = "";

        let sorted = [...state.exercises].sort((a, b) => {
            const catA = a.category || "Uncategorized";
            const catB = b.category || "Uncategorized";
            if (catA !== catB) return catA.localeCompare(catB);
            return a.name.localeCompare(b.name);
        });

        let lastCategory = null;
        sorted.forEach(ex => {
            const cat = ex.category || "Uncategorized";
            if (cat !== lastCategory) {
                const header = document.createElement("div");
                header.className = "schedule-section-title log-pick-category-title";
                header.textContent = cat;
                list.appendChild(header);
                lastCategory = cat;
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tracking-measurement-option";
            btn.onclick = () => LogModal.openExerciseForm(ex.name);
            const emoji = ex.emoji || getCategoryEmoji(ex.category);
            btn.innerHTML = `
                <span class="tm-name">${emoji} ${ex.name}</span>
                <span class="tm-unit">${ex.category || ''}</span>
            `;
            list.appendChild(btn);
        });
    },

    renderMeasurementPicker() {
        const list = document.getElementById("log-measurement-pick-list");
        if (!list) return;
        list.innerHTML = "";

        let sorted = [...state.measurements].sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach(m => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "tracking-measurement-option";
            btn.onclick = () => LogModal.openMeasurementForm(m.key);
            btn.innerHTML = `
                <span class="tm-name">${ICON_RULER} ${m.name}</span>
                <span class="tm-unit">${m.unit}</span>
            `;
            list.appendChild(btn);
        });
    },

    openExerciseForm(exerciseName, existingEntry = null, defaultDate = null) {
        document.getElementById("log2-exercise-name").value = exerciseName;
        document.getElementById("log2-edit-entry-id").value = existingEntry ? existingEntry.id : "";
        document.getElementById("log2-date").value = existingEntry ? existingEntry.date : (defaultDate || getLocalDateString(new Date()));
        setLog2StarRatingValue(existingEntry ? (existingEntry.intensity || 0) : 0);
        buildLog2DynamicFormFields(exerciseName, existingEntry ? existingEntry.data : null);
        document.getElementById("log2-exercise-submit-btn").innerText = existingEntry ? "Update Entry" : "Save Entry";
        this._setStep("exercise-form", existingEntry ? "Edit Exercise Log" : `Log ${exerciseName}`, true);
    },

    openMeasurementForm(measurementKey, existingLog = null) {
        const m = state.measurements.find(x => x.key === measurementKey);
        if (!m) return;

        document.getElementById("log2-meas-key").value = measurementKey;
        document.getElementById("log2-meas-edit-id").value = existingLog ? existingLog.id : "";
        const isBp = isBloodPressureKey(measurementKey);
        document.getElementById("log2-meas-field-label").innerText = isBp ? `Systolic (${m.unit})` : `${m.name} (${m.unit})`;
        document.getElementById("log2-meas-diastolic-group").classList.toggle("hidden", !isBp);

        const valueInput = document.getElementById("log2-meas-value");
        const diastolicInput = document.getElementById("log2-meas-diastolic");
        const dateInput = document.getElementById("log2-meas-date");
        const submitBtn = document.getElementById("log2-meas-submit-btn");

        if (existingLog) {
            valueInput.value = existingLog.value;
            diastolicInput.value = existingLog.diastolic !== undefined ? existingLog.diastolic : "";
            dateInput.value = existingLog.date;
            submitBtn.innerText = "Update";
        } else {
            valueInput.value = "";
            diastolicInput.value = "";
            const mostRecent = [...state.measurementLogs]
                .filter(l => l.measurementKey === measurementKey)
                .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            valueInput.placeholder = mostRecent ? `Prev: ${mostRecent.value}` : "0.0";
            diastolicInput.placeholder = mostRecent && mostRecent.diastolic !== undefined ? `Prev: ${mostRecent.diastolic}` : "0";
            dateInput.value = getLocalDateString(new Date());
            submitBtn.innerText = "Save";
        }

        this._setStep("measurement-form", existingLog ? `Edit ${m.name}` : `Log ${m.name}`, true);
        valueInput.focus();
    },

    // Shortcut used by the Track tab's "Today's Exercises" card — opens
    // straight to the entry form for a given exercise, pre-filled with
    // today's date, skipping the kind/pick steps entirely.
    quickLogExercise(exerciseName) {
        haptic('light');
        document.getElementById("log-modal").classList.remove("hidden");
        this.openExerciseForm(exerciseName, null, getLocalDateString(new Date()));
    },

    submitExercise(e) {
        e.preventDefault();
        const editingId = document.getElementById("log2-edit-entry-id").value;
        const exerciseName = document.getElementById("log2-exercise-name").value;
        const exercise = findExerciseDef(exerciseName);
        if (!exercise) return;
        const selectedDate = document.getElementById("log2-date").value;
        const intensityRaw = parseInt(document.getElementById("log2-intensity").value, 10) || 0;
        const intensity = intensityRaw > 0 ? intensityRaw : null;

        let logData = {};
        exercise.metrics.forEach(fieldKey => {
            const input = document.getElementById(`log2-field-${fieldKey}`);
            logData[fieldKey] = parseFloat(input ? input.value : 0) || 0;
        });

        if (editingId) {
            let index = state.history.findIndex(h => h.id === parseInt(editingId));
            if (index !== -1) {
                state.history[index].date = selectedDate;
                state.history[index].exerciseName = exerciseName;
                state.history[index].intensity = intensity || null;
                state.history[index].data = logData;
            }
        } else {
            state.history.unshift({
                id: Date.now(),
                date: selectedDate,
                exerciseName: exerciseName,
                intensity: intensity || null,
                data: logData
            });
        }

        state.history.sort((a, b) => new Date(b.date) - new Date(a.date));
        saveState();
        haptic('success');
        this.close();
        initApp();
    },

    submitMeasurement(e) {
        e.preventDefault();
        const measurementKey = document.getElementById("log2-meas-key").value;
        const editId = document.getElementById("log2-meas-edit-id").value;
        const value = parseFloat(document.getElementById("log2-meas-value").value);
        const date = document.getElementById("log2-meas-date").value;
        const isBp = isBloodPressureKey(measurementKey);
        const diastolicRaw = document.getElementById("log2-meas-diastolic").value;
        const diastolic = isBp && diastolicRaw !== "" ? parseFloat(diastolicRaw) : undefined;

        if (!measurementKey || !date || !Number.isFinite(value)) return;

        if (editId) {
            let idx = state.measurementLogs.findIndex(l => l.id === parseInt(editId));
            if (idx !== -1) {
                state.measurementLogs[idx].value = value;
                state.measurementLogs[idx].date = date;
                if (isBp) state.measurementLogs[idx].diastolic = diastolic;
                else delete state.measurementLogs[idx].diastolic;
            }
        } else {
            const newLog = {
                id: Date.now(),
                date: date,
                measurementKey: measurementKey,
                value: value
            };
            if (isBp && diastolic !== undefined) newLog.diastolic = diastolic;
            state.measurementLogs.unshift(newLog);
        }

        saveState();
        haptic('success');
        this.close();
        initApp();
    }
};

// --- SETTINGS DRAWER (hamburger menu) ---
// Top-level menu swaps to one of 4 sections; each section reuses the same
// markup/IDs the old Plan/Data tabs used, so all existing form-submit and
// management logic keeps working unchanged.
const SettingsDrawer = {
    currentSection: null,

    open() {
        haptic('light');
        document.getElementById("drawer-overlay").classList.remove("hidden");
        document.getElementById("settings-drawer").classList.add("open");
        this.backToMenu();
    },

    close() {
        document.getElementById("drawer-overlay").classList.add("hidden");
        document.getElementById("settings-drawer").classList.remove("open");
    },

    backToMenu() {
        this.currentSection = null;
        document.getElementById("drawer-menu-list").classList.remove("hidden");
        document.querySelectorAll(".drawer-section").forEach(s => s.classList.add("hidden"));
        document.getElementById("drawer-title").innerText = "Menu";
        document.getElementById("drawer-back-btn").style.visibility = "hidden";
        cancelExerciseEdit();
        cancelMeasurementEdit();
    },

    openSection(section) {
        haptic('light');
        this.currentSection = section;
        document.getElementById("drawer-menu-list").classList.add("hidden");
        document.querySelectorAll(".drawer-section").forEach(s => s.classList.add("hidden"));

        const titles = { plan: "Plan", exercises: "Custom Exercises", measurements: "Custom Measurements", data: "Backup & Data" };
        document.getElementById("drawer-title").innerText = titles[section] || "Menu";
        document.getElementById("drawer-back-btn").style.visibility = "visible";

        const sectionEl = document.getElementById(`drawer-section-${section}`);
        if (sectionEl) sectionEl.classList.remove("hidden");

        if (section === "plan") renderPlanList();
        if (section === "exercises") renderManageExercises();
        if (section === "measurements") renderManageMeasurements();
        if (section === "data" && typeof refreshBackupStatusDisplay === "function") refreshBackupStatusDisplay();
    }
};


// iOS Safari silently no-ops `<a download>` clicks when the site is running
// as an installed standalone PWA — no error, nothing downloads, it just does
// nothing. The Web Share API (with a File) is the one mechanism that
// reliably works for saving a file out of an installed iOS PWA, so it's
// tried first; the classic anchor-download approach (which works fine in a
// regular browser tab, and on platforms/browsers without file-sharing
// support) is kept as the fallback.
async function shareOrDownloadFile(filename, mimeType, contentStr) {
    try {
        const file = new File([contentStr], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
        }
    } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled the share sheet
        console.warn("Web Share failed, falling back to direct download:", err);
    }

    const dataStr = `data:${mimeType};charset=utf-8,` + encodeURIComponent(contentStr);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function exportData() {
    const dataStr = JSON.stringify(state, null, 2);
    shareOrDownloadFile("engineered_exercise_backup.json", "application/json", dataStr);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState.history && importedState.exercises) {
                state = importedState;
                // Older backups won't have this category yet — initApp()'s
                // migrateTotalTimeEntries() will also pull out any Total
                // Time rows still embedded in history, if present.
                if (!Array.isArray(state.totalTimeLogs)) state.totalTimeLogs = [];
                saveState();
                initApp();
                alert("Data configuration imported successfully!");
            }
        } catch (err) {
            alert("Error parsing configuration json backup file structure templates.");
        }
    };
    reader.readAsText(file);
}

function exportCSV() {
    const hasHistory = state.history.length > 0;
    const hasTotalTime = state.totalTimeLogs && state.totalTimeLogs.length > 0;
    if (!hasHistory && !hasTotalTime) {
        alert("No historical workout log entries found to export.");
        return;
    }

    const allMetricKeys = new Set();
    state.history.forEach(entry => {
        if (entry.data) {
            Object.keys(entry.data).forEach(key => allMetricKeys.add(key));
        }
    });
    if (hasTotalTime) allMetricKeys.add("timeMinutes");
    const metricKeysArray = Array.from(allMetricKeys).sort();

    const baseHeaders = ["ID", "Date", "Exercise Name", "Intensity"];
    const fullHeaders = [...baseHeaders, ...metricKeysArray];

    const csvRows = [];
    csvRows.push(fullHeaders.map(header => `"${header}"`).join(","));

    state.history.forEach(entry => {
        const rowData = [
            entry.id,
            entry.date,
            entry.exerciseName,
            entry.intensity || ""
        ];

        metricKeysArray.forEach(key => {
            const value = entry.data && entry.data[key] !== undefined ? entry.data[key] : "";
            rowData.push(value);
        });

        const processedRow = rowData.map(val => {
            const strVal = String(val).replace(/"/g, '""');
            return `"${strVal}"`;
        });
        csvRows.push(processedRow.join(","));
    });

    // Total Time is its own record category (state.totalTimeLogs), but the
    // CSV export stays a single flat timeline — appended here as rows under
    // the same "Total Exercise Time" label it always had.
    (state.totalTimeLogs || []).forEach(entry => {
        const rowData = [entry.id, entry.date, TOTAL_TIME_EXERCISE_NAME, ""];
        metricKeysArray.forEach(key => {
            rowData.push(key === "timeMinutes" ? entry.minutes : "");
        });
        const processedRow = rowData.map(val => {
            const strVal = String(val).replace(/"/g, '""');
            return `"${strVal}"`;
        });
        csvRows.push(processedRow.join(","));
    });

    const csvContent = "\uFEFF" + csvRows.join("\n");
    shareOrDownloadFile("engineered_exercise_history.csv", "text/csv", csvContent);
}
