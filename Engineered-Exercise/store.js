// =============================================================================
// Engineered Exercise — Store (the "backend")
// =============================================================================
// This module owns ALL persisted data and ALL business logic: models,
// persistence, migrations, CRUD, scheduling, streaks, and chart math. It
// never touches the DOM — no `document`, no `window` except for reading
// `localStorage`, which is isolated behind the small Persistence adapter
// at the bottom of this comment block. That isolation is deliberate: it's
// the one seam a native port would replace (e.g. with UserDefaults or a
// JSON file via FileManager) without touching anything else in this file.
//
// Porting guide (JS -> Swift), for whoever does that port:
//   - Every @typedef below            -> a Codable struct
//   - `state` (one object, 6 arrays)  -> an ObservableObject with @Published arrays
//   - `Persistence.get/set`           -> a small protocol (UserDefaults or file-backed)
//   - Every exported function here    -> a method on that ObservableObject
//   - `onChange(fn)`                  -> @Published already gives you this for free
//   - Nothing in this file depends on execution order beyond `Store.load()`
//     being called once before anything else runs.
//
// app.js (the "frontend") holds `state` by reference and never reassigns
// it — only Store mutates it, always through the methods below, always
// followed by persistAll(). That's what keeps the UI and storage in sync
// without a heavier framework.
// =============================================================================

