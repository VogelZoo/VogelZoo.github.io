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

const FIELD_LABELS = {
    sets: { label: "Sets", type: "number", placeholder: "0", step: "1" },
    reps: { label: "Reps", type: "number", placeholder: "0", step: "1" },
    weight: { label: "Weight (lbs)", type: "number", placeholder: "0.0", step: "0.5" },
    timeSeconds: { label: "Time (Seconds)", type: "number", placeholder: "60", step: "1" },
    timeMinutes: { label: "Time (Minutes)", type: "number", placeholder: "30", step: "1" },
    distance: { label: "Distance (miles)", type: "number", placeholder: "0.00", step: "0.01" }
};

// --- VOLUME / PACE CALCULATION ---
function calcVolume(data) {
    if (data.sets && data.reps && data.weight) return Math.round(data.sets * data.reps * data.weight * 10) / 10;
    if (data.sets && data.weight) return Math.round(data.sets * data.weight * 10) / 10;
    if (data.distance && data.timeMinutes && data.timeMinutes > 0) return Math.round((data.distance / data.timeMinutes) * 1000) / 1000;
    return null;
}
function volumeLabel(exercise) {
    if (!exercise) return null;
    const m = exercise.metrics;
    if (m.includes("sets") && m.includes("reps") && m.includes("weight")) return "Volume (lbs)";
    if (m.includes("sets") && m.includes("weight")) return "Volume (lbs)";
    if (m.includes("distance") && m.includes("timeMinutes")) return "Pace (mi/min)";
    return null;
}

const INTENSITY_COLORS = {
    "Low": "#4b5563",
    "Medium": "#d97706",
    "High": "#dc2626",
    "Default": "#2563eb"
};

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let state = {
    exercises: JSON.parse(localStorage.getItem("ee_exercises")) || DEFAULT_EXERCISES,
    history: JSON.parse(localStorage.getItem("ee_history")) || [],
    plans: JSON.parse(localStorage.getItem("ee_plans")) || []
};

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("log-date").value = new Date().toISOString().split('T')[0];
    initApp();
    setupEventListeners();
});

function initApp() {
    saveState();
    evaluateTodayPlans();
    renderPlanList();
    populateChartFilter();
    renderStats();
}

function saveState() {
    localStorage.setItem("ee_exercises", JSON.stringify(state.exercises));
    localStorage.setItem("ee_history", JSON.stringify(state.history));
    localStorage.setItem("ee_plans", JSON.stringify(state.plans));
}

// 1. Define an Emoji Map matching the options in your custom category form selector
const categoryEmojis = {
    'Strength': '💪',
    'Core': '🧘‍♂️',
    'Cardio': '🏃‍♂️',
    'Mobility/Yoga': '🧘',
    'Default': '🏋️' // Fallback option
};

// 2. Helper function to grab the correct emoji
function getCategoryEmoji(category) {
    return categoryEmojis[category] || categoryEmojis['Default'];
}

// EXAMPLE USAGE:
// When generating lists or history logs dynamically, update your templates:
// Instead of hardcoding: `<span>💪 ${exercise.name}</span>`
// Use something like: `<span>${getCategoryEmoji(exercise.category)} ${exercise.name}</span>`


// --- NAVIGATION ---
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`nav-${viewId}`).classList.add('active');
    
    // Clear dynamic modifications if navigating out of edit mode context
    if (viewId !== 'track') cancelFormEdit();

    if (viewId === 'track') evaluateTodayPlans();
    if (viewId === 'plan') renderPlanList();
    if (viewId === 'stats') { populateChartFilter(); renderStats(); }
}

// --- ENGINE CALCULATIONS & HORIZONS ---
function evaluateTodayPlans() {
    const selectedDateStr = document.getElementById("log-date").value;
    const selectedDate = selectedDateStr ? new Date(selectedDateStr + "T00:00:00") : new Date();
    
    let targetExercises = getPlannedExercisesForDate(selectedDate);

    const suggestionBox = document.getElementById("today-suggestion");
    const formattedDisplayDate = selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    
    if (targetExercises.length > 0) {
        suggestionBox.innerHTML = `<h3>Plan for ${formattedDisplayDate}</h3><p>🎯 ${targetExercises.join(", ")}</p>`;
        suggestionBox.classList.remove("hidden");
    } else {
        suggestionBox.innerHTML = `<h3>No routine explicitly scheduled for ${formattedDisplayDate}</h3>`;
    }

    renderExerciseSelectors(targetExercises);
    render7DayHorizon(new Date());
}

function getPlannedExercisesForDate(targetDate) {
    const dayOfWeek = targetDate.getDay();
    let matches = [];

    state.plans.forEach(plan => {
        if (plan.exercise === "__rest__") return; // rest days don't show as exercise targets
        if (plan.type === 'weekly' && parseInt(plan.day) === dayOfWeek) {
            matches.push(plan.exercise);
        } else if (plan.type === 'interval') {
            const start = new Date(plan.startDate + "T00:00:00");
            const current = new Date(targetDate);
            current.setHours(0,0,0,0);
            
            const diffTime = current - start;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0 && diffDays % parseInt(plan.interval) === 0) {
                matches.push(plan.exercise);
            }
        }
    });
    return matches;
}

