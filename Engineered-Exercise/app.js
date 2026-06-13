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

const INTENSITY_COLORS = {
    "Low": "#4b5563",
    "Medium": "#d97706",
    "High": "#dc2626",
    "Default": "#2563eb"
};

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
    renderManageExercises();
    renderStreakWidget();
}

function saveState() {
    localStorage.setItem("ee_exercises", JSON.stringify(state.exercises));
    localStorage.setItem("ee_history", JSON.stringify(state.history));
    localStorage.setItem("ee_plans", JSON.stringify(state.plans));
}

function getCategoryEmoji(category) {
    return categoryEmojis[category] || categoryEmojis['Default'];
}

// --- SYSTEM NAVIGATION ---
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`nav-${viewId}`).classList.add('active');
    
    if (viewId !== 'track') cancelFormEdit();
    if (viewId !== 'settings') cancelExerciseEdit();

    if (viewId === 'track') { evaluateTodayPlans(); renderStreakWidget(); }
    if (viewId === 'plan') renderPlanList();
    if (viewId === 'stats') { populateChartFilter(); renderStats(); }
    if (viewId === 'settings') renderManageExercises();
}

// --- CORE STREAK TRACKING ENGINE ---
function renderStreakWidget() {
    let trackSection = document.getElementById("view-track");
    let existingWidget = document.getElementById("streak-tracking-widget");
    if (existingWidget) existingWidget.remove();

    let currentStreak = calculateStreak();

    let widgetHtml = document.createElement("div");
    widgetHtml.id = "streak-tracking-widget";
    widgetHtml.className = "card streak-container";
    widgetHtml.innerHTML = `
        <div>
            <h3 style="margin-bottom: 0.15rem; color: #fff;">Consistency Streak</h3>
            <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0;">Logging active schedules & rest days</p>
        </div>
        <div class="streak-count">🔥 ${currentStreak} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">Days</span></div>
    `;
    trackSection.insertBefore(widgetHtml, trackSection.firstChild);
}

