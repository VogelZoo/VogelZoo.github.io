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
    "Light": "#4b5563",
    "Medium": "#d97706",
    "Heavy": "#dc2626",
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
        
        dayCard.onclick = () => {
            cancelFormEdit();
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
    selectPlan.innerHTML = organizedExercises.map(ex => `<option value="${ex.name}">[${ex.category || 'General'}] ${ex.name}</option>`).join("");
    
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
    document.getElementById("intensity-select").value = entry.intensity || "";
    
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

    const targetExercise = filterSelect.value;
    let exerciseHistory = [];

    if (targetExercise) {
        exerciseHistory = state.history
            .filter(entry => entry.exerciseName === targetExercise)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // Graph guard rails validation condition check
    if (!targetExercise || exerciseHistory.length < 2) {
        graphContainer.innerHTML = `<p class="text-muted" style="text-align:center; padding:1rem; border:1px dashed var(--border); border-radius:8px;">Select or complete an exercise with 2+ entries to unlock metric progression curves.</p>`;
        legendBlock.style.display = "none";
    } else {
        legendBlock.style.display = "flex";
        let sampleEntry = exerciseHistory[0].data;
        let chartMetricKey = Object.keys(sampleEntry).includes("weight") ? "weight" : 
                             Object.keys(sampleEntry).includes("distance") ? "distance" : 
                             Object.keys(sampleEntry).includes("timeSeconds") ? "timeSeconds" : "timeMinutes";

        let metricLabel = FIELD_LABELS[chartMetricKey].label;
        let values = exerciseHistory.map(h => h.data[chartMetricKey]);
        let minVal = Math.min(...values) * 0.9;
        let maxVal = Math.max(...values) * 1.1;
        if(maxVal === minVal) { minVal -= 10; maxVal += 10; }
        let valRange = maxVal - minVal;

        const width = 400;
        const height = 180;
        const padding = 30;

        let points = exerciseHistory.map((entry, index) => {
            let x = padding + (index / (exerciseHistory.length - 1)) * (width - padding * 2);
            let y = (height - padding) - ((entry.data[chartMetricKey] - minVal) / valRange) * (height - padding * 2);
            return {x, y, date: entry.date, val: entry.data[chartMetricKey], intensity: entry.intensity};
        });

        let pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

        let dotsHtml = points.map(p => {
            let dotColor = INTENSITY_COLORS[p.intensity] || INTENSITY_COLORS["Default"];
            return `
                <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${dotColor}" stroke="#1e1e24" stroke-width="1"/>
                <text x="${p.x}" y="${p.y - 8}" font-size="8" font-weight="bold" fill="#f3f4f6" text-anchor="middle">${p.val}</text>
            `;
        }).join("");

        graphContainer.innerHTML = `
            <div class="svg-chart-container">
                <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.25rem; text-align:center;">Progression Matrix: ${metricLabel}</div>
                <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%">
                    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height-padding}" stroke="#374151" stroke-width="1"/>
                    <line x1="${padding}" y1="${height-padding}" x2="${width-padding}" y2="${height-padding}" stroke="#374151" stroke-width="1"/>
                    <path d="${pathD}" fill="none" stroke="#374151" stroke-width="1.5" stroke-dasharray="3,3" stroke-linecap="round" stroke-linejoin="round"/>
                    ${dotsHtml}
                    <text x="${points[0].x}" y="${height-10}" font-size="8" fill="#9ca3af" text-anchor="start">${points[0].date.substring(5)}</text>
                    <text x="${points[points.length-1].x}" y="${height-10}" font-size="8" fill="#9ca3af" text-anchor="end">${points[points.length-1].date.substring(5)}</text>
                </svg>
            </div>
        `;
    }

    summary.innerHTML = `<p><strong>Total Lifetime Logs:</strong> ${state.history.length} sessions</p>`;

    // --- COMPACT GROUP BY DAY MAP COMPILATION ---
    let dailyGroups = {};
    state.history.forEach(entry => {
        if (!dailyGroups[entry.date]) dailyGroups[entry.date] = [];
        dailyGroups[entry.date].push(entry);
    });

    // Sort explicit key index clusters sequentially back descending
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
                                <div><strong>${item.exerciseName}</strong>${intBadge}<br><span class="text-muted" style="font-size:0.8rem;">${metricStr}</span></div>
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
        const intensity = document.getElementById("intensity-select").value;
        
        const formData = new FormData(e.target);
        let logData = {};
        
        exercise.metrics.forEach(fieldKey => {
            logData[fieldKey] = parseFloat(formData.get(fieldKey));
        });

        if (editingId) {
            // Processing updates on an existing configuration record node
            let index = state.history.findIndex(h => h.id === parseInt(editingId));
            if (index !== -1) {
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
        
        // Reset dynamic elements cleanly back to standard defaults tracking configurations
        cancelFormEdit();
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