function render7DayHorizon(baseDate) {
    const container = document.getElementById("calendar-horizon-view");
    container.innerHTML = "";
    const activeLogDate = document.getElementById("log-date").value;

    for (let i = 0; i < 7; i++) {
        let futureDate = new Date(baseDate);
        futureDate.setDate(baseDate.getDate() + i);
        
        let dayTargets = getPlannedExercisesForDate(futureDate);
        let dayLabel = i === 0 ? "Today" : DAYS_SHORT[futureDate.getDay()];
        let dateString = futureDate.toISOString().split('T')[0];

        let dayCard = document.createElement("div");
        dayCard.className = `cal-day-card ${dateString === activeLogDate ? 'today' : ''}`;
        
        // --- LAYOUT FIX FOR TEXT OVERFLOW / HEIGHT ---
        // Ensures the card grows gracefully with the content instead of clipping
        dayCard.style.display = "flex";
        dayCard.style.flexDirection = "column";
        dayCard.style.minHeight = "fit-content"; 
        dayCard.style.height = "auto";
        dayCard.style.padding = "0.5rem";

        dayCard.onclick = () => {
            cancelFormEdit();
            document.getElementById("log-date").value = dateString;
            evaluateTodayPlans();
        };

        // Added styling adjustments inside the mapping loop to keep tag structures block-wrapped and neat
        let tagsHtml = dayTargets.map(t => `
            <span class="cal-event-tag" style="display: block; margin-top: 2px; word-break: break-word; font-size: 0.65rem;">
                ${t}
            </span>
        `).join("");
        
        if (dayTargets.length === 0) {
            tagsHtml = `<span class="text-muted" style="font-size:0.65rem; display:block; margin-top:2px;">Rest</span>`;
        }

        dayCard.innerHTML = `
            <div class="cal-day-title" style="font-weight: bold;">${dayLabel}</div>
            <div class="text-muted" style="font-size:0.65rem; margin-bottom: 4px;">${futureDate.getMonth()+1}/${futureDate.getDate()}</div>
            <div class="cal-day-events" style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;">${tagsHtml}</div>
        `;
        container.appendChild(dayCard);
    }
}

// --- LOGGING INPUT FIELDS LOGIC ---
function renderExerciseSelectors(priorityList = []) {
    const selectLog = document.getElementById("exercise-select");
    const selectPlan = document.getElementById("plan-exercise");
    
    let organizedExercises = [...state.exercises].sort((a, b) => {
        let catA = a.category || "Uncategorized";
        let catB = b.category || "Uncategorized";
        if (catA !== catB) return catA.localeCompare(catB);
        return a.name.localeCompare(b.name);
    });

    let priorityOptions = [];
    let regularOptionsByGroup = {};

    organizedExercises.forEach(ex => {
        let cat = ex.category || "Uncategorized";
        if (priorityList.includes(ex.name)) {
            priorityOptions.push(`<option value="${ex.name}">⭐ [${cat}] ${ex.name}</option>`);
        }
        if (!regularOptionsByGroup[cat]) regularOptionsByGroup[cat] = [];
        regularOptionsByGroup[cat].push(`<option value="${ex.name}">${ex.name}</option>`);
    });

    let finalLogHtml = "";
    if (priorityOptions.length > 0) {
        finalLogHtml += `<optgroup label="⭐ Scheduled For Selected Date">` + priorityOptions.join("") + `</optgroup>`;
    }
    Object.entries(regularOptionsByGroup).forEach(([category, options]) => {
        finalLogHtml += `<optgroup label="${category}">` + options.join("") + `</optgroup>`;
    });

    selectLog.innerHTML = finalLogHtml;

    // Plan selector uses same category optgroup scheme as log selector
    let planHtml = "";
    Object.entries(regularOptionsByGroup).forEach(([category, options]) => {
        const emoji = getCategoryEmoji(category);
        planHtml += `<optgroup label="${emoji} ${category}">` + options.join("") + `</optgroup>`;
    });
    selectPlan.innerHTML = planHtml;
    
    // Check if we are currently editing an existing record before forcing field values updates
    const editingId = document.getElementById("edit-entry-id").value;
    if (!editingId && organizedExercises.length > 0) {
        buildDynamicFormFields(selectLog.value);
    }
}

