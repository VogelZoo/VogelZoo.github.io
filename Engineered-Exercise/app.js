// --- INITIAL STATE & DATA CONFIGS ---
const DEFAULT_EXERCISES = [
    { name: "Goblet Squat", metrics: ["sets", "reps", "weight"] },
    { name: "Bench Press", metrics: ["sets", "reps", "weight"] },
    { name: "One-Arm Row", metrics: ["sets", "reps", "weight"] },
    { name: "Plank", metrics: ["sets", "timeSeconds"] },
    { name: "Romanian Deadlift", metrics: ["sets", "reps", "weight"] },
    { name: "Seated Shoulder Press", metrics: ["sets", "reps", "weight"] },
    { name: "Reverse Lunge", metrics: ["sets", "reps", "weight"] },
    { name: "Side Plank", metrics: ["sets", "timeSeconds"] },
    { name: "Incline Dumbell Press", metrics: ["sets", "reps", "weight"] },
    { name: "Chest Supported Row", metrics: ["sets", "reps", "weight"] },
    { name: "Farmer Carry", metrics: ["sets", "weight", "timeSeconds"] },
    { name: "Running", metrics: ["distance", "timeMinutes"] },
    { name: "Walking", metrics: ["distance", "timeMinutes"] },
    { name: "Biking", metrics: ["distance", "timeMinutes"] },
    { name: "Yoga", metrics: ["timeMinutes"] }
    
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
    // Default log input picker to current local calendar date
    document.getElementById("log-date").value = new Date().toISOString().split('T')[0];
    initApp();
    setupEventListeners();
});

function initApp() {
    saveState();
    evaluateTodayPlans();
    renderPlanList();
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
    if (viewId === 'stats') renderStats();
}

// --- HORIZON & CORE ENGINE EVALUATION ---
function evaluateTodayPlans() {
    const today = new Date();
    
    // 1. Calculate Priority Tasks For Today specifically
    let todayTargets = getPlannedExercisesForDate(today);

    // Update Top Dashboard Display Widget Box
    const suggestionBox = document.getElementById("today-suggestion");
    if (todayTargets.length > 0) {
        suggestionBox.innerHTML = `<h3>Target Schedule Today</h3><p>🎯 ${todayTargets.join(", ")}</p>`;
        suggestionBox.classList.remove("hidden");
    } else {
        suggestionBox.innerHTML = `<h3>No routine explicitly scheduled for today</h3>`;
    }

    renderExerciseSelectors(todayTargets);
    render7DayHorizon(today);
}

