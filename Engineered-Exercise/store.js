// =============================================================================
// Engineered Exercise — store.js (BACKEND)
// =============================================================================
// Temporarily consolidated for fewer files during active development.
// Internally this is still the same modular structure — each section below
// keeps its own banner header and is a drop-in-ready standalone file for
// when we split back out ahead of the Xcode/Swift port. Sections, in order:
//   Models -> DateUtil -> PersistenceService -> MigrationService ->
//   SchedulingService -> StatsService -> FormattingService ->
//   BackupService -> Store
// Search for "// Engineered Exercise —" to jump between sections.
// =============================================================================

// =============================================================================
// Engineered Exercise — Models
// =============================================================================
// Pure data shapes and constants only. No logic, no DOM, no localStorage.
// This is the file with the most direct 1:1 mapping to a Swift port: every
// @typedef below becomes a `Codable struct`, and every constant becomes a
// `static let` on the corresponding type (or a top-level enum of constants).
//
// Porting guide:
//   Exercise            -> struct Exercise: Codable, Identifiable
//   HistoryEntry         -> struct HistoryEntry: Codable, Identifiable
//   Measurement           -> struct Measurement: Codable, Identifiable
//   MeasurementLog         -> struct MeasurementLog: Codable, Identifiable
//   TotalTimeLog             -> struct TotalTimeLog: Codable, Identifiable
//   Plan                       -> struct Plan: Codable, Identifiable
//   AppData                      -> struct AppData: Codable  (the backup payload)
//   FIELD_LABELS                   -> enum ExerciseMetric: String, CaseIterable
//   INTENSITY_COLORS                 -> extension Int { var color: Color }
// =============================================================================

const Models = (() => {
    "use strict";

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
     * what getSnapshot()/JSON export carry (inside a versioned envelope —
     * see BackupService). Never includes any transient UI-only field.
     * @property {Exercise[]} exercises
     * @property {HistoryEntry[]} history
     * @property {Plan[]} plans
     * @property {Measurement[]} measurements
     * @property {MeasurementLog[]} measurementLogs
     * @property {TotalTimeLog[]} totalTimeLogs
     */

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
    // show for any legacy data a migration hasn't touched yet.
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

    // Blue-red diverging scale: level 1 (lightest) is blue, level 5
    // (heaviest) is red, interpolated through violet/fuchsia/pink rather
    // than through green — i.e. hue travels the "long way" around from
    // blue to red so it never passes through green or yellow-orange.
    // "Default" (no intensity logged) is a neutral grey, kept distinct from
    // level 1's blue so "rated 1★" and "unrated" never look the same.
    const INTENSITY_COLORS = {
        1: "#2563eb",
        2: "#7c3aed",
        3: "#c026d3",
        4: "#db2777",
        5: "#dc2626",
        "Default": "#4b5563"
    };

    const MAX_CHART_POINTS = 50;
    const SETPOINT_FORMAT_ORDER = ["sets", "reps", "weight", "distance", "timeMinutes", "timeSeconds"];

    // How long to wait after the last successful JSON export before nagging
    // the person to do another one. A Swift port should mirror this exact
    // threshold so behavior stays identical across platforms.
    const BACKUP_REMINDER_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

    // Envelope version for JSON backup files (BackupService). Bump whenever
    // the *shape* of the exported envelope changes — independent of the
    // internal state migrations in MigrationService, which handle changes
    // to the shape of individual records instead.
    const BACKUP_SCHEMA_VERSION = 2;

    return {
        DEFAULT_EXERCISES,
        DEFAULT_MEASUREMENTS,
        BLOOD_PRESSURE_KEY,
        TOTAL_TIME_EXERCISE_NAME,
        TOTAL_TIME_EXERCISE_DEF,
        FIELD_LABELS,
        INTENSITY_COLORS,
        MAX_CHART_POINTS,
        SETPOINT_FORMAT_ORDER,
        BACKUP_REMINDER_MS,
        BACKUP_SCHEMA_VERSION
    };
})();
// =============================================================================
// Engineered Exercise — Date helpers
// =============================================================================
// Porting guide: -> a `Date` extension with a `localDateString` computed
// property using a cached DateFormatter (yyyy-MM-dd, current locale/timezone).
// =============================================================================