function buildDynamicFormFields(exerciseName, existingData = null) {
    const container = document.getElementById("dynamic-fields-container");
    container.innerHTML = "";
    
    const exercise = state.exercises.find(e => e.name === exerciseName);
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
            <label for="field-${fieldKey}">${fieldMeta.label}</label>
            <input type="${fieldMeta.type}" id="field-${fieldKey}" name="${fieldKey}" ${valAttr} placeholder="${placeholderVal}" step="${fieldMeta.step}" inputmode="decimal" required>
        `;
        container.appendChild(div);
    });
}

function getPreviousEntry(exerciseName) {
    return state.history.find(entry => entry.exerciseName === exerciseName);
}

// --- HISTORICAL EDIT/DELETE OPERATION PIPELINES ---
function initEditEntry(id) {
    const entry = state.history.find(h => h.id === id);
    if (!entry) return;

    switchView('track');

    document.getElementById("form-title").innerText = "Edit Historical Log";
    document.getElementById("edit-entry-id").value = entry.id;
    document.getElementById("log-date").value = entry.date;
    document.getElementById("log-intensity").value = entry.intensity || "";
    
    // Repopulate dynamic drop select layouts cleanly
    evaluateTodayPlans();
    document.getElementById("exercise-select").value = entry.exerciseName;
    
    buildDynamicFormFields(entry.exerciseName, entry.data);

    // Inject Cancel button block layout safely if not already existing
    if (!document.getElementById("cancel-edit-btn")) {
        const btnContainer = document.getElementById("form-action-buttons");
        btnContainer.style.gridTemplateColumns = "1fr 1fr";
        
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.id = "cancel-edit-btn";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.innerText = "Cancel";
        cancelBtn.onclick = cancelFormEdit;
        btnContainer.appendChild(cancelBtn);
    }
    document.getElementById("submit-log-btn").innerText = "Update Entry";
}

function cancelFormEdit() {
    document.getElementById("form-title").innerText = "Log Exercise";
    document.getElementById("edit-entry-id").value = "";
    document.getElementById("log-form").reset();
    document.getElementById("log-date").value = new Date().toISOString().split('T')[0];
    document.getElementById("submit-log-btn").innerText = "Save Entry";
    
    const cancelBtn = document.getElementById("cancel-edit-btn");
    if (cancelBtn) {
        cancelBtn.remove();
        document.getElementById("form-action-buttons").style.gridTemplateColumns = "1fr";
    }
    evaluateTodayPlans();
}

function deleteEntry(id) {
    if (confirm("Are you sure you want to delete this historical entry?")) {
        state.history = state.history.filter(h => h.id !== id);
        saveState();
        renderStats();
    }
}

function deletePlan(id) {
    if (confirm("Are you sure you want to delete this plan?")) {
        state.plans = state.plans.filter(p => p.id !== id);
        saveState();
        renderPlanList();
        evaluateTodayPlans();
    }
}


// --- PERSONAL RECORDS ---
function computePRs() {
    // Returns { exerciseName: { metricKey: { value, date, entryId } } }
    const prs = {};
    state.history.forEach(entry => {
        if (!entry.data) return;
        const ex = entry.exerciseName;
        if (!prs[ex]) prs[ex] = {};
        Object.entries(entry.data).forEach(([k, v]) => {
            if (k.startsWith("_")) return; // skip computed fields
            const num = parseFloat(v);
            if (isNaN(num)) return;
            if (!prs[ex][k] || num > prs[ex][k].value) {
                prs[ex][k] = { value: num, date: entry.date, entryId: entry.id };
            }
        });
        // Volume PR
        if (entry.data._volume !== undefined) {
            if (!prs[ex]["_volume"] || entry.data._volume > prs[ex]["_volume"].value) {
                prs[ex]["_volume"] = { value: entry.data._volume, date: entry.date, entryId: entry.id };
            }
        }
    });
    return prs;
}

function checkNewPR(entry) {
    // Returns array of { metric, newVal, prevVal } for any PR broken by this entry
    const ex = entry.exerciseName;
    const broken = [];
    const allForEx = state.history.filter(h => h.exerciseName === ex && h.id !== entry.id);
    Object.entries(entry.data).forEach(([k, v]) => {
        if (k.startsWith("_")) return;
        const num = parseFloat(v);
        if (isNaN(num)) return;
        const prev = allForEx.reduce((best, h) => {
            const hv = h.data && parseFloat(h.data[k]);
            return (!isNaN(hv) && hv > best) ? hv : best;
        }, -Infinity);
        if (prev === -Infinity || num > prev) {
            broken.push({ metric: FIELD_LABELS[k] ? FIELD_LABELS[k].label : k, newVal: num, prevVal: prev === -Infinity ? null : prev });
        }
    });
    if (entry.data._volume !== undefined) {
        const prev = allForEx.reduce((best, h) => {
            const hv = h.data && parseFloat(h.data._volume);
            return (!isNaN(hv) && hv > best) ? hv : best;
        }, -Infinity);
        if (prev === -Infinity || entry.data._volume > prev) {
            broken.push({ metric: "Volume", newVal: entry.data._volume, prevVal: prev === -Infinity ? null : prev });
        }
    }
    return broken;
}

// --- STREAK TRACKING ---
// A day "counts" if: there is at least one history entry, OR it is a planned Rest day.
function getActiveDays() {
    // Returns a Set of date strings that count as active
    const activeDates = new Set(state.history.map(h => h.date));
    // Add rest days from plans
    state.plans.filter(p => p.exercise === "__rest__").forEach(plan => {
        // Project rest days over last 90 days
        const today = new Date(); today.setHours(0,0,0,0);
        for (let i = 0; i <= 90; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            if (plan.type === "weekly" && d.getDay() === parseInt(plan.day)) activeDates.add(dateStr);
            else if (plan.type === "interval") {
                const start = new Date(plan.startDate + "T00:00:00");
                const diff = Math.floor((d - start) / 86400000);
                if (diff >= 0 && diff % parseInt(plan.interval) === 0) activeDates.add(dateStr);
            }
        }
    });
    return activeDates;
}

function computeStreak() {
    const activeDates = getActiveDays();
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().split("T")[0];

    let current = 0;
    let longest = 0;
    let streak = 0;
    let d = new Date(today);

    // Walk back from today
    while (true) {
        const ds = d.toISOString().split("T")[0];
        if (activeDates.has(ds)) {
            streak++;
            d.setDate(d.getDate() - 1);
        } else {
            break;
        }
    }
    current = streak;

    // Longest streak: sort all active dates and walk
    const sorted = [...activeDates].sort();
    if (sorted.length === 0) return { current: 0, longest: 0 };
    let run = 1; let max = 1;
    for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i-1] + "T00:00:00");
        const cur  = new Date(sorted[i]   + "T00:00:00");
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 1) { run++; max = Math.max(max, run); }
        else run = 1;
    }
    return { current, longest: max };
}

// --- STATS VIEW & COMPACT DAY GROUPING ---
function populateChartFilter() {
    const filterSelect = document.getElementById("chart-exercise-select");
    const wrapper = document.getElementById("chart-filter-wrapper");
    
    // Filter array: Evaluate exercises containing 2 or more complete records explicitly
    let chartableExercises = state.exercises.filter(ex => {
        let count = state.history.filter(h => h.exerciseName === ex.name).length;
        return count >= 2;
    });

    if (chartableExercises.length === 0) {
        wrapper.classList.add("hidden");
        return;
    }
    wrapper.classList.remove("hidden");

    let currentSelection = filterSelect.value;
    filterSelect.innerHTML = chartableExercises.map(e => `<option value="${e.name}">${e.name}</option>`).join("");
    
    if (currentSelection && chartableExercises.some(e => e.name === currentSelection)) {
        filterSelect.value = currentSelection;
    }
}

function renderStats() {
    const summary = document.getElementById("stats-summary");
    const groupedContainer = document.getElementById("history-grouped-container");
    const graphContainer = document.getElementById("graph-container");
    const legendBlock = document.getElementById("chart-legend");
    const filterSelect = document.getElementById("chart-exercise-select");

    if (state.history.length === 0) {
        summary.innerHTML = `<p class="text-muted">Complete your first log to start tracking metrics.</p>`;
        groupedContainer.innerHTML = `<p class="text-muted">No historic timeline data logs detected.</p>`;
        graphContainer.innerHTML = "";
        legendBlock.style.display = "none";
        return;
    }

    // --- STREAK BANNER ---
    const streak = computeStreak();
    const streakEl = document.getElementById("streak-banner");
    if (streakEl) {
        const fireCount = Math.min(Math.floor(streak.current / 3), 5);
        const flames = "🔥".repeat(fireCount || (streak.current > 0 ? 1 : 0));
        streakEl.innerHTML = streak.current > 0
            ? `<span class="streak-current">${flames} ${streak.current}-day streak</span><span class="streak-best">Best: ${streak.longest}</span>`
            : `<span class="text-muted" style="font-size:0.8rem;">No active streak — log today to start one!</span>`;
        streakEl.style.display = "flex";
    }

    // --- MULTI-AXIS PROGRESSION CHART ---
    const targetExercise = filterSelect.value;
    let exerciseHistory = [];
    if (targetExercise) {
        exerciseHistory = state.history
            .filter(entry => entry.exerciseName === targetExercise)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    if (!targetExercise || exerciseHistory.length < 2) {
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Select or complete an exercise with 2+ entries to view progression.</p>`;
        legendBlock.style.display = "none";
    } else {
        legendBlock.style.display = "none"; // replaced by inline legend below
        const ex = state.exercises.find(e => e.name === targetExercise);

        // Determine which metrics to chart: all numeric metrics + _volume if present
        const metricKeys = ex ? ex.metrics.filter(k => k !== "sets") : [];
        if (exerciseHistory.some(h => h.data && h.data._volume !== undefined)) metricKeys.push("_volume");

        const LINE_COLORS = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#dc2626"];
        const metricMeta = metricKeys.map((k, i) => {
            let label = k === "_volume" ? (volumeLabel(ex) || "Volume") : (FIELD_LABELS[k] ? FIELD_LABELS[k].label : k);
            return { key: k, label, color: LINE_COLORS[i % LINE_COLORS.length] };
        });

        const width = 400;
        const height = 200;
        const padL = 36, padR = 36, padT = 20, padB = 28;
        const chartW = width - padL - padR;
        const chartH = height - padT - padB;
        const n = exerciseHistory.length;

        let svgParts = [];

        // Draw one Y-axis + line per metric
        metricMeta.forEach((meta, mi) => {
            const vals = exerciseHistory.map(h => parseFloat(h.data[meta.key]) || 0);
            const minV = Math.min(...vals);
            const maxV = Math.max(...vals);
            const range = maxV === minV ? (maxV === 0 ? 1 : maxV * 0.2) : maxV - minV;
            const lo = minV - range * 0.1;
            const hi = maxV + range * 0.1;

            const xOf = (i) => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
            const yOf = (v) => padT + chartH - ((v - lo) / (hi - lo)) * chartH;

            // Y-axis ticks: left side for first metric, right for second, skip rest (just lines)
            if (mi < 2) {
                const side = mi === 0 ? "left" : "right";
                const tickX = side === "left" ? padL : width - padR;
                const labelX = side === "left" ? padL - 3 : width - padR + 3;
                const anchor = side === "left" ? "end" : "start";
                // 3 tick marks
                [lo, (lo + hi) / 2, hi].forEach(tv => {
                    const ty = yOf(tv);
                    const disp = Math.abs(tv) >= 100 ? Math.round(tv) : Math.round(tv * 10) / 10;
                    svgParts.push(`<text x="${labelX}" y="${ty + 3}" font-size="7" fill="${meta.color}" text-anchor="${anchor}">${disp}</text>`);
                    if (mi === 0) {
                        svgParts.push(`<line x1="${padL}" y1="${ty}" x2="${width - padR}" y2="${ty}" stroke="#374151" stroke-width="0.5" stroke-dasharray="3,3"/>`);
                    }
                });
                // Axis line
                svgParts.push(`<line x1="${tickX}" y1="${padT}" x2="${tickX}" y2="${padT + chartH}" stroke="${meta.color}" stroke-width="1" opacity="0.6"/>`);
            }

            // Line path
            const pts = exerciseHistory.map((h, i) => ({ x: xOf(i), y: yOf(parseFloat(h.data[meta.key]) || 0) }));
            const pathD = `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
            svgParts.push(`<path d="${pathD}" fill="none" stroke="${meta.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`);

            // Dots with intensity color border
            pts.forEach((p, i) => {
                const intColor = INTENSITY_COLORS[exerciseHistory[i].intensity] || "#374151";
                const val = parseFloat(exerciseHistory[i].data[meta.key]) || 0;
                svgParts.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${meta.color}" stroke="${intColor}" stroke-width="1.5"/>`);
                // Show value label on first metric only to avoid clutter
                if (mi === 0) {
                    svgParts.push(`<text x="${p.x}" y="${p.y - 6}" font-size="7" fill="#f3f4f6" text-anchor="middle">${val}</text>`);
                }
            });
        });

        // X axis date labels
        if (n > 0) {
            const xOf = (i) => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
            svgParts.push(`<text x="${xOf(0)}" y="${height - 4}" font-size="7.5" fill="#9ca3af" text-anchor="start">${exerciseHistory[0].date.substring(5)}</text>`);
            svgParts.push(`<text x="${xOf(n-1)}" y="${height - 4}" font-size="7.5" fill="#9ca3af" text-anchor="end">${exerciseHistory[n-1].date.substring(5)}</text>`);
        }
        // Bottom axis line
        svgParts.push(`<line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="#374151" stroke-width="1"/>`);

        // Inline legend
        const legendHtml = metricMeta.map(m =>
            `<span style="display:inline-flex;align-items:center;gap:0.25rem;">
                <span style="display:inline-block;width:16px;height:2px;background:${m.color};border-radius:1px;"></span>
                <span style="font-size:0.7rem;color:${m.color};">${m.label}</span>
            </span>`
        ).join("");

        graphContainer.innerHTML = `
            <div class="svg-chart-container">
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.35rem; text-align:center;">Progression — ${targetExercise}</div>
                <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                    ${svgParts.join("\n")}
                </svg>
                <div style="display:flex;flex-wrap:wrap;gap:0.4rem 0.75rem;justify-content:center;margin-top:0.4rem;">${legendHtml}</div>
            </div>
        `;
    }

    // --- PR PANEL ---
    const prPanel = document.getElementById("pr-panel");
    if (prPanel) {
        const prs = computePRs();
        if (Object.keys(prs).length === 0) {
            prPanel.innerHTML = `<p class="text-muted" style="font-size:0.8rem;">Log entries to see your personal records.</p>`;
        } else {
            const rows = Object.entries(prs).map(([exName, metrics]) => {
                const metricBits = Object.entries(metrics).map(([k, v]) => {
                    const lbl = k === "_volume" ? "Vol" : (FIELD_LABELS[k] ? FIELD_LABELS[k].label.replace(" (lbs)","").replace(" (miles)","").replace(" (Seconds)","s").replace(" (Minutes)","m") : k);
                    return `<span class="pr-metric">${lbl}: <strong>${v.value}</strong></span>`;
                }).join("");
                return `<div class="pr-row"><span class="pr-name">${getCategoryEmoji((state.exercises.find(e=>e.name===exName)||{}).category)} ${exName}</span><div class="pr-metrics">${metricBits}</div></div>`;
            }).join("");
            prPanel.innerHTML = rows;
        }
    }

    // --- SUMMARY LINE ---
    summary.innerHTML = `<p style="font-size:0.85rem;"><strong>Total Lifetime Logs:</strong> ${state.history.length} sessions</p>`;

    // --- STACKED BAR CHARTS ---
    renderStackedBarCharts();

    // --- COMPACT GROUP BY DAY MAP COMPILATION ---
    let dailyGroups = {};
    state.history.forEach(entry => {
        if (!dailyGroups[entry.date]) dailyGroups[entry.date] = [];
        dailyGroups[entry.date].push(entry);
    });

    let sortedDaysKeys = Object.keys(dailyGroups).sort((a,b) => new Date(b) - new Date(a));

    groupedContainer.innerHTML = sortedDaysKeys.map(dateStr => {
        let displayDayObj = new Date(dateStr + "T00:00:00");
        let dayHeaderLabel = displayDayObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
        let dayItems = dailyGroups[dateStr];

        let itemsHtml = dayItems.map(item => {
            let metricStr = Object.entries(item.data)
                .filter(([k]) => !k.startsWith("_"))
                .map(([k, v]) => {
                    let unit = k === "timeSeconds" ? "s" : k === "timeMinutes" ? "m" : k === "distance" ? "mi" : k === "weight" ? "lbs" : (" " + k);
                    return v + unit;
                }).join(" | ");
            if (item.data._volume !== undefined) {
                const ex = state.exercises.find(e => e.name === item.exerciseName);
                const vl = (volumeLabel(ex) || "Vol").replace(" (lbs)","").replace(" (mi/min)","");
                metricStr += " · " + vl + ": " + item.data._volume;
            }
            let intBadge = item.intensity ? '<span class="badge-intensity intensity-' + item.intensity + '">' + item.intensity + '</span>' : "";
            return '<li class="list-group-item">'
                + '<div><strong>' + item.exerciseName + '</strong>' + intBadge + '<br><span class="text-muted" style="font-size:0.8rem;">' + metricStr + '</span></div>'
                + '<div class="history-item-actions">'
                + '<span class="action-link" onclick="initEditEntry(' + item.id + ')">Edit</span>'
                + '<span class="action-link delete" onclick="deleteEntry(' + item.id + ')">Del</span>'
                + '</div></li>';
        }).join("");

        return '<div class="history-day-block">'
            + '<div class="history-day-block-title">' + dayHeaderLabel + '</div>'
            + '<ul class="list-group">' + itemsHtml + '</ul>'
            + '</div>';
    }).join("");
}

