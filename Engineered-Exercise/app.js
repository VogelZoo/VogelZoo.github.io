// --- INITIAL STATE & DATA TEMPLATES ---
const DEFAULT_EXERCISES = [
    { name: "Squat", template: "strength" },
    { name: "Plank", template: "duration-reps" },
    { name: "Running", template: "cardio" },
    { name: "Walking", template: "cardio" },
    { name: "Biking", template: "cardio" },
    { name: "Yoga", template: "yoga" },
    { name: "Farmer Carry", template: "hybrid" }
];

const TEMPLATES = {
    "strength": ["sets", "reps", "weight"],
    "duration-reps": ["sets", "timeSeconds"],
    "cardio": ["distance", "timeMinutes"],
    "yoga": ["timeMinutes"],
    "hybrid": ["sets", "weight", "timeSeconds"]
};

const FIELD_LABELS = {
    sets: { label: "Sets", type: "number", placeholder: "0", step: "1" },
    reps: { label: "Reps", type: "number", placeholder: "0", step: "1" },
    weight: { label: "Weight (lbs)", type: "number", placeholder: "0.0", step: "0.5" },
    timeSeconds: { label: "Time (Seconds)", type: "number", placeholder: "60", step: "1" },
    timeMinutes: { label: "Time (Minutes)", type: "number", placeholder: "30", step: "1" },
    distance: { label: "Distance (miles)", type: "number", placeholder: "0.00", step: "0.01" }
};

let state = {
    exercises: JSON.parse(localStorage.getItem("ee_exercises")) || DEFAULT_EXERCISES,
    history: JSON.parse(localStorage.getItem("ee_history")) || [],
    plans: JSON.parse(localStorage.getItem("ee_plans")) || []
};

// --- CORE APP INIT ---
document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    saveState();
    renderExerciseSelectors();
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
    if (viewId === 'stats') renderStats();
}

// --- SCHEDULING LOGIC ---
function evaluateTodayPlans() {
    const today = new Date();
    const todayDayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    let priorityExercises = [];
    
    state.plans.forEach(plan => {
        if (plan.type === 'weekly' && parseInt(plan.day) === todayDayOfWeek) {
            priorityExercises.push(plan.exercise);
        } else if (plan.type === 'interval') {
            const start = new Date(plan.startDate);
            // Reset hours to accurately compute days diff
            start.setHours(0,0,0,0);
            const current = new Date(today);
            current.setHours(0,0,0,0);
            
            const diffTime = current - start;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0 && diffDays % parseInt(plan.interval) === 0) {
                priorityExercises.push(plan.exercise);
            }
        }
    });

    // Update Top Alert Box
    const suggestionBox = document.getElementById("today-suggestion");
    if (priorityExercises.length > 0) {
        suggestionBox.innerHTML = `<h3>Today's Target Plan</h3><p>🎯 ${priorityExercises.join(", ")}</p>`;
        suggestionBox.classList.remove("hidden");
    } else {
        suggestionBox.innerHTML = `<h3>No explicit plan scheduled for today. Keep building momentum!</h3>`;
    }

    renderExerciseSelectors(priorityExercises);
}

// --- RENDER INPUT FIELDS & DROPDOWNS ---
function renderExerciseSelectors(priorityList = []) {
    const selectLog = document.getElementById("exercise-select");
    const selectPlan = document.getElementById("plan-exercise");
    
    // Sort logic: priority targets come first
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
    
    // Fire event to draw fields for whatever exercise landed on top
    if(sortedList.length > 0) {
        buildDynamicFormFields(sortedList[0].name);
    }
}