const DateUtil = (() => {
    "use strict";

    // Local-date (not UTC) "YYYY-MM-DD" formatter — avoids the day rolling
    // over early/late depending on the user's timezone offset from UTC.
    function getLocalDateString(date) {
        const d = (date instanceof Date) ? date : new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return { getLocalDateString };
})();
// =============================================================================
// Engineered Exercise — PersistenceService
// =============================================================================
// The ONLY file that touches a platform storage API (localStorage here).
// Everything else in the app reads/writes through this module. That
// isolation is deliberate: it's the one seam a native port would replace
// (e.g. with UserDefaults or a JSON file via FileManager) without touching
// anything else.
//
// Porting guide: -> a small `PersistenceServiceProtocol` with get/set,
// backed by UserDefaults for the small scalar keys and a JSON file (or
// SwiftData/Core Data) for the six main collections.
// =============================================================================

const PersistenceService = (() => {
    "use strict";

    const LS_KEYS = {
        exercises: "ee_exercises",
        history: "ee_history",
        plans: "ee_plans",
        measurements: "ee_measurements",
        measurementLogs: "ee_measurement_logs",
        totalTimeLogs: "ee_total_time_logs",
        // App-level metadata — tracks app usage rather than user data, so it
        // deliberately never travels inside a JSON backup.
        lastJsonExportAt: "ee_last_json_export_at",
        firstLaunchAt: "ee_first_launch_at"
    };

    function get(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn("PersistenceService: failed to read", key, e);
            return null;
        }
    }

    function set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn("PersistenceService: failed to write", key, e);
        }
    }

    // Records the first time this app ever ran on this device — used as the
    // backup-reminder anchor for people who've never exported a JSON backup,
    // so a brand-new install isn't nagged on day one. Idempotent.
    function ensureFirstLaunchRecorded() {
        if (!get(LS_KEYS.firstLaunchAt)) {
            set(LS_KEYS.firstLaunchAt, new Date().toISOString());
        }
    }

    return {
        LS_KEYS,
        get,
        set,
        ensureFirstLaunchRecorded
    };
})();
// =============================================================================
// Engineered Exercise — MigrationService
// =============================================================================
// Idempotent, in-place migrations of already-loaded state. Safe to run on
// every app launch and after every import — each migration checks whether
// its condition still applies before doing anything. This is the file that
// changes shape most often as the app evolves; it's kept separate from
// AppStore so a Swift port can drop in a `MigrationService.run(on:)` step
// right after decoding, without touching the store itself.
//
// Porting guide: -> a `MigrationService` enum/struct with one static method
// per migration, each taking `inout AppData` (or the ObservableObject) and
// returning whether it changed anything.
// =============================================================================