const Store = (() => {
    "use strict";

    // ============================================================
    // MODELS
    // (JSDoc typedefs only — plain object shapes, no classes/behavior.
    // These are exactly what a Swift `Codable struct` should mirror.)
    // ============================================================
    /**
     * @typedef {Object} Exercise
     * @property {string} name
     * @property {string|null} category
     * @property {string|null} [emoji]
     * @property {string[]} metrics - subset of "sets"|"reps"|"weight"|"timeSeconds"|"timeMinutes"|"distance"
     */
    /**
     * @typedef {Object} HistoryEntry
     * @property {number} id - Date.now() at creation time; unique within `history`
     * @property {string} date - "YYYY-MM-DD", local time
     * @property {string} exerciseName
     * @property {number|null} intensity - 1-5 star rating, or null if unrated
     * @property {Object.<string, number>} data - metric values keyed by field name (see FIELD_LABELS)
     */
    /**
     * @typedef {Object} Measurement
     * @property {string} key - stable slug, generated once at creation, never changes
     * @property {string} name
     * @property {string} unit
     */
    /**
     * @typedef {Object} MeasurementLog
     * @property {number} id - unique within `measurementLogs`
     * @property {string} date
     * @property {string} measurementKey
     * @property {number} value - for blood pressure, this holds systolic
     * @property {number} [diastolic] - blood-pressure measurements only
     */
    /**
     * @typedef {Object} TotalTimeLog
     * @property {number} id - unique within `totalTimeLogs`
     * @property {string} date
     * @property {number} minutes
     */
    /**
     * @typedef {Object} Plan
     * @property {number} id - unique within `plans`
     * @property {string} exercise - exercise name, or the sentinel "__rest__"
     * @property {"weekly"|"interval"} type
     * @property {string|null} day - "0".."6" (Sun-Sat), weekly only
     * @property {string|null} interval - integer string, interval only
     * @property {string|null} startDate - "YYYY-MM-DD", interval only
     * @property {number} [order] - drag-reorder position among same-day plans (superset order)
     */
    /**
     * @typedef {Object} AppData - the full persisted shape; this is exactly
     * what getSnapshot()/JSON export/cloud backup carry. Never includes any
     * transient UI-only field.
     * @property {Exercise[]} exercises
     * @property {HistoryEntry[]} history
     * @property {Plan[]} plans
     * @property {Measurement[]} measurements
     * @property {MeasurementLog[]} measurementLogs
     * @property {TotalTimeLog[]} totalTimeLogs
     */

    // ============================================================
    // DEFAULTS & CONSTANTS
    // ============================================================
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
    // measurement schema, it's a special case wherever a measurement value is
    // entered/displayed: `value` holds systolic, and a sibling `diastolic`
    // field rides alongside it on the log entry.
    const BLOOD_PRESSURE_KEY = "blood_pressure";

    // Total Time is its own record category (state.totalTimeLogs), not an
    // exercise — TOTAL_TIME_EXERCISE_NAME/DEF exist only so history-entry
    // rendering (which resolves exercise defs by name) has an icon/label to
    // show for legacy data still mid-migration.
    const TOTAL_TIME_EXERCISE_NAME = "Total Exercise Time";
    const TOTAL_TIME_EXERCISE_DEF = { name: TOTAL_TIME_EXERCISE_NAME, category: null, emoji: "⏱️", metrics: ["timeMinutes"] };

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

    const MAX_CHART_POINTS = 50;
    const SETPOINT_FORMAT_ORDER = ["sets", "reps", "weight", "distance", "timeMinutes", "timeSeconds"];

    // ============================================================
    // PERSISTENCE ADAPTER
    // The only part of this file that touches a platform storage API.
    // Swap this out (UserDefaults/FileManager) and nothing else changes.
    // ============================================================
    const LS_KEYS = {
        exercises: "ee_exercises",
        history: "ee_history",
        plans: "ee_plans",
        measurements: "ee_measurements",
        measurementLogs: "ee_measurement_logs",
        totalTimeLogs: "ee_total_time_logs"
    };

    const Persistence = {
        get(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                console.warn("Store: failed to read", key, e);
                return null;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.warn("Store: failed to write", key, e);
            }
        }
    };

    // ============================================================
    // STATE
    // One stable container object. app.js holds a reference to this same
    // object and reads its properties directly for rendering; only Store
    // ever reassigns those properties (never the container itself), so
    // app.js's reference never goes stale.
    // ============================================================
    /** @type {AppData} */
    const state = {
        exercises: [],
        history: [],
        plans: [],
        measurements: [],
        measurementLogs: [],
        totalTimeLogs: []
    };

    const listeners = new Set();
    function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

    function persistAll() {
        Persistence.set(LS_KEYS.exercises, state.exercises);
        Persistence.set(LS_KEYS.history, state.history);
        Persistence.set(LS_KEYS.plans, state.plans);
        Persistence.set(LS_KEYS.measurements, state.measurements);
        Persistence.set(LS_KEYS.measurementLogs, state.measurementLogs);
        Persistence.set(LS_KEYS.totalTimeLogs, state.totalTimeLogs);
        if (typeof BackupSync !== "undefined") BackupSync.notifyStateChanged();
        notify();
    }

    // ============================================================
    // MIGRATIONS
    // Each one is idempotent — safe to run on every load.
    // ============================================================
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
        return changed;
    }

    // Older backups/sessions stored Total Time as a pseudo-exercise entry
    // inside `history` (exerciseName === TOTAL_TIME_EXERCISE_NAME), which
    // polluted exercise-only stats like "Most Logged Exercise". This pulls
    // any such entries out into state.totalTimeLogs and strips them from
    // history.
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

    function runMigrations() {
        const a = migrateIntensityData();
        const b = migrateTotalTimeEntries();
        return a || b;
    }

    // ============================================================
    // LOAD / REPLACE
    // ============================================================
    function load() {
        state.exercises = Persistence.get(LS_KEYS.exercises) || DEFAULT_EXERCISES.slice();
        state.history = Persistence.get(LS_KEYS.history) || [];
        state.plans = Persistence.get(LS_KEYS.plans) || [];
        state.measurements = Persistence.get(LS_KEYS.measurements) || DEFAULT_MEASUREMENTS.slice();
        state.measurementLogs = Persistence.get(LS_KEYS.measurementLogs) || [];
        state.totalTimeLogs = Persistence.get(LS_KEYS.totalTimeLogs) || [];

        if (!Array.isArray(state.exercises) || state.exercises.length === 0) state.exercises = DEFAULT_EXERCISES.slice();
        if (!Array.isArray(state.history)) state.history = [];
        if (!Array.isArray(state.plans)) state.plans = [];
        if (!Array.isArray(state.measurements) || state.measurements.length === 0) state.measurements = DEFAULT_MEASUREMENTS.slice();
        if (!Array.isArray(state.measurementLogs)) state.measurementLogs = [];
        if (!Array.isArray(state.totalTimeLogs)) state.totalTimeLogs = [];

        runMigrations();
        persistAll();
    }

    // Wholesale replace — used by JSON import and "Load Backup" during cloud
    // restore. Deliberately rebuilds every field (rather than trusting the
    // incoming object's shape) so an old/partial backup can't leave stale
    // data behind.
    function replaceAll(newData) {
        state.exercises = (newData && Array.isArray(newData.exercises)) ? newData.exercises : DEFAULT_EXERCISES.slice();
        state.history = (newData && Array.isArray(newData.history)) ? newData.history : [];
        state.plans = (newData && Array.isArray(newData.plans)) ? newData.plans : [];
        state.measurements = (newData && Array.isArray(newData.measurements) && newData.measurements.length > 0) ? newData.measurements : DEFAULT_MEASUREMENTS.slice();
        state.measurementLogs = (newData && Array.isArray(newData.measurementLogs)) ? newData.measurementLogs : [];
        state.totalTimeLogs = (newData && Array.isArray(newData.totalTimeLogs)) ? newData.totalTimeLogs : [];

        runMigrations();
        persistAll();
    }

    // ============================================================
    // SNAPSHOT (cloud backup + JSON export)
    // Always exactly the AppData shape — never a transient UI field.
    // ============================================================
    function getSnapshot() {
        return {
            exercises: state.exercises,
            history: state.history,
            plans: state.plans,
            measurements: state.measurements,
            measurementLogs: state.measurementLogs,
            totalTimeLogs: state.totalTimeLogs
        };
    }

    function applySnapshot(snapshot) {
        if (!snapshot || !snapshot.history || !snapshot.exercises) return false;
        replaceAll(snapshot);
        return true;
    }

    // Merge logic: union of log entries by id, newest-wins on exercises/plans/
    // measurements. "Newest" for exercises/plans/measurements is approximated
    // by which snapshot is considered more recently synced (remoteIsNewer),
    // since none of those carry a reliable per-record timestamp.
    function mergeSnapshots(local, remote, remoteIsNewer) {
        const historyById = new Map();
        const olderHistory = remoteIsNewer ? local.history : remote.history;
        const newerHistory = remoteIsNewer ? remote.history : local.history;
        (olderHistory || []).forEach(h => historyById.set(h.id, h));
        (newerHistory || []).forEach(h => historyById.set(h.id, h));
        const mergedHistory = Array.from(historyById.values()).sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return (a.id || 0) - (b.id || 0);
        });

        const exByName = new Map();
        const olderEx = remoteIsNewer ? local.exercises : remote.exercises;
        const newerEx = remoteIsNewer ? remote.exercises : local.exercises;
        (olderEx || []).forEach(e => exByName.set(e.name.toLowerCase(), e));
        (newerEx || []).forEach(e => exByName.set(e.name.toLowerCase(), e));
        const mergedExercises = Array.from(exByName.values());

        const plansById = new Map();
        const olderPlans = remoteIsNewer ? local.plans : remote.plans;
        const newerPlans = remoteIsNewer ? remote.plans : local.plans;
        (olderPlans || []).forEach(p => plansById.set(p.id, p));
        (newerPlans || []).forEach(p => plansById.set(p.id, p));
        const mergedPlans = Array.from(plansById.values());

        const measByKey = new Map();
        const olderMeas = remoteIsNewer ? local.measurements : remote.measurements;
        const newerMeas = remoteIsNewer ? remote.measurements : local.measurements;
        (olderMeas || []).forEach(m => measByKey.set(m.key, m));
        (newerMeas || []).forEach(m => measByKey.set(m.key, m));
        const mergedMeasurements = Array.from(measByKey.values());

        const measLogsById = new Map();
        const olderMeasLogs = remoteIsNewer ? local.measurementLogs : remote.measurementLogs;
        const newerMeasLogs = remoteIsNewer ? remote.measurementLogs : local.measurementLogs;
        (olderMeasLogs || []).forEach(l => measLogsById.set(l.id, l));
        (newerMeasLogs || []).forEach(l => measLogsById.set(l.id, l));
        const mergedMeasurementLogs = Array.from(measLogsById.values()).sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return (a.id || 0) - (b.id || 0);
        });

        const totalTimeById = new Map();
        const olderTotalTime = remoteIsNewer ? local.totalTimeLogs : remote.totalTimeLogs;
        const newerTotalTime = remoteIsNewer ? remote.totalTimeLogs : local.totalTimeLogs;
        (olderTotalTime || []).forEach(t => totalTimeById.set(t.id, t));
        (newerTotalTime || []).forEach(t => totalTimeById.set(t.id, t));
        const mergedTotalTimeLogs = Array.from(totalTimeById.values()).sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return (a.id || 0) - (b.id || 0);
        });

        return {
            exercises: mergedExercises,
            history: mergedHistory,
            plans: mergedPlans,
            measurements: mergedMeasurements,
            measurementLogs: mergedMeasurementLogs,
            totalTimeLogs: mergedTotalTimeLogs
        };
    }

    // ============================================================
    // SHARED HELPERS
    // ============================================================

    // Local-date (not UTC) "YYYY-MM-DD" formatter — avoids the day rolling
    // over early/late depending on the user's timezone offset from UTC.
    function getLocalDateString(date) {
        const d = (date instanceof Date) ? date : new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isBloodPressureKey(key) { return key === BLOOD_PRESSURE_KEY; }

    function formatMeasurementValue(log, unit) {
        if (isBloodPressureKey(log.measurementKey) && log.diastolic !== undefined && log.diastolic !== null) {
            return `${log.value}/${log.diastolic}${unit ? ' ' + unit : ''}`;
        }
        return `${log.value}${unit ? ' ' + unit : ''}`;
    }

    // Resolves an exercise definition by name, including the virtual Total
    // Exercise Time entry — use this instead of state.exercises.find(...)
    // anywhere a name might be the virtual one (e.g. legacy history rows
    // mid-migration).
    function findExerciseDef(name) {
        if (name === TOTAL_TIME_EXERCISE_NAME) return TOTAL_TIME_EXERCISE_DEF;
        return state.exercises.find(e => e.name === name);
    }

    function getIntensityColor(value) {
        if (!value || value < 1) return INTENSITY_COLORS["Default"];
        return INTENSITY_COLORS[Math.round(value)] || INTENSITY_COLORS["Default"];
    }

    // ============================================================
    // CRUD: Exercises
    // ============================================================
    function exerciseNameExists(name, excludeIndex = -1) {
        return state.exercises.some((e, i) => i !== excludeIndex && e.name.toLowerCase() === name.toLowerCase());
    }

    function addExercise(ex) {
        state.exercises.push(ex);
        persistAll();
    }

    // Renaming propagates to every history entry and plan referencing the
    // old name, so logged history/schedules never silently detach.
    function updateExerciseAt(index, ex) {
        if (index < 0 || index >= state.exercises.length) return;
        const oldName = state.exercises[index].name;
        state.exercises[index] = ex;
        if (oldName !== ex.name) {
            state.history.forEach(h => { if (h.exerciseName === oldName) h.exerciseName = ex.name; });
            state.plans.forEach(p => { if (p.exercise === oldName) p.exercise = ex.name; });
        }
        persistAll();
    }

    function deleteExercise(name) {
        state.exercises = state.exercises.filter(e => e.name !== name);
        state.history = state.history.filter(h => h.exerciseName !== name);
        state.plans = state.plans.filter(p => p.exercise !== name);
        persistAll();
    }

    function countHistoryForExercise(name) {
        return state.history.filter(h => h.exerciseName === name).length;
    }

    // ============================================================
    // CRUD: Measurements
    // ============================================================

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

    function measurementNameExists(name, excludeKey = null) {
        return state.measurements.some(m => m.key !== excludeKey && m.name.toLowerCase() === name.toLowerCase());
    }

    /** @returns {string} the newly-generated key */
    function addMeasurement(name, unit) {
        const key = slugifyMeasurementName(name);
        state.measurements.push({ key, name, unit });
        persistAll();
        return key;
    }

    function updateMeasurement(key, name, unit) {
        const idx = state.measurements.findIndex(m => m.key === key);
        if (idx === -1) return;
        state.measurements[idx] = { ...state.measurements[idx], name, unit };
        persistAll();
    }

    function deleteMeasurement(key) {
        state.measurements = state.measurements.filter(m => m.key !== key);
        state.measurementLogs = state.measurementLogs.filter(l => l.measurementKey !== key);
        persistAll();
    }

    function countLogsForMeasurement(key) {
        return state.measurementLogs.filter(l => l.measurementKey === key).length;
    }

    // ============================================================
    // CRUD: Plans
    // ============================================================
    function addPlan(plan) {
        state.plans.push(plan);
        persistAll();
    }

    function deletePlan(id) {
        state.plans = state.plans.filter(p => p.id !== id);
        persistAll();
    }

    function reorderPlans(orderedIds) {
        orderedIds.forEach((id, idx) => {
            const p = state.plans.find(x => x.id === id);
            if (p) p.order = idx;
        });
        persistAll();
    }

    function countWeeklyPlansOnDay(dayVal) {
        return state.plans.filter(p => p.type === 'weekly' && p.exercise !== "__rest__" && String(p.day) === String(dayVal)).length;
    }

    // ============================================================
    // CRUD: History (exercise logs)
    // ============================================================
    function sortHistory() {
        state.history.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function addHistoryEntry(entry) {
        state.history.unshift(entry);
        sortHistory();
        persistAll();
    }

    function updateHistoryEntry(id, { date, exerciseName, intensity, data }) {
        const i = state.history.findIndex(h => h.id === id);
        if (i === -1) return;
        state.history[i].date = date;
        state.history[i].exerciseName = exerciseName;
        state.history[i].intensity = intensity;
        state.history[i].data = data;
        sortHistory();
        persistAll();
    }

    function deleteHistoryEntry(id) {
        state.history = state.history.filter(h => h.id !== id);
        persistAll();
    }

    function getHistoryEntry(id) {
        return state.history.find(h => h.id === id) || null;
    }

    // ============================================================
    // CRUD: Measurement logs
    // ============================================================
    function addMeasurementLog(log) {
        state.measurementLogs.unshift(log);
        persistAll();
    }

    function updateMeasurementLog(id, value, date, diastolic) {
        const i = state.measurementLogs.findIndex(l => l.id === id);
        if (i === -1) return;
        state.measurementLogs[i].value = value;
        state.measurementLogs[i].date = date;
        if (diastolic !== undefined) state.measurementLogs[i].diastolic = diastolic;
        else delete state.measurementLogs[i].diastolic;
        persistAll();
    }

    function deleteMeasurementLog(id) {
        state.measurementLogs = state.measurementLogs.filter(l => l.id !== id);
        persistAll();
    }

    function getMeasurementLog(id) {
        return state.measurementLogs.find(l => l.id === id) || null;
    }

    function getMostRecentMeasurementLog(key) {
        return [...state.measurementLogs]
            .filter(l => l.measurementKey === key)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
    }

    // ============================================================
    // CRUD: Total time logs
    // ============================================================
    function sortTotalTimeLogs() {
        state.totalTimeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function addTotalTimeLog(log) {
        state.totalTimeLogs.unshift(log);
        sortTotalTimeLogs();
        persistAll();
    }

    function updateTotalTimeLog(id, date, minutes) {
        const i = state.totalTimeLogs.findIndex(t => t.id === id);
        if (i === -1) return;
        state.totalTimeLogs[i].date = date;
        state.totalTimeLogs[i].minutes = minutes;
        sortTotalTimeLogs();
        persistAll();
    }

    function deleteTotalTimeLog(id) {
        state.totalTimeLogs = state.totalTimeLogs.filter(t => t.id !== id);
        persistAll();
    }

    function getTotalTimeLog(id) {
        return state.totalTimeLogs.find(t => t.id === id) || null;
    }

    // ============================================================
    // QUERIES: scheduling & streaks
    // ============================================================
    function isRestDayExplicitlyScheduled(targetDate) {
        const d = new Date(targetDate);
        d.setHours(0, 0, 0, 0);
        const dayOfWeek = d.getDay();

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

    function getPlannedExercisesForDate(targetDate) {
        let matches = [];
        let queryDate = new Date(targetDate);
        queryDate.setHours(0, 0, 0, 0);

        // 1. Weekly scheduled routines — sorted by the plan's `order` field
        // (drag-reorder) so downstream consumers (7-Day Horizon tags,
        // Today's Exercises card, chart dropdown stars) share one ordering.
        let weeklyMatchesForDay = state.plans.filter(plan =>
            plan.type === 'weekly' && plan.exercise !== "__rest__" && parseInt(plan.day) === queryDate.getDay()
        );
        weeklyMatchesForDay.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
        weeklyMatchesForDay.forEach(plan => matches.push(plan.exercise));

        // 2. Interval-based routines with rest-day adjustments
        state.plans.forEach(plan => {
            if (plan.type === 'interval') {
                let start = new Date(plan.startDate + "T00:00:00");
                start.setHours(0, 0, 0, 0);

                if (queryDate < start) return;

                let workingDate = new Date(start);
                let intervalDayCounter = 0;

                while (workingDate <= queryDate) {
                    let isWorkingRestDay = isRestDayExplicitlyScheduled(workingDate);

                    if (isWorkingRestDay) {
                        if (workingDate.getTime() === queryDate.getTime()) {
                            return; // rest day — nothing scheduled
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

    function calculateStreak() {
        let todayStr = getLocalDateString(new Date());
        let checkDate = new Date(todayStr + "T00:00:00");
        let streak = 0;

        let historyDates = new Set(state.history.map(h => h.date));

        let yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        let yesterdayStr = getLocalDateString(yesterday);

        if (!historyDates.has(todayStr) && !historyDates.has(yesterdayStr)) {
            let yesterdayPlan = getPlannedExercisesForDate(yesterday);
            let yesterdayWasRest = (yesterdayPlan.length === 0 || isRestDayExplicitlyScheduled(yesterday));
            if (!yesterdayWasRest) return 0;
        }

        for (let i = 0; i < 365; i++) {
            let loopDateStr = getLocalDateString(checkDate);
            let isExplicitRest = isRestDayExplicitlyScheduled(new Date(checkDate));

            if (historyDates.has(loopDateStr) || isExplicitRest) {
                streak++;
            } else {
                if (i === 0 && loopDateStr === todayStr) {
                    // today hasn't been logged yet, but the day isn't over — don't break yet
                } else {
                    break;
                }
            }
            checkDate.setDate(checkDate.getDate() - 1);
        }
        return streak;
    }

    // ============================================================
    // QUERIES: exercise history lookups
    // ============================================================

    // Finds the entry for a given exercise whose `date` is chronologically
    // most recent — compares actual date values, not array/insertion order
    // (backfilled/imported entries can break that assumption).
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

    // Compact "prev setpoint" string for an exercise, e.g.
    // "3 sets × 10 reps × @135lbs", built from whichever metrics that
    // exercise tracks, using its most recent logged entry.
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

    // ============================================================
    // CHART AGGREGATION (pure)
    // ============================================================

    // Returns a stable bucket key + a representative "anchor" date (used for
    // chart x-axis labels and chronological sorting) for a given YYYY-MM-DD
    // date string and granularity.
    function getPeriodBucket(dateStr, granularity) {
        if (granularity === "daily") {
            return { key: dateStr, anchorDate: dateStr };
        }

        const d = new Date(dateStr + "T00:00:00");

        if (granularity === "weekly") {
            const dayOfWeek = d.getDay();
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

    // Generic aggregator: groups `entries` into period buckets by
    // `dateField`, averages every key returned by `numericFieldsFn`, and
    // returns buckets sorted chronologically, capped to the most recent
    // MAX_CHART_POINTS.
    function aggregateByPeriod(entries, granularity, dateField, numericFieldsFn, extraFieldsFn) {
        const buckets = new Map();

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

    // ============================================================
    // COMPUTED VIEW DATA
    // Plain numbers/strings/arrays — app.js just paints these. This is the
    // layer that would become a SwiftUI ViewModel's @Published computed
    // properties.
    // ============================================================
    function computeTrackKpis() {
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const recentEntries = state.history.filter(h => new Date(h.date + "T00:00:00") >= sevenDaysAgo);
        const weekCount = recentEntries.length;

        const ratedRecent = recentEntries.filter(h => h.intensity && h.intensity > 0);
        const avgIntensity = ratedRecent.length > 0
            ? (ratedRecent.reduce((sum, h) => sum + h.intensity, 0) / ratedRecent.length)
            : null;

        const weightLogs = state.measurementLogs.filter(l => l.measurementKey === "weight");
        const latestWeight = weightLogs.length > 0
            ? [...weightLogs].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
            : null;
        let weightText = "—";
        if (latestWeight) {
            const m = state.measurements.find(x => x.key === "weight");
            weightText = `${latestWeight.value}${m ? m.unit : ''}`;
        }

        return { weekCount, avgIntensity, weightText };
    }

    function computeStatsKpis() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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

        const loggedDateSet = new Set(state.history.map(h => h.date));
        const streakDots = dayBuckets.map(dateStr => loggedDateSet.has(dateStr));

        const weightLogsSorted = [...state.measurementLogs]
            .filter(l => l.measurementKey === "weight")
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const weightMeas = state.measurements.find(m => m.key === "weight");
        const latestW = weightLogsSorted[weightLogsSorted.length - 1];
        const weightText = latestW ? `${latestW.value}${weightMeas ? weightMeas.unit : ''}` : "—";

        const twoWeeksAgo = new Date(today);
        twoWeeksAgo.setDate(today.getDate() - 14);
        const recentWeights = weightLogsSorted
            .filter(l => new Date(l.date + "T00:00:00") >= twoWeeksAgo)
            .map(l => l.value);

        const workoutCountByDay = dayBuckets.map(dateStr => state.history.filter(h => h.date === dateStr).length);
        const workoutsThisWeek = workoutCountByDay.reduce((a, b) => a + b, 0);

        return {
            dayBuckets, intensityByDay, avgIntensity7d, streakDots,
            weightText, recentWeights, workoutCountByDay, workoutsThisWeek
        };
    }

    function computeProgressOverview() {
        const rows = [];

        rows.push({ label: "Total Workouts Logged", value: state.history.length });

        if (state.history.length > 0) {
            const counts = {};
            state.history.forEach(h => { counts[h.exerciseName] = (counts[h.exerciseName] || 0) + 1; });
            const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            rows.push({ label: "Most Logged Exercise", value: `${top[0]} (${top[1]}x)` });
        }

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

        rows.push({ label: "Current Streak", value: `${calculateStreak()} days` });

        return rows;
    }

    // ============================================================
    // EXPORT: CSV content (pure string — app.js handles the file save)
    // ============================================================
    function buildCsvContent() {
        const hasHistory = state.history.length > 0;
        const hasTotalTime = state.totalTimeLogs.length > 0;
        if (!hasHistory && !hasTotalTime) return null;

        const allMetricKeys = new Set();
        state.history.forEach(entry => {
            if (entry.data) Object.keys(entry.data).forEach(key => allMetricKeys.add(key));
        });
        if (hasTotalTime) allMetricKeys.add("timeMinutes");
        const metricKeysArray = Array.from(allMetricKeys).sort();

        const baseHeaders = ["ID", "Date", "Exercise Name", "Intensity"];
        const fullHeaders = [...baseHeaders, ...metricKeysArray];

        const quote = (val) => `"${String(val).replace(/"/g, '""')}"`;

        const csvRows = [];
        csvRows.push(fullHeaders.map(quote).join(","));

        state.history.forEach(entry => {
            const rowData = [entry.id, entry.date, entry.exerciseName, entry.intensity || ""];
            metricKeysArray.forEach(key => {
                rowData.push(entry.data && entry.data[key] !== undefined ? entry.data[key] : "");
            });
            csvRows.push(rowData.map(quote).join(","));
        });

        // Total Time is its own record category, but the CSV export stays a
        // single flat timeline — appended here under the same label it's
        // always shown with.
        state.totalTimeLogs.forEach(entry => {
            const rowData = [entry.id, entry.date, TOTAL_TIME_EXERCISE_NAME, ""];
            metricKeysArray.forEach(key => {
                rowData.push(key === "timeMinutes" ? entry.minutes : "");
            });
            csvRows.push(rowData.map(quote).join(","));
        });

        return "\uFEFF" + csvRows.join("\n");
    }

    // ============================================================
    // PUBLIC API
    // ============================================================
    return {
        // state + lifecycle
        state,
        onChange,
        load,
        replaceAll,

        // constants a Swift port should mirror verbatim
        DEFAULT_EXERCISES,
        DEFAULT_MEASUREMENTS,
        BLOOD_PRESSURE_KEY,
        TOTAL_TIME_EXERCISE_NAME,
        TOTAL_TIME_EXERCISE_DEF,
        FIELD_LABELS,
        INTENSITY_COLORS,

        // snapshot (cloud backup / JSON export)
        getSnapshot,
        applySnapshot,
        mergeSnapshots,

        // shared helpers
        getLocalDateString,
        isBloodPressureKey,
        formatMeasurementValue,
        findExerciseDef,
        getIntensityColor,

        // CRUD: exercises
        exerciseNameExists,
        addExercise,
        updateExerciseAt,
        deleteExercise,
        countHistoryForExercise,

        // CRUD: measurements
        slugifyMeasurementName,
        measurementNameExists,
        addMeasurement,
        updateMeasurement,
        deleteMeasurement,
        countLogsForMeasurement,

        // CRUD: plans
        addPlan,
        deletePlan,
        reorderPlans,
        countWeeklyPlansOnDay,

        // CRUD: history
        addHistoryEntry,
        updateHistoryEntry,
        deleteHistoryEntry,
        getHistoryEntry,

        // CRUD: measurement logs
        addMeasurementLog,
        updateMeasurementLog,
        deleteMeasurementLog,
        getMeasurementLog,
        getMostRecentMeasurementLog,

        // CRUD: total time logs
        addTotalTimeLog,
        updateTotalTimeLog,
        deleteTotalTimeLog,
        getTotalTimeLog,

        // queries: scheduling & streaks
        isRestDayExplicitlyScheduled,
        getPlannedExercisesForDate,
        calculateStreak,

        // queries: exercise history lookups
        getMostRecentEntryForExercise,
        getPreviousEntry,
        getMostRecentIntensityForExercise,
        formatPrevSetpoint,

        // chart aggregation
        getPeriodBucket,
        aggregateByPeriod,
        formatPeriodLabel,

        // computed view data
        computeTrackKpis,
        computeStatsKpis,
        computeProgressOverview,

        // export
        buildCsvContent
    };
})();
