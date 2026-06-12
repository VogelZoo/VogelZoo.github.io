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

// --- NAVIGATION ---
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`nav-${viewId}`).classList.add('active');
    
    if (viewId === 'track') evaluateTodayPlans();
    if (viewId === 'plan') renderPlanList();
    if (viewId === 'stats') { populateChartFilter(); renderStats(); }
}

// --- CALENDAR & DRILL DOWN ---
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
        // Highlight if card matches what is typed into the date input box
        dayCard.className = `cal-day-card ${dateString === activeLogDate ? 'today' : ''}`;
        
        dayCard.onclick = () => {
            document.getElementById("log-date").value = dateString;
            evaluateTodayPlans();
        };

        let tagsHtml = dayTargets.map(t => `<span class="cal-event-tag">${t}</span>`).join("");
        if (dayTargets.length === 0) tagsHtml = `<span class="text-muted" style="font-size:0.65rem;">Rest</span>`;

        dayCard.innerHTML = `
            <div class="cal-day-title">${dayLabel}</div>
            <div class="text-muted" style="font-size:0.65rem;">${futureDate.getMonth()+1}/${futureDate.getDate()}</div>
            <div class="cal-day-events">${tagsHtml}</div>
        `;
        container.appendChild(dayCard);
    }
}

// --- EXERCISE DROPDOWN SORT ENGINE ---
function renderExerciseSelectors(priorityList = []) {
    const selectLog = document.getElementById("exercise-select");
    const selectPlan = document.getElementById("plan-exercise");
    
    // Sort logic: Alpha by Category, then Alpha by Name within Category
    let organizedExercises = [...state.exercises].sort((a, b) => {
        let catA = a.category || "Uncategorized";
        let catB = b.category || "Uncategorized";
        if (catA !== catB) return catA.localeCompare(catB);
        return a.name.localeCompare(b.name);
    });

    // Bubble scheduled options to the very top section grouped under priority rows
    let priorityOptions = [];
    let regularOptionsByGroup = {};

    organizedExercises.forEach(ex => {
        let cat = ex.category || "Uncategorized";
        if (priorityList.includes(ex.name)) {
            priorityOptions.push(`<option value="${ex.name}" style="font-weight:bold; color:#2563eb;">⭐ [${cat}] ${ex.name}</option>`);
        }
        if (!regularOptionsByGroup[cat]) regularOptionsByGroup[cat] = [];
        regularOptionsByGroup[cat].push(`<option value="${ex.name}">[${cat}] ${ex.name}</option>`);
    });

    let finalLogHtml = "";
    if (priorityOptions.length > 0) {
        finalLogHtml += `<optgroup label="⭐ Scheduled Options For Selected Date">` + priorityOptions.join("") + `</optgroup>`;
    }
    Object.entries(regularOptionsByGroup).forEach(([category, options]) => {
        finalLogHtml += `<optgroup label="${category}">` + options.join("") + `</optgroup>`;
    });

    selectLog.innerHTML = finalLogHtml;
    selectPlan.innerHTML = organizedExercises.map(ex => `<option value="${ex.name}">[${ex.category || 'General'}] ${ex.name}</option>`).join("");
    
    if (organizedExercises.length > 0) {
        buildDynamicFormFields(selectLog.value);
    }
}

function buildDynamicFormFields(exerciseName) {
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
        
        let placeholderVal = fieldMeta.placeholder;
        if (previousEntry && previousEntry.exerciseName === exerciseName && previousEntry.data[fieldKey] !== undefined) {
            placeholderVal = `Prev: ${previousEntry.data[fieldKey]}`;
        }

        div.innerHTML = `
            <label for="field-${fieldKey}">${fieldMeta.label}</label>
            <input type="${fieldMeta.type}" id="field-${fieldKey}" name="${fieldKey}" placeholder="${placeholderVal}" step="${fieldMeta.step}" inputmode="decimal" required>
        `;
        container.appendChild(div);
    });
}

function getPreviousEntry(exerciseName) {
    return state.history.find(entry => entry.exerciseName === exerciseName);
}