function calculateStreak() {
    let todayStr = new Date().toISOString().split('T')[0];
    let checkDate = new Date(todayStr + "T00:00:00");
    let streak = 0;

    // Build unique tracking map of logged historical event dates
    let historyDates = new Set(state.history.map(h => h.date));

    // Guard checking if any action occurred today or yesterday to continue loop validation
    let yesterdayStr = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];
    if (!historyDates.has(todayStr) && !historyDates.has(yesterdayStr)) {
        // If nothing logged today or yesterday, check if yesterday was an explicit scheduled plan rest day
        let yesterdayPlan = getPlannedExercisesForDate(new Date(new Date().setDate(new Date().getDate() - 1)));
        let yesterdayWasRest = (yesterdayPlan.length === 0 || isRestDayExplicitlyScheduled(new Date(new Date().setDate(new Date().getDate() - 1))));
        if (!yesterdayWasRest) return 0;
    }

    // Step backwards through time to count consecutive successful days
    for (let i = 0; i < 365; i++) {
        let loopDateStr = checkDate.toISOString().split('T')[0];
        let plannedExercises = getPlannedExercisesForDate(new Date(checkDate));
        let isRestDay = (plannedExercises.length === 0 || isRestDayExplicitlyScheduled(new Date(checkDate)));

        if (historyDates.has(loopDateStr) || isRestDay) {
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
    let dayOfWeek = targetDate.getDay();
    let explicitRest = false;

    state.plans.forEach(plan => {
        if (plan.exercise === "__rest__" && plan.type === 'weekly' && parseInt(plan.day) === dayOfWeek) {
            explicitRest = true;
        }
    });
    return explicitRest;
}

// --- INTERPOLATED ACTIVITY ENGINE & ADVANCED SCHEDULING ---
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
    let matches = [];
    let queryDate = new Date(targetDate);
    queryDate.setHours(0,0,0,0);

    // 1. Process weekly scheduled routines
    state.plans.forEach(plan => {
        if (plan.type === 'weekly' && plan.exercise !== "__rest__") {
            if (parseInt(plan.day) === queryDate.getDay()) {
                matches.push(plan.exercise);
            }
        }
    });

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

        let tagsHtml = dayTargets.map(t => `
            <span class="cal-event-tag" style="display: block; margin-top: 2px; word-break: break-word; font-size: 0.65rem;">
                ${t}
            </span>
        `).join("");
        
        if (dayTargets.length === 0 || isRestDayExplicitlyScheduled(futureDate)) {
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

// --- DROPDOWN ELEMENT SELECTOR INJECTIONS ---
function renderExerciseSelectors(priorityList = []) {
    const selectLog = document.getElementById("exercise-select");
    const selectPlan = document.getElementById("plan-exercise");
    if (!selectLog || !selectPlan) return;
    
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
    let planHtml = "";
    Object.entries(regularOptionsByGroup).forEach(([category, options]) => {
        planHtml += `<optgroup label="${category}">` + options.join("") + `</optgroup>`;
    });
    selectPlan.innerHTML = planHtml;
    
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

// --- CUSTOM INTERACTIVE DIALOG MODAL CONTROLLER ---
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
                <strong>${getCategoryEmoji(ex.category)} ${ex.name}</strong> ${countBadge}
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
    if (cancelBtn) {
        cancelBtn.remove();
        document.getElementById("exercise-action-buttons").style.gridTemplateColumns = "1fr";
    }
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

// --- HISTORICAL TRACK LOG EDIT PIPELINES ---
function initEditEntry(id) {
    const entry = state.history.find(h => h.id === id);
    if (!entry) return;

    switchView('track');

    document.getElementById("form-title").innerText = "Edit Historical Log";
    document.getElementById("edit-entry-id").value = entry.id;
    document.getElementById("log-date").value = entry.date;
    document.getElementById("log-intensity").value = entry.intensity || "";
    
    evaluateTodayPlans();
    document.getElementById("exercise-select").value = entry.exerciseName;
    
    buildDynamicFormFields(entry.exerciseName, entry.data);

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
function populateChartFilter() {
    const filterSelect = document.getElementById("chart-exercise-select");
    const wrapper = document.getElementById("chart-filter-wrapper");
    if (!filterSelect || !wrapper) return;
    
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
        if (legendBlock) legendBlock.style.display = "none";
        return;
    }

    const targetExercise = filterSelect.value;
    let exerciseHistory = [];

    if (targetExercise) {
        exerciseHistory = state.history
            .filter(entry => entry.exerciseName === targetExercise)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    if (!targetExercise || exerciseHistory.length < 2) {
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Select or complete an exercise with 2+ entries to view progression.</p>`;
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

        let points = calculatedData.map((d, idx) => {
            let x = paddingLeft + (idx / (calculatedData.length - 1)) * (width - paddingLeft - paddingRight);
            let yPri = (height - paddingBottom) - ((d.primary - minPri) / rangePri) * (height - paddingTop - paddingBottom);
            let ySec = hasSecondaryAxis ? ((height - paddingBottom) - ((d.secondary - minSec) / rangeSec) * (height - paddingTop - paddingBottom)) : 0;
            return { x, yPri, ySec, ...d };
        });

        let primaryLinePath = `M ${points[0].x} ${points[0].yPri} ` + points.slice(1).map(p => `L ${p.x} ${p.yPri}`).join(" ");
        let secondaryLinePath = hasSecondaryAxis ? (`M ${points[0].x} ${points[0].ySec} ` + points.slice(1).map(p => `L ${p.x} ${p.ySec}`).join(" ")) : "";

        let primaryDots = points.map(p => {
            let color = INTENSITY_COLORS[p.intensity] || INTENSITY_COLORS["Default"];
            return `
                <circle cx="${p.x}" cy="${p.yPri}" r="4" fill="${color}" stroke="#1e1e24" stroke-width="1"/>
                <text x="${p.x}" y="${p.yPri - 6}" font-size="7" font-weight="bold" fill="#f3f4f6" text-anchor="middle">${p.primary}</text>
            `;
        }).join("");

        let secondaryDots = hasSecondaryAxis ? points.map(p => `
            <circle cx="${p.x}" cy="${p.ySec}" r="3.5" fill="#10b981" stroke="#1e1e24" stroke-width="1"/>
            <text x="${p.x}" y="${p.ySec + 11}" font-size="7" font-weight="bold" fill="#10b981" text-anchor="middle">${p.secondary}</text>
        `).join("") : "";

        let secondaryAxisHtml = hasSecondaryAxis ? `
            <line x1="${width - paddingRight}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="#10b981" stroke-width="1" stroke-opacity="0.5"/>
            <text x="${width - paddingRight + 5}" y="${paddingTop - 10}" font-size="8" fill="#10b981" text-anchor="end">${secondaryMetricLabel}</text>
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

                    <text x="${points[0].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="start">${points[0].date.substring(5)}</text>
                    <text x="${points[points.length - 1].x}" y="${height - 8}" font-size="7" fill="#9ca3af" text-anchor="end">${points[points.length - 1].date.substring(5)}</text>
                </svg>
            </div>
        `;
    }

    summary.innerHTML = `<p><strong>Total Lifetime Logs:</strong> ${state.history.length} sessions</p>`;

    // --- COMPACT GROUP BY DAY TIMELINE COMPILATION ---
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

        return `
            <div class="history-day-block">
                <div class="history-day-block-title">${dayHeaderLabel}</div>
                <ul class="list-group">
                    ${dayItems.map(item => {
                        let metricStr = Object.entries(item.data).map(([k, v]) => {
                            let unit = k === 'timeSeconds' ? 's' : k === 'timeMinutes' ? 'm' : k === 'distance' ? 'mi' : k === 'weight' ? 'lbs' : ` ${k}`;
                            return `${v}${unit}`;
                        }).join(" | ");

                        let intBadge = item.intensity ? `<span class="badge-intensity intensity-${item.intensity}">${item.intensity}</span>` : '';

                        return `
                            <li class="list-group-item">
                                <div><strong>${getCategoryEmoji(state.exercises.find(e => e.name === item.exerciseName)?.category)} ${item.exerciseName}</strong>${intBadge}<br><span class="text-muted" style="font-size:0.8rem;">${metricStr}</span></div>
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
}

// --- APP EVENT LISTENER ATTACHMENTS ---
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
            logData[fieldKey] = parseFloat(formData.get(fieldKey)) || 0;
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
        cancelFormEdit();
        initApp();
    });

    document.getElementById("plan-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const type = document.getElementById("schedule-type").value;
        const restToggle = document.getElementById("plan-rest-toggle");
        const isRest = restToggle && restToggle.checked;

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

        if (editIdxStr !== "") {
            // Processing structural template update updates
            let idx = parseInt(editIdxStr);
            let oldName = state.exercises[idx].name;

            // Retain historical logging sync maps across downstream children logs if name changed
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

            state.exercises[idx] = { name, category, metrics: selectedMetrics };
            alert("Exercise configuration template updated successfully!");
        } else {
            // Standard creation appending routine
            if (state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
                alert("This exercise name already exists.");
                return;
            }
            state.exercises.push({ name: name, category: category, metrics: selectedMetrics });
            alert(`Created custom template for: ${name}`);
        }

        saveState();
        cancelExerciseEdit();
        initApp();
    });
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

    const sortedDaysIndices = [1, 2, 3, 4, 5, 6, 0];
    sortedDaysIndices.forEach(dayIdx => {
        let dayPlans = weeklyPlans.filter(p => parseInt(p.day) === dayIdx);
        
        html += `
            <div class="plan-day-block">
                <div class="plan-day-block-title">${DAYS_LONG[dayIdx]}</div>
                ${(() => {
                    const restPlan = dayPlans.find(p => p.exercise === "__rest__");
                    const exPlans = dayPlans.filter(p => p.exercise !== "__rest__");
                    let h = "";
                    if (restPlan) h += `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0;font-size:0.85rem;"><span>Rest Day</span><button onclick="deletePlan(${restPlan.id})" class="badge" style="background:#4b5563;border:none;color:white;cursor:pointer;">X</button></div>`;
                    if (!restPlan && exPlans.length === 0) h += '<p class="text-muted" style="font-size:0.8rem;padding:0.25rem 0;">—</p>';
                    if (exPlans.length > 0) h += '<ul class="list-group">' + exPlans.map(plan => `<li class="list-group-item"><span>${plan.exercise}</span><button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626;border:none;color:white;cursor:pointer;">X</button></li>`).join("") + '</ul>';
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

function exportCSV() {
    if (state.history.length === 0) {
        alert("No historical workout log entries found to export.");
        return;
    }

    const allMetricKeys = new Set();
    state.history.forEach(entry => {
        if (entry.data) {
            Object.keys(entry.data).forEach(key => allMetricKeys.add(key));
        }
    });
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

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csvRows.join("\n"));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", csvContent);
    downloadAnchor.setAttribute("download", `engineered_exercise_history.csv`);
    document.body.appendChild(downloadAnchor);
    
    downloadAnchor.click();
    downloadAnchor.remove();
}