const MigrationService = (() => {
    "use strict";

    function migrateIntensityData(state) {
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
    function migrateTotalTimeEntries(state) {
        const embedded = state.history.filter(h => h.exerciseName === Models.TOTAL_TIME_EXERCISE_NAME);
        if (embedded.length === 0) return false;

        embedded.forEach(entry => {
            state.totalTimeLogs.push({
                id: entry.id,
                date: entry.date,
                minutes: (entry.data && entry.data.timeMinutes) || 0
            });
        });
        state.history = state.history.filter(h => h.exerciseName !== Models.TOTAL_TIME_EXERCISE_NAME);
        state.totalTimeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
        return true;
    }

    // Runs every registered migration, in order, against already-loaded
    // state. Returns true if anything changed (callers use this to decide
    // whether a fresh persist is needed).
    function runAll(state) {
        const a = migrateIntensityData(state);
        const b = migrateTotalTimeEntries(state);
        return a || b;
    }

    return {
        migrateIntensityData,
        migrateTotalTimeEntries,
        runAll
    };
})();
// =============================================================================
// Engineered Exercise — SchedulingService
// =============================================================================
// Pure query functions over Plan[] + HistoryEntry[]: "what's scheduled on
// this date", "is this an explicit rest day", "what's the current streak".
// No mutation, no persistence — every function here takes state as a plain
// argument, which is exactly the shape a Swift `SchedulingService` would
// take (a struct/enum of static methods over an `AppData` value).
// =============================================================================

const SchedulingService = (() => {
    "use strict";

    const getLocalDateString = DateUtil.getLocalDateString;

    function isRestDayExplicitlyScheduled(state, targetDate) {
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

    function getPlannedExercisesForDate(state, targetDate) {
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
                    let isWorkingRestDay = isRestDayExplicitlyScheduled(state, workingDate);

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

    function calculateStreak(state) {
        let todayStr = getLocalDateString(new Date());
        let checkDate = new Date(todayStr + "T00:00:00");
        let streak = 0;

        let historyDates = new Set(state.history.map(h => h.date));

        let yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        let yesterdayStr = getLocalDateString(yesterday);

        if (!historyDates.has(todayStr) && !historyDates.has(yesterdayStr)) {
            let yesterdayPlan = getPlannedExercisesForDate(state, yesterday);
            let yesterdayWasRest = (yesterdayPlan.length === 0 || isRestDayExplicitlyScheduled(state, yesterday));
            if (!yesterdayWasRest) return 0;
        }

        for (let i = 0; i < 365; i++) {
            let loopDateStr = getLocalDateString(checkDate);
            let isExplicitRest = isRestDayExplicitlyScheduled(state, new Date(checkDate));

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

    return {
        isRestDayExplicitlyScheduled,
        getPlannedExercisesForDate,
        calculateStreak
    };
})();
// =============================================================================
// Engineered Exercise — StatsService
// =============================================================================
// Pure aggregation/computation over state: chart bucketing, KPI numbers,
// the Progress Overview rows, and the small "most recent entry" lookups
// that both Stats and the Track tab's "Today's Exercises" card rely on.
// Nothing here touches the DOM — every function returns plain
// numbers/strings/arrays that a view layer (JS today, SwiftUI later) just
// paints. This is the file that would become a SwiftUI ViewModel's
// @Published computed properties / a StatsService struct.
// =============================================================================

const StatsService = (() => {
    "use strict";

    const getLocalDateString = DateUtil.getLocalDateString;

    // ============================================================
    // Exercise history lookups
    // ============================================================

    // Finds the entry for a given exercise whose `date` is chronologically
    // most recent — compares actual date values, not array/insertion order
    // (backfilled/imported entries can break that assumption).
    function getMostRecentEntryForExercise(state, exerciseName, requireIntensity = false) {
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

    function getPreviousEntry(state, exerciseName) {
        return getMostRecentEntryForExercise(state, exerciseName, false);
    }

    function getMostRecentIntensityForExercise(state, exerciseName) {
        const entry = getMostRecentEntryForExercise(state, exerciseName, true);
        return entry ? entry.intensity : null;
    }

    // Compact "prev setpoint" string for an exercise, e.g.
    // "3 sets × 10 reps × @135lbs", built from whichever metrics that
    // exercise tracks, using its most recent logged entry.
    function formatPrevSetpoint(state, exerciseName) {
        const entry = getPreviousEntry(state, exerciseName);
        if (!entry || !entry.data) return "";

        const parts = [];
        Models.SETPOINT_FORMAT_ORDER.forEach(key => {
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
    // Chart aggregation (pure)
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

        if (result.length > Models.MAX_CHART_POINTS) {
            result = result.slice(result.length - Models.MAX_CHART_POINTS);
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
    // Computed view data (KPIs, progress overview)
    // ============================================================
    function computeTrackKpis(state) {
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

    // Avg Intensity (7d) and Weight cards are explicitly unchanged by the
    // Stats-tab scope selector — always a fixed 7-day window, same as
    // before. The old streak-dots/workouts-bars fields that used to live
    // here were replaced by the scope-aware functions below.
    function computeStatsKpis(state) {
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

        return { intensityByDay, avgIntensity7d, weightText, recentWeights };
    }

    // ============================================================
    // Stats-tab scope selector (7d / 30d / 90d / all) — everything below
    // is scoped to whichever window the person has selected, independent
    // of the Avg Intensity/Weight cards above and independent of the
    // chart granularity (daily/weekly/monthly) that governs the charts
    // further down the tab. "Scope" and "granularity" are deliberately
    // orthogonal controls.
    // ============================================================

    // A day counts as "logged" if it has an exercise entry OR a Total Time
    // entry — either represents an actual workout that day.
    function getLoggedDateSet(state) {
        const set = new Set();
        state.history.forEach(h => set.add(h.date));
        state.totalTimeLogs.forEach(t => set.add(t.date));
        return set;
    }

    // Earliest date the person ever logged anything, or null if they never have.
    function getFirstLoggedDate(state) {
        let earliest = null;
        const consider = (dateStr) => {
            const d = new Date(dateStr + "T00:00:00");
            if (!earliest || d < earliest) earliest = d;
        };
        state.history.forEach(h => consider(h.date));
        state.totalTimeLogs.forEach(t => consider(t.date));
        return earliest;
    }

    // Lower bound implied by the scope selector alone, or null for "all"
    // (no lower bound beyond the person's own history).
    function getScopeStartDate(scope, today) {
        const d = new Date(today);
        d.setHours(0, 0, 0, 0);
        if (scope === '30d') { d.setDate(d.getDate() - 29); return d; }
        if (scope === '90d') { d.setDate(d.getDate() - 89); return d; }
        if (scope === 'all') return null;
        d.setDate(d.getDate() - 6); // default / '7d'
        return d;
    }

    // The actual start of the scoped window: the later of the scope's own
    // start date and the person's first-ever log — so "30 days" for someone
    // who started 10 days ago covers exactly those 10 days, not a padded
    // window of empty history, and "All Time" always starts at their first log.
    function getEffectiveScopeStart(state, scope, today) {
        const firstLogged = getFirstLoggedDate(state);
        if (!firstLogged) return null; // no data at all yet
        const scopeStart = getScopeStartDate(scope, today);
        if (!scopeStart) return firstLogged;
        return scopeStart > firstLogged ? scopeStart : firstLogged;
    }

    // Day-by-day status across the scoped window — the shared data source
    // for both the Visual Streak card (rendered as circles) and the Days
    // Logged ratio. 'logged' > 'rest' > 'missed'; today is included and,
    // if not yet logged, reads as 'missed' until it is.
    function computeDayStatuses(state, scope) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = getEffectiveScopeStart(state, scope, today);
        if (!start) return [];

        const loggedSet = getLoggedDateSet(state);
        const statuses = [];
        let cursor = new Date(start);
        while (cursor <= today) {
            const dateStr = getLocalDateString(cursor);
            let status;
            if (loggedSet.has(dateStr)) status = 'logged';
            else if (SchedulingService.isRestDayExplicitlyScheduled(state, cursor)) status = 'rest';
            else status = 'missed';
            statuses.push({ date: dateStr, status });
            cursor.setDate(cursor.getDate() + 1);
        }
        return statuses;
    }

    // "daysLogged / totalDaysInScopeSinceFirstLog", plus percent. Explicit
    // rest days count toward the numerator here — they're a deliberate part
    // of the plan, not a gap — even though the Streak card's heatmap still
    // shows them in a visually distinct color (grey) since that's a
    // different concern (pattern recognition, not adherence rate).
    function computeDaysLoggedRatio(state, scope) {
        const statuses = computeDayStatuses(state, scope);
        if (statuses.length === 0) return { logged: 0, total: 0, percent: null };
        const logged = statuses.filter(s => s.status === 'logged' || s.status === 'rest').length;
        const total = statuses.length;
        return { logged, total, percent: Math.round((logged / total) * 100) };
    }

    // Longest-ever run of consecutive days where each day is either logged
    // or an explicit rest day — same "what counts as unbroken" rule as
    // calculateStreak, just scanning the whole history instead of stopping
    // at the first break. Not scope-limited: "longest" is inherently all-time.
    function calculateLongestStreak(state) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const firstLogged = getFirstLoggedDate(state);
        if (!firstLogged) return 0;

        const loggedSet = getLoggedDateSet(state);
        const todayStr = getLocalDateString(today);
        let longest = 0, current = 0;
        let cursor = new Date(firstLogged);
        while (cursor <= today) {
            const dateStr = getLocalDateString(cursor);
            const counts = loggedSet.has(dateStr) || SchedulingService.isRestDayExplicitlyScheduled(state, cursor);
            if (counts) {
                current++;
                if (current > longest) longest = current;
            } else if (dateStr !== todayStr) {
                // Today not being logged yet doesn't break the streak — the
                // day isn't over. Any earlier gap does.
                current = 0;
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        return longest;
    }

    // Per-day average intensity across the scoped window — same effective
    // day range as computeDayStatuses, so the Avg Intensity card's heatmap
    // lines up with the Streak card's heatmap when both are showing. A day
    // with no rated entries gets avgIntensity 0 (rendered as a neutral
    // color, not "1 star").
    function computeIntensityHeatmap(state, scope) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = getEffectiveScopeStart(state, scope, today);
        if (!start) return [];

        const cells = [];
        let cursor = new Date(start);
        while (cursor <= today) {
            const dateStr = getLocalDateString(cursor);
            const entries = state.history.filter(h => h.date === dateStr && h.intensity && h.intensity > 0);
            const avgIntensity = entries.length > 0
                ? entries.reduce((sum, h) => sum + h.intensity, 0) / entries.length
                : 0;
            cells.push({ date: dateStr, avgIntensity });
            cursor.setDate(cursor.getDate() + 1);
        }
        return cells;
    }

    // Mean of each in-scope day's average intensity (only days with a
    // rating count) — the scope-aware counterpart to computeStatsKpis'
    // fixed 7-day avgIntensity7d, used once the scope is anything other
    // than "7d" so the displayed number always matches the selected scope.
    function computeAvgIntensityInScope(intensityHeatmapCells) {
        const rated = intensityHeatmapCells.filter(c => c.avgIntensity > 0).map(c => c.avgIntensity);
        if (rated.length === 0) return null;
        return rated.reduce((a, b) => a + b, 0) / rated.length;
    }

    // Everything the Stats tab's scope-aware section needs, bundled in one
    // call: the Streak circles, Avg Intensity heatmap + scope-matched
    // average, Days Logged ratio, and current vs longest streak.
    function computeStatsDashboard(state, scope) {
        const dayStatuses = computeDayStatuses(state, scope);
        const intensityHeatmap = computeIntensityHeatmap(state, scope);
        const daysLoggedRatio = computeDaysLoggedRatio(state, scope);
        const currentStreak = SchedulingService.calculateStreak(state);
        const longestStreak = calculateLongestStreak(state);

        return {
            dayStatuses,
            intensityHeatmap,
            avgIntensityInScope: computeAvgIntensityInScope(intensityHeatmap),
            daysLoggedRatio,
            currentStreak,
            longestStreak
        };
    }

    function computeProgressOverview(state) {
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

        rows.push({ label: "Current Streak", value: `${SchedulingService.calculateStreak(state)} days` });

        return rows;
    }

    return {
        getMostRecentEntryForExercise,
        getPreviousEntry,
        getMostRecentIntensityForExercise,
        formatPrevSetpoint,
        getPeriodBucket,
        aggregateByPeriod,
        formatPeriodLabel,
        computeTrackKpis,
        computeStatsKpis,
        computeProgressOverview,
        getLoggedDateSet,
        getFirstLoggedDate,
        getScopeStartDate,
        getEffectiveScopeStart,
        computeDayStatuses,
        computeIntensityHeatmap,
        computeAvgIntensityInScope,
        computeDaysLoggedRatio,
        calculateLongestStreak,
        computeStatsDashboard
    };
})();
// =============================================================================
// Engineered Exercise — FormattingService
// =============================================================================
// Small pure display-formatting helpers shared by several views. Kept
// separate from StatsService because these aren't computations over the
// whole dataset — they're per-record formatting rules a Swift port would
// most likely express as computed properties on the model types themselves
// (e.g. `HistoryEntry.intensityColor`, `MeasurementLog.formattedValue`).
// =============================================================================

const FormattingService = (() => {
    "use strict";

    function isBloodPressureKey(key) {
        return key === Models.BLOOD_PRESSURE_KEY;
    }

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
    function findExerciseDef(state, name) {
        if (name === Models.TOTAL_TIME_EXERCISE_NAME) return Models.TOTAL_TIME_EXERCISE_DEF;
        return state.exercises.find(e => e.name === name);
    }

    function getIntensityColor(value) {
        if (!value || value < 1) return Models.INTENSITY_COLORS["Default"];
        return Models.INTENSITY_COLORS[Math.round(value)] || Models.INTENSITY_COLORS["Default"];
    }

    // Slug-ify a display name into a stable storage key, ensuring uniqueness
    // against existing measurement keys (appends -2, -3, ... on collision).
    function slugifyMeasurementName(state, name, excludeKey = null) {
        let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "measurement";
        let candidate = base;
        let n = 2;
        while (state.measurements.some(m => m.key === candidate && m.key !== excludeKey)) {
            candidate = `${base}-${n}`;
            n++;
        }
        return candidate;
    }

    return {
        isBloodPressureKey,
        formatMeasurementValue,
        findExerciseDef,
        getIntensityColor,
        slugifyMeasurementName
    };
})();
// =============================================================================
// Engineered Exercise — BackupService
// =============================================================================
// Owns the shape of data leaving/entering the app: the JSON backup envelope
// and the CSV history export. There is no automatic/cloud backup in this
// app — Export CSV and Export Backup (JSON) are the only ways data ever
// leaves the device, so this file is also home to the "time to back up"
// reminder timing logic.
//
// JSON BACKUP ENVELOPE (schemaVersion 2+):
//   { schemaVersion: 2, exportedAt: "<ISO8601>", data: <AppData> }
// Versions prior to this file existing shipped the raw AppData object with
// no envelope at all (implicitly "schemaVersion 1"). `parseBackupFile`
// detects and upgrades those transparently on import — see
// `migrateEnvelope`. Bump BACKUP_SCHEMA_VERSION (models.js) whenever the
// *envelope* shape changes; changes to individual record shapes belong in
// MigrationService instead, since those apply to state already in
// localStorage too, not just imported files.
//
// Porting guide: -> a `BackupEnvelope: Codable` struct with a
// `schemaVersion: Int`, `exportedAt: Date`, and `data: AppData`, decoded
// with a version-aware `JSONDecoder` strategy mirroring `migrateEnvelope`.
// =============================================================================

const BackupService = (() => {
    "use strict";

    const LS_KEYS = PersistenceService.LS_KEYS;

    // ============================================================
    // Snapshot (plain AppData, no envelope)
    // ============================================================
    function getSnapshot(state) {
        return {
            exercises: state.exercises,
            history: state.history,
            plans: state.plans,
            measurements: state.measurements,
            measurementLogs: state.measurementLogs,
            totalTimeLogs: state.totalTimeLogs
        };
    }

    // ============================================================
    // Export: JSON backup envelope
    // ============================================================
    function buildBackupEnvelope(state) {
        return {
            schemaVersion: Models.BACKUP_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            data: getSnapshot(state)
        };
    }

    // ============================================================
    // Import: parse + migrate any backup file (current or legacy shape)
    // into { schemaVersion, data } at the CURRENT schema version.
    // Returns null if the file doesn't look like a valid backup at all.
    // ============================================================
    function looksLikeAppData(obj) {
        return !!obj && Array.isArray(obj.exercises) && Array.isArray(obj.history);
    }

    function migrateEnvelope(envelope) {
        // Nothing to do yet beyond wrapping — schemaVersion 1 -> 2 was
        // purely "add the envelope", the inner AppData shape didn't change.
        // Future envelope migrations get an `if (envelope.schemaVersion < N)`
        // step added here, each one bumping schemaVersion as it goes.
        return envelope;
    }

    function parseBackupFile(rawText) {
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            return { ok: false, error: "not-json" };
        }

        let envelope;
        if (parsed && typeof parsed.schemaVersion === "number" && looksLikeAppData(parsed.data)) {
            // Current (or future) envelope shape.
            envelope = parsed;
        } else if (looksLikeAppData(parsed)) {
            // Legacy schemaVersion-1 file: the raw AppData object itself,
            // no envelope. Wrap it so downstream code only ever deals with
            // one shape.
            envelope = { schemaVersion: 1, exportedAt: null, data: parsed };
        } else {
            return { ok: false, error: "not-a-backup" };
        }

        envelope = migrateEnvelope(envelope);
        return { ok: true, envelope };
    }

    // ============================================================
    // Export: CSV content (pure string — the view layer handles the file save)
    // ============================================================
    function buildCsvContent(state) {
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
            const rowData = [entry.id, entry.date, Models.TOTAL_TIME_EXERCISE_NAME, ""];
            metricKeysArray.forEach(key => {
                rowData.push(key === "timeMinutes" ? entry.minutes : "");
            });
            csvRows.push(rowData.map(quote).join(","));
        });

        return "\uFEFF" + csvRows.join("\n");
    }

    // ============================================================
    // Backup reminder timing
    // ============================================================
    function markJsonExported() {
        PersistenceService.set(LS_KEYS.lastJsonExportAt, new Date().toISOString());
    }

    function getLastJsonExportAt() {
        return PersistenceService.get(LS_KEYS.lastJsonExportAt);
    }

    function isBackupReminderDue() {
        // Anchor on the last export; if there's never been one, fall back to
        // first-launch date so a brand-new install isn't nagged immediately.
        const anchor = getLastJsonExportAt() || PersistenceService.get(LS_KEYS.firstLaunchAt);
        if (!anchor) return false;
        const anchorMs = new Date(anchor).getTime();
        if (!Number.isFinite(anchorMs)) return false;
        return (Date.now() - anchorMs) >= Models.BACKUP_REMINDER_MS;
    }

    return {
        getSnapshot,
        buildBackupEnvelope,
        parseBackupFile,
        buildCsvContent,
        markJsonExported,
        getLastJsonExportAt,
        isBackupReminderDue
    };
})();
// =============================================================================
// Engineered Exercise — Store (the "backend")
// =============================================================================
// Owns the one persisted state object and every mutation of it. Business
// logic that doesn't need to *own* state (scheduling math, chart
// aggregation, formatting, backup shape) lives in the services this file
// composes — Store itself is deliberately thin: load state, expose CRUD,
// persist, notify. That split is what makes the services portable almost
// verbatim to Swift while Store maps to a single `AppStore: ObservableObject`.
//
// Porting guide (JS -> Swift):
//   `state` (one object, 6 arrays)  -> an ObservableObject with @Published arrays
//   PersistenceService.get/set      -> a small protocol (UserDefaults or file-backed)
//   MigrationService.runAll         -> called once right after decoding, same as here
//   Every exported function here    -> a method on that ObservableObject
//   `onChange(fn)`                  -> @Published already gives you this for free
//   Nothing in this file depends on execution order beyond `Store.load()`
//   being called once before anything else runs.
//
// Views hold `state` by reference and never reassign it — only Store
// mutates it, always through the methods below, always followed by
// persistAll(). That's what keeps the UI and storage in sync without a
// heavier framework.
// =============================================================================

const Store = (() => {
    "use strict";

    const LS_KEYS = PersistenceService.LS_KEYS;

    /** @type {import('../models/models.js').AppData} */
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
        PersistenceService.set(LS_KEYS.exercises, state.exercises);
        PersistenceService.set(LS_KEYS.history, state.history);
        PersistenceService.set(LS_KEYS.plans, state.plans);
        PersistenceService.set(LS_KEYS.measurements, state.measurements);
        PersistenceService.set(LS_KEYS.measurementLogs, state.measurementLogs);
        PersistenceService.set(LS_KEYS.totalTimeLogs, state.totalTimeLogs);
        notify();
    }

    // ============================================================
    // LOAD / REPLACE
    // ============================================================
    function load() {
        state.exercises = PersistenceService.get(LS_KEYS.exercises) || Models.DEFAULT_EXERCISES.slice();
        state.history = PersistenceService.get(LS_KEYS.history) || [];
        state.plans = PersistenceService.get(LS_KEYS.plans) || [];
        state.measurements = PersistenceService.get(LS_KEYS.measurements) || Models.DEFAULT_MEASUREMENTS.slice();
        state.measurementLogs = PersistenceService.get(LS_KEYS.measurementLogs) || [];
        state.totalTimeLogs = PersistenceService.get(LS_KEYS.totalTimeLogs) || [];

        if (!Array.isArray(state.exercises) || state.exercises.length === 0) state.exercises = Models.DEFAULT_EXERCISES.slice();
        if (!Array.isArray(state.history)) state.history = [];
        if (!Array.isArray(state.plans)) state.plans = [];
        if (!Array.isArray(state.measurements) || state.measurements.length === 0) state.measurements = Models.DEFAULT_MEASUREMENTS.slice();
        if (!Array.isArray(state.measurementLogs)) state.measurementLogs = [];
        if (!Array.isArray(state.totalTimeLogs)) state.totalTimeLogs = [];

        PersistenceService.ensureFirstLaunchRecorded();
        MigrationService.runAll(state);
        persistAll();
    }

    // Wholesale replace — used by JSON import. Deliberately rebuilds every
    // field (rather than trusting the incoming object's shape) so an
    // old/partial backup can't leave stale data behind.
    function replaceAll(newData) {
        state.exercises = (newData && Array.isArray(newData.exercises)) ? newData.exercises : Models.DEFAULT_EXERCISES.slice();
        state.history = (newData && Array.isArray(newData.history)) ? newData.history : [];
        state.plans = (newData && Array.isArray(newData.plans)) ? newData.plans : [];
        state.measurements = (newData && Array.isArray(newData.measurements) && newData.measurements.length > 0) ? newData.measurements : Models.DEFAULT_MEASUREMENTS.slice();
        state.measurementLogs = (newData && Array.isArray(newData.measurementLogs)) ? newData.measurementLogs : [];
        state.totalTimeLogs = (newData && Array.isArray(newData.totalTimeLogs)) ? newData.totalTimeLogs : [];

        MigrationService.runAll(state);
        persistAll();
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
    function measurementNameExists(name, excludeKey = null) {
        return state.measurements.some(m => m.key !== excludeKey && m.name.toLowerCase() === name.toLowerCase());
    }

    /** @returns {string} the newly-generated key */
    function addMeasurement(name, unit) {
        const key = FormattingService.slugifyMeasurementName(state, name);
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
    // PUBLIC API
    // Query/formatting/backup methods delegate to the relevant service,
    // passing `state` explicitly — Store is the only thing that knows
    // which state object is "current".
    // ============================================================
    return {
        // state + lifecycle
        state,
        onChange,
        load,
        replaceAll,

        // constants a Swift port should mirror verbatim
        DEFAULT_EXERCISES: Models.DEFAULT_EXERCISES,
        DEFAULT_MEASUREMENTS: Models.DEFAULT_MEASUREMENTS,
        BLOOD_PRESSURE_KEY: Models.BLOOD_PRESSURE_KEY,
        TOTAL_TIME_EXERCISE_NAME: Models.TOTAL_TIME_EXERCISE_NAME,
        TOTAL_TIME_EXERCISE_DEF: Models.TOTAL_TIME_EXERCISE_DEF,
        FIELD_LABELS: Models.FIELD_LABELS,
        INTENSITY_COLORS: Models.INTENSITY_COLORS,

        // shared helpers (FormattingService)
        getLocalDateString: DateUtil.getLocalDateString,
        isBloodPressureKey: FormattingService.isBloodPressureKey,
        formatMeasurementValue: FormattingService.formatMeasurementValue,
        findExerciseDef: (name) => FormattingService.findExerciseDef(state, name),
        getIntensityColor: FormattingService.getIntensityColor,

        // CRUD: exercises
        exerciseNameExists,
        addExercise,
        updateExerciseAt,
        deleteExercise,
        countHistoryForExercise,

        // CRUD: measurements
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

        // queries: scheduling & streaks (SchedulingService)
        isRestDayExplicitlyScheduled: (targetDate) => SchedulingService.isRestDayExplicitlyScheduled(state, targetDate),
        getPlannedExercisesForDate: (targetDate) => SchedulingService.getPlannedExercisesForDate(state, targetDate),
        calculateStreak: () => SchedulingService.calculateStreak(state),

        // queries: exercise history lookups (StatsService)
        getMostRecentEntryForExercise: (name, requireIntensity) => StatsService.getMostRecentEntryForExercise(state, name, requireIntensity),
        getPreviousEntry: (name) => StatsService.getPreviousEntry(state, name),
        getMostRecentIntensityForExercise: (name) => StatsService.getMostRecentIntensityForExercise(state, name),
        formatPrevSetpoint: (name) => StatsService.formatPrevSetpoint(state, name),

        // chart aggregation (StatsService)
        getPeriodBucket: StatsService.getPeriodBucket,
        aggregateByPeriod: StatsService.aggregateByPeriod,
        formatPeriodLabel: StatsService.formatPeriodLabel,

        // computed view data (StatsService)
        computeTrackKpis: () => StatsService.computeTrackKpis(state),
        computeStatsKpis: () => StatsService.computeStatsKpis(state),
        computeProgressOverview: () => StatsService.computeProgressOverview(state),
        computeStatsDashboard: (scope) => StatsService.computeStatsDashboard(state, scope),

        // backup (BackupService)
        getSnapshot: () => BackupService.getSnapshot(state),
        buildBackupEnvelope: () => BackupService.buildBackupEnvelope(state),
        parseBackupFile: BackupService.parseBackupFile,
        buildCsvContent: () => BackupService.buildCsvContent(state),
        markJsonExported: BackupService.markJsonExported,
        getLastJsonExportAt: BackupService.getLastJsonExportAt,
        isBackupReminderDue: BackupService.isBackupReminderDue
    };
})();