// --- PLAN VIEW DELINEATION RENDERING ---
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

    // Visual Delineation Blocks Loop (Mon -> Sun)
    const sortedDaysIndices = [1, 2, 3, 4, 5, 6, 0];
    sortedDaysIndices.forEach(dayIdx => {
        let dayPlans = weeklyPlans.filter(p => parseInt(p.day) === dayIdx);
        
        html += `
            <div class="plan-day-block">
                <div class="plan-day-block-title">${DAYS_LONG[dayIdx]}</div>
                ${dayPlans.length === 0 ? '<p class="text-muted" style="font-size:0.8rem; padding:0.25rem 0;">Rest Day</p>' : '<ul class="list-group">'}
                ${dayPlans.map(plan => `
                    <li class="list-group-item">
                        <span>💪 ${plan.exercise}</span>
                        <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button>
                    </li>
                `).join("")}
                ${dayPlans.length === 0 ? '' : '</ul>'}
            </div>
        `;
    });

    if (intervalPlans.length > 0) {
        intervalPlans.sort((a, b) => parseInt(a.interval) - parseInt(b.interval));
        html += `<div class="schedule-section-title">Interval Schedules (By Frequency)</div><div class="plan-day-block"><ul class="list-group">`;
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

function deletePlan(id) {
    state.plans = state.plans.filter(p => p.id !== id);
    saveState();
    renderPlanList();
    evaluateTodayPlans();
}

// --- NATIVE SVG ENGINE LIGHTWEIGHT GRAPHS ---
function populateChartFilter() {
    const filterSelect = document.getElementById("chart-exercise-select");
    if(state.exercises.length === 0) return;
    
    let currentSelection = filterSelect.value;
    filterSelect.innerHTML = state.exercises.map(e => `<option value="${e.name}">${e.name}</option>`).join("");
    if (currentSelection && state.exercises.some(e => e.name === currentSelection)) {
        filterSelect.value = currentSelection;
    }
}

function renderStats() {
    const summary = document.getElementById("stats-summary");
    const list = document.getElementById("history-list");
    const graphContainer = document.getElementById("graph-container");
    const targetExercise = document.getElementById("chart-exercise-select").value;

    if (state.history.length === 0) {
        summary.innerHTML = `<p class="text-muted">Complete your first log to start tracking metrics.</p>`;
        list.innerHTML = `<p class="text-muted">No history found.</p>`;
        graphContainer.innerHTML = "";
        return;
    }

    // Isolate historic array matching specific user exercise selections
    let exerciseHistory = state.history
        .filter(entry => entry.exerciseName === targetExercise)
        .sort((a, b) => new Date(a.date) - new Date(b.date)); // Chronological order for plotting

    if (exerciseHistory.length < 2) {
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding: 1rem; border:1px dashed var(--border); border-radius:8px;">Log at least 2 entries for "${targetExercise}" to draw progression charts.</p>`;
    } else {
        // Determine what metric axis lines to draw (weight -> distance -> duration parameters check)
        let sampleEntry = exerciseHistory[0].data;
        let chartMetricKey = Object.keys(sampleEntry).includes("weight") ? "weight" : 
                             Object.keys(sampleEntry).includes("distance") ? "distance" : 
                             Object.keys(sampleEntry).includes("timeSeconds") ? "timeSeconds" : "timeMinutes";

        let metricLabel = FIELD_LABELS[chartMetricKey].label;
        
        // Compute chart absolute scales
        let values = exerciseHistory.map(h => h.data[chartMetricKey]);
        let minVal = Math.min(...values) * 0.9; // add padding padding bottom boundaries
        let maxVal = Math.max(...values) * 1.1; // add padding padding top boundaries
        if(maxVal === minVal) { minVal -= 10; maxVal += 10; }
        let valRange = maxVal - minVal;

        // Plot resolution setup geometry
        const width = 400;
        const height = 180;
        const padding = 30;

        let points = exerciseHistory.map((entry, index) => {
            let x = padding + (index / (exerciseHistory.length - 1)) * (width - padding * 2);
            let y = (height - padding) - ((entry.data[chartMetricKey] - minVal) / valRange) * (height - padding * 2);
            return {x, y, date: entry.date, val: entry.data[chartMetricKey]};
        });

        let pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

        let dotsHtml = points.map(p => `
            <circle cx="${p.x}" cy="${p.y}" r="4" fill="#2563eb"/>
            <text x="${p.x}" y="${p.y - 8}" font-size="8" fill="#f3f4f6" text-anchor="middle">${p.val}</text>
        `).join("");

        graphContainer.innerHTML = `
            <div class="svg-chart-container">
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.25rem; text-align:center;">Progression: ${metricLabel}</div>
                <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                    <!-- Grid Axis Lines -->
                    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height-padding}" stroke="#374151" stroke-width="1"/>
                    <line x1="${padding}" y1="${height-padding}" x2="${width-padding}" y2="${height-padding}" stroke="#374151" stroke-width="1"/>
                    <!-- Trend Path Line -->
                    <path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <!-- Points overlay data items -->
                    ${dotsHtml}
                    <!-- X Axis Labels -->
                    <text x="${points[0].x}" y="${height-10}" font-size="8" fill="#9ca3af" text-anchor="start">${points[0].date.substring(5)}</text>
                    <text x="${points[points.length-1].x}" y="${height-10}" font-size="8" fill="#9ca3af" text-anchor="end">${points[points.length-1].date.substring(5)}</text>
                </svg>
            </div>
        `;
    }

    summary.innerHTML = `<p><strong>Total Lifetime Logs:</strong> ${state.history.length} sessions</p>`;
    
    // Print comprehensive global scrolling history records details block
    list.innerHTML = state.history.slice(0, 20).map(entry => {
        let dataString = Object.entries(entry.data).map(([key, val]) => {
            let label = key === 'timeSeconds' ? 's' : key === 'timeMinutes' ? 'm' : key === 'distance' ? 'mi' : key === 'weight' ? 'lbs' : ` ${key}`;
            return `${val}${label}`;
        }).join(" | ");

        let intensityBadge = entry.intensity ? `<span class="badge-intensity intensity-${entry.intensity}">${entry.intensity}</span>` : '';

        return `
            <li class="list-group-item">
                <span><strong>${entry.exerciseName}</strong>${intensityBadge}</span>
                <span class="text-muted">${dataString} <span class="badge">${entry.date}</span></span>
            </li>
        `;
    }).join("");
}

// --- EVENTS BINDING ROUTINES ---
function setupEventListeners() {
    // Dynamic Date Picker Change Interceptor Hook
    document.getElementById("log-date").value = new Date().toISOString().split('T')[0];
    document.getElementById("log-date").addEventListener("change", () => {
        evaluateTodayPlans();
    });

    document.getElementById("exercise-select").addEventListener("change", (e) => {
        buildDynamicFormFields(e.target.value);
    });

    document.getElementById("log-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const exerciseName = document.getElementById("exercise-select").value;
        const exercise = state.exercises.find(e => e.name === exerciseName);
        const selectedDate = document.getElementById("log-date").value;
        const intensity = document.getElementById("intensity-select").value;
        
        const formData = new FormData(e.target);
        let logData = {};
        
        exercise.metrics.forEach(fieldKey => {
            logData[fieldKey] = parseFloat(formData.get(fieldKey));
        });

        const newEntry = {
            id: Date.now(),
            date: selectedDate,
            exerciseName: exerciseName,
            intensity: intensity || null,
            data: logData
        };

        state.history.unshift(newEntry);
        state.history.sort((a,b) => new Date(b.date) - new Date(a.date));
        
        saveState();
        e.target.reset();
        
        // Keep inputs sticky to the date input value chosen by user instead of auto wiping
        document.getElementById("log-date").value = selectedDate;
        evaluateTodayPlans();
        alert(`Logged metric entry for ${exerciseName}!`);
    });

    document.getElementById("plan-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const type = document.getElementById("schedule-type").value;
        
        const newPlan = {
            id: Date.now(),
            exercise: document.getElementById("plan-exercise").value,
            type: type,
            day: type === 'weekly' ? document.getElementById("plan-day").value : null,
            interval: type === 'interval' ? document.getElementById("plan-interval").value : null,
            startDate: type === 'interval' ? document.getElementById("plan-start-date").value : null
        };

        state.plans.push(newPlan);
        saveState();
        renderPlanList();
        evaluateTodayPlans();
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
        e.target.reset();
        alert(`Created custom template for: ${name}`);
    });
}

function toggleScheduleInputs() {
    const type = document.getElementById("schedule-type").value;
    document.getElementById("weekly-inputs").classList.toggle("hidden", type !== "weekly");
    document.getElementById("interval-inputs").classList.toggle("hidden", type !== "interval");
}

// --- EXPORT/IMPORT PORTS ---
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
            alert("Error parsing backup formatting json template structure.");
        }
    };
    reader.readAsText(file);
}