// --- TOAST NOTIFICATIONS ---
function showToast(msg, type = "success") {
    const existing = document.getElementById("ee-toast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.id = "ee-toast";
    const bg = type === "pr" ? "linear-gradient(135deg,#7c3aed,#2563eb)" : type === "error" ? "#dc2626" : "#059669";
    t.style.cssText = `position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:0.65rem 1.1rem;border-radius:10px;font-size:0.85rem;font-weight:600;z-index:9999;max-width:88vw;text-align:center;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,0.4);`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.style.opacity = "0"; t.style.transition = "opacity 0.4s"; setTimeout(() => t.remove(), 400); }, type === "pr" ? 4000 : 2000);
}

// --- STACKED BAR CHARTS ---

const CATEGORY_COLORS = {
    "Strength":      "#2563eb",
    "Core":          "#7c3aed",
    "Cardio":        "#059669",
    "Mobility/Yoga": "#db2777",
    "Other":         "#4b5563"
};

const STACKED_INTENSITY_COLORS = {
    "Low":    "#4b5563",
    "Medium": "#d97706",
    "High":   "#dc2626",
    "None":   "#374151"
};

function buildWeeklyBuckets(history, weeks = 8) {
    const buckets = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay();
    const diffToMon = (day === 0) ? -6 : 1 - day;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + diffToMon);

    for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(thisMonday);
        start.setDate(thisMonday.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const label = `${start.getMonth()+1}/${start.getDate()}`;
        buckets.push({ label, startDate: start, endDate: end });
    }
    buckets.forEach(b => {
        b.entries = history.filter(entry => {
            const d = new Date(entry.date + "T00:00:00");
            return d >= b.startDate && d <= b.endDate;
        });
    });
    return buckets;
}