function buildDynamicFormFields(exerciseName) {
    const container = document.getElementById("dynamic-fields-container");
    container.innerHTML = "";
    
    const exercise = state.exercises.find(e => e.name === exerciseName);
    if (!exercise) return;

    const fields = TEMPLATES[exercise.template];
    const previousEntry = getPreviousEntry(exerciseName);

    fields.forEach(fieldKey => {
        const fieldMeta = FIELD_LABELS[fieldKey];
        const div = document.createElement("div");
        div.className = "form-group";
        
        // Pick previous value as placeholder baseline if it exists
        let placeholderVal = fieldMeta.placeholder;
        if (previousEntry && previousEntry.data[fieldKey] !== undefined) {
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
    return state.history.find(entry => entry.exerciseName === exerciseName);
}

// --- EVENT HANDLERS ---
function setupEventListeners() {
    // Dynamic Input Swapping
    document.getElementById("exercise-select").addEventListener("change", (e) => {
        buildDynamicFormFields(e.target.value);
    });

    // Logging Form Submission
    document.getElementById("log-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const exerciseName = document.getElementById("exercise-select").value;
        const exercise = state.exercises.find(e => e.name === exerciseName);
        
        const formData = new FormData(e.target);
        let logData = {};
        
        TEMPLATES[exercise.template].forEach(fieldKey => {
            logData[fieldKey] = parseFloat(formData.get(fieldKey));
        });

        const newEntry = {
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            exerciseName: exerciseName,
            data: logData
        };

        state.history.unshift(newEntry); // Newest first
        saveState();
        e.target.reset();
        buildDynamicFormFields(exerciseName); // Re-render to refresh placeholders
        alert(`Logged entry for ${exerciseName}!`);
    });

    // Plan Form Submission
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

    // Custom Exercise Creation
    document.getElementById("custom-exercise-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("new-ex-name").value.trim();
        const template = document.getElementById("new-ex-template").value;

        if (state.exercises.some(ex => ex.name.toLowerCase() === name.toLowerCase())) {
            alert("This exercise name already exists.");
            return;
        }

        state.exercises.push({ name, template });
        saveState();
        renderExerciseSelectors();
        e.target.reset();
        alert(`Created custom exercise: ${name}`);
    });
}

function toggleScheduleInputs() {
    const type = document.getElementById("schedule-type").value;
    document.getElementById("weekly-inputs").classList.toggle("hidden", type !== "weekly");
    document.getElementById("interval-inputs").classList.toggle("hidden", type !== "interval");
}

// --- UI RENDERING (PLANS & STATS) ---
function renderPlanList() {
    const list = document.getElementById("plan-list");
    if(state.plans.length === 0) {
        list.innerHTML = `<p class="text-muted">No scheduled routines set up yet.</p>`;
        return;
    }

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    list.innerHTML = state.plans.map(plan => {
        let scheduleText = plan.type === 'weekly' ? `Every ${days[plan.day]}` : `Every ${plan.interval} days (from ${plan.startDate})`;
        return `
            <li class="list-group-item">
                <div>
                    <strong>${plan.exercise}</strong> <br>
                    <span class="text-muted">${scheduleText}</span>
                </div>
                <button onclick="deletePlan(${plan.id})" class="badge" style="background:#dc2626; border:none; color:white; cursor:pointer;">X</button>
            </li>
        `;
    }).join("");
}

function deletePlan(id) {
    state.plans = state.plans.filter(p => p.id !== id);
    saveState();
    renderPlanList();
    evaluateTodayPlans();
}

function renderStats() {
    const summary = document.getElementById("stats-summary");
    const list = document.getElementById("history-list");

    if (state.history.length === 0) {
        summary.innerHTML = `<p class="text-muted">Complete your first log to start tracking metrics.</p>`;
        list.innerHTML = `<p class="text-muted">No history found.</p>`;
        return;
    }

    summary.innerHTML = `
        <p><strong>Total Logged Sessions:</strong> ${state.history.length}</p>
        <p class="text-muted">Consistent tracking builds clear performance patterns here.</p>
    `;

    list.innerHTML = state.history.slice(0, 15).map(entry => {
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

// --- IMPORT & EXPORT UTILITIES ---
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `engineered_exercise_backup_${new Date().toISOString().split('T')[0]}.json`);
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
            if (importedState.history && importedState.exercises && importedState.plans) {
                state = importedState;
                saveState();
                initApp();
                alert("Data configuration successfully imported!");
            } else {
                alert("Invalid format template. Ensure file is a correct backup file.");
            }
        } catch (err) {
            alert("Error reading file parsing JSON. Please double-check file cleanliness.");
        }
    };
    reader.readAsText(file);
}