// Helper to calculate matching planned configurations for any arbitrary date
function getPlannedExercisesForDate(targetDate) {
    const dayOfWeek = targetDate.getDay();
    let matches = [];

    state.plans.forEach(plan => {
        if (plan.type === 'weekly' && parseInt(plan.day) === dayOfWeek) {
            matches.push(plan.exercise);
        } else if (plan.type === 'interval') {
            const start = new Date(plan.startDate);
            start.setHours(0,0,0,0);
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

// --- RENDER 7-DAY HORIZON VIEW ---
function render7DayHorizon(baseDate) {
    const container = document.getElementById("calendar-horizon-view");
    container.innerHTML = "";

    for (let i = 0; i < 7; i++) {
        let futureDate = new Date(baseDate);
        futureDate.setDate(baseDate.getDate() + i);
        
        let dayTargets = getPlannedExercisesForDate(futureDate);
        let dayLabel = i === 0 ? "Today" : DAYS_SHORT[futureDate.getDay()];
        let dateString = futureDate.toISOString().split('T')[0];

        let dayCard = document.createElement("div");
        dayCard.className = `cal-day-card ${i === 0 ? 'today' : ''}`;
        
        // Tap to Quick-Load Target Action Plan Setup
        dayCard.onclick = () => {
            document.getElementById("log-date").value = dateString;
            renderExerciseSelectors(dayTargets);
            if(dayTargets.length > 0) {
                document.getElementById("exercise-select").value = dayTargets[0];
                buildDynamicFormFields(dayTargets[0]);
            }
        };

        dayCard.innerHTML = `
            <div class="cal-day-title">${dayLabel}</div>
            <div class="text-muted" style="font-size:0.65rem;">${futureDate.getMonth()+1}/${futureDate.getDate()}</div>
            <div class="cal-day-events" title="${dayTargets.join(', ')}">
                ${dayTargets.length > 0 ? dayTargets[0] + (dayTargets.length > 1 ? '+' : '') : '—'}
            </div>
        `;
        container.appendChild(dayCard);
    }
}

// --- GENERATE DROPDOWNS AND FORM METRICS ---
function renderExerciseSelectors(priorityList = []) {
    const selectLog = document.getElementById("exercise-select");
    const selectPlan = document.getElementById("plan-exercise");
    
    // Sort logic: matching schedules rise cleanly to top rows
    let sortedList = [...state.exercises].sort((a, b) => {
        let aPriority = priorityList.includes(a.name) ? 1 : 0;
        let bPriority = priorityList.includes(b.name) ? 1 : 0;
        return bPriority - aPriority; 
    });

    const optionsHTML = sortedList.map(ex => 
        `<option value="${ex.name}" ${priorityList.includes(ex.name) ? 'style="font-weight:bold; color:#2563eb;"' : ''}>${ex.name} ${priorityList.includes(ex.name) ? '⭐' : ''}</option>`
    ).join("");

    selectLog.innerHTML = optionsHTML;
    selectPlan.innerHTML = state.exercises.map(ex => `<option value="${ex.name}">${ex.name}</option>`).join("");
    
    if(sortedList.length > 0) {
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
        // Verify cross reference lookup stays isolated strictly to matching exercise context
        if (previousEntry && previousEntry.exerciseName === exerciseName && previousEntry.data[fieldKey] !== undefined) {
            placeholderVal = `Prev: ${previousEntry.data[fieldKey]}`;
        }

        div.innerHTML = `
            <label for="field-${fieldKey}">${fieldMeta.label}</label>
            <input type="${fieldMeta.type}" 
                   id="field-${fieldKey}" 
                   name="${fieldKey}" 
                   placeholder="${placeholderVal}" 
                   step="${fieldMeta.step}" 
                   inputmode="decimal" 
                   required>
        `;
        container.appendChild(div);
    });
}

function getPreviousEntry(exerciseName) {
    // Array scan isolation search matching name parameter validation cleanly
    return state.history.find(entry => entry.exerciseName === exerciseName);
}

// --- RENDER ORGANIZED TARGET SCHEDULES VIEW ---
function renderPlanList() {
    const container = document.getElementById("organized-plan-view");
    container.innerHTML = "";

    if (state.plans.length === 0) {
        container.innerHTML = `<p class="text-muted">No scheduled routines set up yet.</p>`;
        return;
    }

    // Split plan types tracking structural groupings
    let weeklyPlans = state.plans.filter(p => p.type === 'weekly');
    let intervalPlans = state.plans.filter(p => p.type === 'interval');

    // Sort Weekly arrays based on clear index days order logic (Monday -> Sunday)
    // Map Javascript calendar defaults adjustments cleanly: (1=Mon, 2=Tue... 6=Sat, 0=Sun)
    weeklyPlans.sort((a, b) => {
        let orderA = parseInt(a.day) === 0 ? 7 : parseInt(a.day);
        let orderB = parseInt(b.day) === 0 ? 7 : parseInt(b.day);
        return orderA - orderB;
    });

    // Sort Intervals arrays based explicitly on lowest interval configuration counts
    intervalPlans.sort((a, b) => parseInt(a.interval) - parseInt(b.interval));

    let html = "";

    if (weeklyPlans.length > 0) {
        html += `<div class="schedule-section-title">Weekly Routine</div><ul class="list-group">`;
        html += weeklyPlans.map(plan => `
            <li class="list-group-item">
                <div><strong>${DAYS_LONG[plan.day]}</strong>: ${plan.exercise}</div>
                <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button>
            </li>
        `).join("");
        html += `</ul>`;
    }

    if (intervalPlans.length > 0) {
        html += `<div class="schedule-section-title">Interval Training (Sorted by Frequency)</div><ul class="list-group">`;
        html += intervalPlans.map(plan => `
            <li class="list-group-item">
                <div><strong>Every ${plan.interval} Days</strong>: ${plan.exercise} <span class="text-muted" style="font-size:0.75rem;">(From ${plan.startDate})</span></div>
                <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button>
            </li>
        `).join("");
        html += `</ul>`;
    }

    container.innerHTML = html;
}

function deletePlan(id) {
    state.plans = state.plans.filter(p => p.id !== id);
    saveState();
    renderPlanList();
    evaluateTodayPlans();
}

// --- EVENT FORM ATTACHMENTS HANDLING ---
function setupEventListeners() {
    document.getElementById("exercise-select").addEventListener("change", (e) => {
        buildDynamicFormFields(e.target.value);
    });

    document.getElementById("log-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const exerciseName = document.getElementById("exercise-select").value;
        const exercise = state.exercises.find(e => e.name === exerciseName);
        const selectedDate = document.getElementById("log-date").value;
        
        const formData = new FormData(e.target);
        let logData = {};
        
        exercise.metrics.forEach(fieldKey => {
            logData[fieldKey] = parseFloat(formData.get(fieldKey));
        });

        const newEntry = {
            id: Date.now(),
            date: selectedDate, // Supports historic & future processing
            exerciseName: exerciseName,
            data: logData
        };

        state.history.unshift(newEntry);
        // Resort logs checklist descending by chronological dates entries validation
        state.history.sort((a,b) => new Date(b.date) - new Date(a.date));
        
        saveState();
        e.target.reset();
        document.getElementById("log-date").value = new Date().toISOString().split('T')[0];
        evaluateTodayPlans();
        alert(`Successfully logged metric entry for ${exerciseName}!`);
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

    // Dynamic Checkbox Parsing Setup
    document.getElementById("custom-exercise-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("new-ex-name").value.trim();
        
        // Extract selected checkbox metrics arrays values dynamically
        const checkedBoxes = e.target.querySelectorAll('input[name="metric"]:checked');
        let selectedMetrics = Array.from(checkedBoxes).map(cb => cb.value);

        if (selectedMetrics.length === 0) {
            alert("Please select at least one tracking metric checklist field.");
            return;
        }
        if (state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
            alert("This exercise name already exists.");
            return;
        }

        state.exercises.push({ name: name, metrics: selectedMetrics });
        saveState();
        renderExerciseSelectors();
        e.target.reset();
        alert(`Created dynamic custom template for: ${name}`);
    });
}

function toggleScheduleInputs() {
    const type = document.getElementById("schedule-type").value;
    document.getElementById("weekly-inputs").classList.toggle("hidden", type !== "weekly");
    document.getElementById("interval-inputs").classList.toggle("hidden", type !== "interval");
}

function renderStats() {
    const summary = document.getElementById("stats-summary");
    const list = document.getElementById("history-list");

    if (state.history.length === 0) {
        summary.innerHTML = `<p class="text-muted">Complete your first log to start tracking metrics.</p>`;
        list.innerHTML = `<p class="text-muted">No history found.</p>`;
        return;
    }

    summary.innerHTML = `<p><strong>Total Logged Sessions:</strong> ${state.history.length}</p>`;
    list.innerHTML = state.history.slice(0, 20).map(entry => {
        let dataString = Object.entries(entry.data).map(([key, val]) => {
            let label = key === 'timeSeconds' ? 's' : key === 'timeMinutes' ? 'm' : key === 'distance' ? 'mi' : key === 'weight' ? 'lbs' : ` ${key}`;
            return `${val}${label}`;
        }).join(" | ");

        return `
            <li class="list-group-item">
                <span><strong>${entry.exerciseName}</strong></span>
                <span class="text-muted">${dataString} <span class="badge">${entry.date}</span></span>
            </li>
        `;
    }).join("");
}

// --- BACKEND DATA PORTABILITY ---
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
                alert("Data metrics configuration imported successfully!");
            }
        } catch (err) {
            alert("Error parsing backup formatting structure JSON template.");
        }
    };
    reader.readAsText(file);
}