function renderStackedSVG(buckets, stackKeys, colorMap, title) {
    const width = 400, height = 180;
    const padL = 28, padR = 10, padT = 16, padB = 36;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;
    const barW = Math.floor(chartW / buckets.length * 0.65);
    const gap  = Math.floor(chartW / buckets.length);

    const stacks = buckets.map(b => {
        const counts = {};
        stackKeys.forEach(k => counts[k] = 0);
        b.entries.forEach(e => {
            const key = stackKeys.includes(e._stackKey) ? e._stackKey : stackKeys[stackKeys.length - 1];
            counts[key]++;
        });
        const total = Object.values(counts).reduce((s, v) => s + v, 0);
        return { label: b.label, counts, total };
    });

    const maxTotal = Math.max(...stacks.map(s => s.total), 1);
    const gridMax = Math.ceil(maxTotal / 2) * 2 || 2;
    const gridLines = [0, Math.floor(gridMax / 2), gridMax];

    let svgParts = [];
    gridLines.forEach(v => {
        const y = padT + chartH - (v / gridMax) * chartH;
        svgParts.push(`<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#374151" stroke-width="0.5" stroke-dasharray="3,3"/>`);
        svgParts.push(`<text x="${padL - 3}" y="${y + 3}" font-size="8" fill="#9ca3af" text-anchor="end">${v}</text>`);
    });

    stacks.forEach((s, i) => {
        const barX = padL + i * gap + (gap - barW) / 2;
        let yOffset = padT + chartH;
        stackKeys.forEach(k => {
            if (s.counts[k] === 0) return;
            const barH = (s.counts[k] / gridMax) * chartH;
            yOffset -= barH;
            svgParts.push(`<rect x="${barX}" y="${yOffset}" width="${barW}" height="${barH}" fill="${colorMap[k] || "#4b5563"}" rx="1"/>`);
        });
        svgParts.push(`<text x="${barX + barW / 2}" y="${padT + chartH + 10}" font-size="7.5" fill="#9ca3af" text-anchor="middle">${s.label}</text>`);
        if (s.total > 0) {
            const topY = padT + chartH - (s.total / gridMax) * chartH - 3;
            svgParts.push(`<text x="${barX + barW / 2}" y="${topY}" font-size="7" fill="#f3f4f6" text-anchor="middle">${s.total}</text>`);
        }
    });

    svgParts.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#374151" stroke-width="1"/>`);
    svgParts.push(`<line x1="${padL}" y1="${padT + chartH}" x2="${width - padR}" y2="${padT + chartH}" stroke="#374151" stroke-width="1"/>`);

    return `
        <div class="svg-chart-container" style="margin-bottom:0.75rem;">
            <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.35rem;text-align:center;">${title}</div>
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                ${svgParts.join("\n")}
            </svg>
        </div>
    `;
}

function renderChartLegend(keys, colorMap) {
    return `<div style="display:flex;flex-wrap:wrap;gap:0.4rem 0.75rem;justify-content:center;font-size:0.7rem;margin-bottom:0.75rem;">
        ${keys.map(k => `<span style="display:flex;align-items:center;gap:0.25rem;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colorMap[k]||"#4b5563"};"></span>${k}</span>`).join("")}
    </div>`;
}

function renderStackedBarCharts() {
    const container = document.getElementById("stacked-bar-charts-container");
    if (!container) return;
    if (state.history.length < 2) { container.innerHTML = ""; return; }

    const activeTab = container.dataset.activeTab || "intensity";
    const tabHtml = `
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
            <button onclick="switchStackedTab('intensity')" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);font-size:0.8rem;font-weight:600;cursor:pointer;background:${activeTab==='intensity'?'var(--accent)':'var(--bg-primary)'};color:${activeTab==='intensity'?'#fff':'var(--text-muted)'};">By Intensity</button>
            <button onclick="switchStackedTab('category')" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid var(--border);font-size:0.8rem;font-weight:600;cursor:pointer;background:${activeTab==='category'?'var(--accent)':'var(--bg-primary)'};color:${activeTab==='category'?'#fff':'var(--text-muted)'};">By Category</button>
        </div>
    `;
    const buckets = buildWeeklyBuckets(state.history, 8);
    let chartHtml = "";

    if (activeTab === "intensity") {
        const intensityKeys = ["High", "Medium", "Low", "None"];
        buckets.forEach(b => b.entries.forEach(e => {
            e._stackKey = (e.intensity && STACKED_INTENSITY_COLORS[e.intensity]) ? e.intensity : "None";
        }));
        chartHtml += renderStackedSVG(buckets, intensityKeys, STACKED_INTENSITY_COLORS, "Weekly Exercise Count — by Intensity");
        chartHtml += renderChartLegend(intensityKeys, STACKED_INTENSITY_COLORS);
    } else {
        const knownOrder = ["Strength", "Core", "Cardio", "Mobility/Yoga"];
        const allCats = [...new Set(state.exercises.map(e => e.category || "Other"))];
        const categoryKeys = [...knownOrder.filter(c => allCats.includes(c)), ...allCats.filter(c => !knownOrder.includes(c))];
        allCats.forEach(k => { if (!CATEGORY_COLORS[k]) CATEGORY_COLORS[k] = "#4b5563"; });
        buckets.forEach(b => b.entries.forEach(e => {
            const ex = state.exercises.find(x => x.name === e.exerciseName);
            e._stackKey = (ex && ex.category) ? ex.category : "Other";
        }));
        chartHtml += renderStackedSVG(buckets, categoryKeys, CATEGORY_COLORS, "Weekly Exercise Count — by Category");
        chartHtml += renderChartLegend(categoryKeys, CATEGORY_COLORS);
    }
    container.innerHTML = tabHtml + chartHtml;
}

function switchStackedTab(tab) {
    const container = document.getElementById("stacked-bar-charts-container");
    if (!container) return;
    container.dataset.activeTab = tab;
    renderStackedBarCharts();
}

// --- ORGANIZED APP EVENT LISTENER ATTACHMENTS ---
function setupEventListeners() {
    document.getElementById("log-date").addEventListener("change", () => {
        const editingId = document.getElementById("edit-entry-id").value;
        if (!editingId) evaluateTodayPlans();
    });

    document.getElementById("exercise-select").addEventListener("change", (e) => {
        buildDynamicFormFields(e.target.value);
    });

    document.getElementById("log-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const editingId = document.getElementById("edit-entry-id").value;
        const exerciseName = document.getElementById("exercise-select").value;
        const exercise = state.exercises.find(e => e.name === exerciseName);
        const selectedDate = document.getElementById("log-date").value;
        const intensity = document.getElementById("log-intensity").value;
        
        const formData = new FormData(e.target);
        let logData = {};
        
        exercise.metrics.forEach(fieldKey => {
            logData[fieldKey] = parseFloat(formData.get(fieldKey));
        });
        // Store calculated volume/pace if applicable
        const vol = calcVolume(logData);
        if (vol !== null) logData._volume = vol;

        if (editingId) {
            // Processing updates on an existing configuration record node
            let index = state.history.findIndex(h => h.id === parseInt(editingId));
            if (index !== -1) {
                const editVol = calcVolume(logData);
                if (editVol !== null) logData._volume = editVol;
                state.history[index].date = selectedDate;
                state.history[index].exerciseName = exerciseName;
                state.history[index].intensity = intensity || null;
                state.history[index].data = logData;
            }
            alert(`Log entry updated!`);
        } else {
            // standard appending routine execution
            const newEntry = {
                id: Date.now(),
                date: selectedDate,
                exerciseName: exerciseName,
                intensity: intensity || null,
                data: logData
            };
            state.history.unshift(newEntry);
        }

        state.history.sort((a,b) => new Date(b.date) - new Date(a.date));
        saveState();

        // Check for new PRs on a fresh log (not edit)
        if (!editingId) {
            const justLogged = state.history.find(h => h.exerciseName === exerciseName && h.date === selectedDate);
            if (justLogged) {
                const newPRs = checkNewPR(justLogged);
                if (newPRs.length > 0) {
                    const msg = newPRs.map(p => `🏆 ${p.metric}: ${p.newVal}${p.prevVal !== null ? ` (prev ${p.prevVal})` : " (first entry)"}`).join("\n");
                    showToast("New Personal Record!\n" + msg, "pr");
                } else {
                    showToast("Entry saved!", "success");
                }
            }
        } else {
            showToast("Entry updated!", "success");
        }

        // Reset dynamic elements cleanly back to standard defaults tracking configurations
        cancelFormEdit();
    });

    document.getElementById("plan-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const type = document.getElementById("schedule-type").value;
        const isRest = document.getElementById("plan-rest-toggle") && document.getElementById("plan-rest-toggle").checked;
        
        const newPlan = {
            id: Date.now(),
            exercise: isRest ? "__rest__" : document.getElementById("plan-exercise").value,
            type: type,
            day: type === 'weekly' ? document.getElementById("plan-day").value : null,
            interval: type === 'interval' ? document.getElementById("plan-interval").value : null,
            startDate: type === 'interval' ? document.getElementById("plan-start-date").value : null
        };

        state.plans.push(newPlan);
        saveState();
        renderPlanList();
        evaluateTodayPlans();
        showToast(isRest ? "Rest day added to plan 😴" : "Exercise added to plan!", "success");
    });

    document.getElementById("custom-exercise-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("new-ex-name").value.trim();
        const category = document.getElementById("new-ex-category").value;
        const checkedBoxes = e.target.querySelectorAll('input[name="metric"]:checked');
        let selectedMetrics = Array.from(checkedBoxes).map(cb => cb.value);

        if (selectedMetrics.length === 0) {
            alert("Please check at least one tracking field metric.");
            return;
        }
        if (state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
            alert("This exercise name already exists.");
            return;
        }

        state.exercises.push({ name: name, category: category, metrics: selectedMetrics });
        saveState();
        renderExerciseSelectors();
        populateChartFilter();
        e.target.reset();
        alert(`Created custom template for: ${name}`);
    });
}

function toggleScheduleInputs() {
    const type = document.getElementById("schedule-type").value;
    document.getElementById("weekly-inputs").classList.toggle("hidden", type !== "weekly");
    document.getElementById("interval-inputs").classList.toggle("hidden", type !== "interval");
}

function renderPlanList() {
    const container = document.getElementById("organized-plan-view");
    container.innerHTML = "";

    if (state.plans.length === 0) {
        container.innerHTML = `<p class="text-muted">No scheduled routines set up yet.</p>`;
        return;
    }

    let weeklyPlans = state.plans.filter(p => p.type === 'weekly');
    let intervalPlans = state.plans.filter(p => p.type === 'interval');

    let html = `<div class="schedule-section-title">Weekly Schedule</div>`;

    const sortedDaysIndices = [1, 2, 3, 4, 5, 6, 0];
    sortedDaysIndices.forEach(dayIdx => {
        let dayPlans = weeklyPlans.filter(p => parseInt(p.day) === dayIdx);
        
        html += `
            <div class="plan-day-block">
                <div class="plan-day-block-title">${DAYS_LONG[dayIdx]}</div>
                ${(() => {
                    const restPlan = dayPlans.find(p => p.exercise === "__rest__");
                    const exPlans = dayPlans.filter(p => p.exercise !== "__rest__");
                    let html = "";
                    if (restPlan) html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0;font-size:0.85rem;"><span>😴 Rest Day</span><button onclick="deletePlan(${restPlan.id})" class="badge" style="background:#4b5563;border:none;color:white;cursor:pointer;">X</button></div>`;
                    if (exPlans.length === 0 && !restPlan) html += '<p class="text-muted" style="font-size:0.8rem; padding:0.25rem 0;">—</p>';
                    if (exPlans.length > 0) html += '<ul class="list-group">' + exPlans.map(plan => `<li class="list-group-item"><span>${getCategoryEmoji((state.exercises.find(e => e.name === plan.exercise) || {}).category)} ${plan.exercise}</span><button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button></li>`).join("") + '</ul>';
                    return html;
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
}

// --- PORTING IO CONTEXTS ---
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `engineered_exercise_backup.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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

// --- EXPORT AS CSV ROUTINE ---
function exportCSV() {
    if (state.history.length === 0) {
        alert("No historical workout log entries found to export.");
        return;
    }

    // 1. Gather all unique metric tracking field keys present across the history timeline
    const allMetricKeys = new Set();
    state.history.forEach(entry => {
        if (entry.data) {
            Object.keys(entry.data).forEach(key => allMetricKeys.add(key));
        }
    });
    const metricKeysArray = Array.from(allMetricKeys).sort();

    // 2. Define baseline systemic tracking headers
    const baseHeaders = ["ID", "Date", "Exercise Name", "Intensity"];
    const fullHeaders = [...baseHeaders, ...metricKeysArray];

    // 3. Compile Rows and map metrics cleanly into their respective static columns
    const csvRows = [];
    csvRows.push(fullHeaders.map(header => `"${header}"`).join(","));

    state.history.forEach(entry => {
        const rowData = [
            entry.id,
            entry.date,
            entry.exerciseName,
            entry.intensity || ""
        ];

        // Ensure dynamic cell validation strings step out safely into matching column indexes
        metricKeysArray.forEach(key => {
            const value = entry.data && entry.data[key] !== undefined ? entry.data[key] : "";
            rowData.push(value);
        });

        // Map values to strings, escaping quotations to maintain CSV structural layout rules
        const processedRow = rowData.map(val => {
            const strVal = String(val).replace(/"/g, '""');
            return `"${strVal}"`;
        });
        csvRows.push(processedRow.join(","));
    });

    // 4. Construct payload blob data stream and deploy via browser download trigger port
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csvRows.join("\n"));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", csvContent);
    downloadAnchor.setAttribute("download", `engineered_exercise_history.csv`);
    document.body.appendChild(downloadAnchor);
    
    downloadAnchor.click();
    downloadAnchor.remove();
}
