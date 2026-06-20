// =============================================================================
// Engineered Exercise — Backup & Sync Module
// =============================================================================
// Handles automatic backup of state (ee_exercises, ee_history, ee_plans) to
// one of three providers: On Device (File System Access API), Google Drive
// (appDataFolder), or Dropbox (app-folder scope).
//
// Public surface used by app.js / index.html:
//   - BackupSync.init()                 call once on DOMContentLoaded
//   - BackupSync.notifyStateChanged()   call after every saveState()
//   - BackupSync.openSettingsPanel()    "Change Backup Location" button target
//
// Everything here is additive — if a user never sets up a backup target, this
// module is a no-op and the app behaves exactly as it did before.
// =============================================================================

const BackupSync = (() => {

    // --- CONFIG: fill these in with your own registered app credentials ----
    // Google Cloud Console > APIs & Services > Credentials > OAuth Client ID
    // (type: Web application). Add your GitHub Pages origin to "Authorized
    // JavaScript origins" and oauth-callback.html's full URL to "Authorized
    // redirect URIs".
    const GOOGLE_CLIENT_ID = "36630807511-gt7hamltvic0l9lslrov9q998r56f4c0.apps.googleusercontent.com";

    // Dropbox App Console > Create App > Scoped access > App folder.
    // Add oauth-callback.html's full URL under "Redirect URIs".
    const DROPBOX_APP_KEY = "YOUR_DROPBOX_APP_KEY_HERE";

    // Must exactly match what's registered in both consoles above.
    const OAUTH_REDIRECT_URI = new URL("oauth-callback.html", window.location.href).toString();

    const DRIVE_BACKUP_FILENAME = "engineered_exercise_backup.json";
    const DROPBOX_BACKUP_PATH = "/backup.json"; // relative to the app folder

    // --- INTERNAL STATE ------------------------------------------------------
    const LS_KEYS = {
        provider: "ee_backup_provider",       // "ondevice" | "drive" | "dropbox" | null
        driveFileId: "ee_backup_drive_file_id",
        dropboxToken: "ee_backup_dropbox_token",       // {access_token, refresh_token, expires_at}
        googleToken: "ee_backup_google_token",         // {access_token, expires_at}
        lastSyncedAt: "ee_backup_last_synced_at",      // ISO timestamp of last successful sync
        setupComplete: "ee_backup_setup_complete"      // "1" once the user has chosen (even if "skip")
    };

    let dbPromise = null;        // IndexedDB handle, used to store the on-device FileSystemFileHandle
    let pendingSaveTimer = null; // debounce timer for auto-save
    let syncBadgeEl = null;
    let isSyncing = false;
    let dirtySinceLastSync = false;

    // -------------------------------------------------------------------------
    // IndexedDB — the only place a FileSystemFileHandle can be persisted.
    // (Handles aren't JSON-serializable, so localStorage can't hold them.)
    // -------------------------------------------------------------------------
    function getDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open("ee_backup_db", 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore("handles");
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function idbGet(key) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readonly");
            const req = tx.objectStore("handles").get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbSet(key, value) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            tx.objectStore("handles").put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbDelete(key) {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("handles", "readwrite");
            tx.objectStore("handles").delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // -------------------------------------------------------------------------
    // Small helpers
    // -------------------------------------------------------------------------
    function supportsFileSystemAccess() {
        return "showSaveFilePicker" in window && "showOpenFilePicker" in window;
    }

    function getProvider() {
        return localStorage.getItem(LS_KEYS.provider);
    }

    function setProvider(p) {
        if (p) localStorage.setItem(LS_KEYS.provider, p);
        else localStorage.removeItem(LS_KEYS.provider);
    }

    function getCurrentStateSnapshot() {
        // Mirrors the exact shape app.js's `state` object uses.
        return {
            exercises: JSON.parse(localStorage.getItem("ee_exercises")) || [],
            history: JSON.parse(localStorage.getItem("ee_history")) || [],
            plans: JSON.parse(localStorage.getItem("ee_plans")) || []
        };
    }

    function applyStateSnapshot(snapshot) {
        if (!snapshot || !snapshot.history || !snapshot.exercises) return false;
        localStorage.setItem("ee_exercises", JSON.stringify(snapshot.exercises));
        localStorage.setItem("ee_history", JSON.stringify(snapshot.history));
        localStorage.setItem("ee_plans", JSON.stringify(snapshot.plans || []));
        // Reload in-memory state + re-render everything, if app.js's globals exist.
        if (typeof state !== "undefined") {
            state.exercises = snapshot.exercises;
            state.history = snapshot.history;
            state.plans = snapshot.plans || [];
        }
        if (typeof initApp === "function") initApp();
        return true;
    }

    // -------------------------------------------------------------------------
    // Merge logic: union of history entries by id, newest-wins on exercises/plans.
    // "Newest" for exercises/plans is approximated by array position from each
    // source — since neither has a reliable per-record timestamp, we trust
    // whichever snapshot is more recently synced (passed in as `remoteIsNewer`)
    // for collisions, and always union by identity otherwise.
    // -------------------------------------------------------------------------
    function mergeSnapshots(local, remote, remoteIsNewer) {
        // History: union by id. If the same id exists in both (shouldn't
        // normally happen since ids are Date.now()), prefer whichever
        // snapshot is considered newer.
        const historyById = new Map();
        const olderHistory = remoteIsNewer ? local.history : remote.history;
        const newerHistory = remoteIsNewer ? remote.history : local.history;
        (olderHistory || []).forEach(h => historyById.set(h.id, h));
        (newerHistory || []).forEach(h => historyById.set(h.id, h)); // overwrites on collision
        const mergedHistory = Array.from(historyById.values()).sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return (a.id || 0) - (b.id || 0);
        });

        // Exercises: union by name (case-insensitive), newer snapshot wins on conflict.
        const exByName = new Map();
        const olderEx = remoteIsNewer ? local.exercises : remote.exercises;
        const newerEx = remoteIsNewer ? remote.exercises : local.exercises;
        (olderEx || []).forEach(e => exByName.set(e.name.toLowerCase(), e));
        (newerEx || []).forEach(e => exByName.set(e.name.toLowerCase(), e));
        const mergedExercises = Array.from(exByName.values());

        // Plans: union by id, newer snapshot wins on collision.
        const plansById = new Map();
        const olderPlans = remoteIsNewer ? local.plans : remote.plans;
        const newerPlans = remoteIsNewer ? remote.plans : local.plans;
        (olderPlans || []).forEach(p => plansById.set(p.id, p));
        (newerPlans || []).forEach(p => plansById.set(p.id, p));
        const mergedPlans = Array.from(plansById.values());

        return { exercises: mergedExercises, history: mergedHistory, plans: mergedPlans };
    }

    // -------------------------------------------------------------------------
    // Sync status badge (small persistent indicator shown only while unsynced)
    // -------------------------------------------------------------------------
    function ensureBadge() {
        if (syncBadgeEl) return syncBadgeEl;
        const header = document.querySelector("header");
        if (!header) return null;
        const badge = document.createElement("div");
        badge.id = "backup-sync-badge";
        badge.style.cssText = `
            position: fixed; bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px));
            right: 1rem; z-index: 400; background: #dc2626; color: #fff;
            font-size: 0.72rem; font-weight: 600; padding: 0.4rem 0.7rem;
            border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            display: none; align-items: center; gap: 0.35rem; cursor: pointer;
        `;
        badge.innerHTML = `<span>⚠️</span><span id="backup-sync-badge-text">Not synced</span>`;
        badge.onclick = () => { trySync(true); };
        document.body.appendChild(badge);
        syncBadgeEl = badge;
        return badge;
    }

    function showBadge(text) {
        const badge = ensureBadge();
        if (!badge) return;
        document.getElementById("backup-sync-badge-text").textContent = text;
        badge.style.display = "flex";
    }

    function hideBadge() {
        if (syncBadgeEl) syncBadgeEl.style.display = "none";
    }

    // -------------------------------------------------------------------------
    // PROVIDER: On Device (File System Access API)
    // -------------------------------------------------------------------------
    const OnDevice = {
        async chooseNewFile() {
            const handle = await window.showSaveFilePicker({
                suggestedName: "engineered_exercise_backup.json",
                types: [{ description: "JSON Backup", accept: { "application/json": [".json"] } }]
            });
            await idbSet("ondevice_handle", handle);
            return handle;
        },

        async chooseExistingFile() {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: "JSON Backup", accept: { "application/json": [".json"] } }]
            });
            await idbSet("ondevice_handle", handle);
            return handle;
        },

        async getHandle() {
            return await idbGet("ondevice_handle");
        },

        async verifyPermission(handle, forWriting) {
            const opts = forWriting ? { mode: "readwrite" } : {};
            if ((await handle.queryPermission(opts)) === "granted") return true;
            if ((await handle.requestPermission(opts)) === "granted") return true;
            return false;
        },

        async readBackup() {
            const handle = await this.getHandle();
            if (!handle) throw new Error("No file handle stored.");
            if (!(await this.verifyPermission(handle, false))) throw new Error("Permission denied.");
            const file = await handle.getFile();
            const text = await file.text();
            if (!text.trim()) return null; // empty/new file
            return JSON.parse(text);
        },

        async writeBackup(snapshot) {
            const handle = await this.getHandle();
            if (!handle) throw new Error("No file handle stored.");
            if (!(await this.verifyPermission(handle, true))) throw new Error("Permission denied.");
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(snapshot, null, 2));
            await writable.close();
        },

        async clear() {
            await idbDelete("ondevice_handle");
        }
    };

    // -------------------------------------------------------------------------
    // PROVIDER: Google Drive (appDataFolder, hidden from normal Drive UI)
    // -------------------------------------------------------------------------
    const GoogleDrive = {
        SCOPE: "https://www.googleapis.com/auth/drive.appdata",

        loadGis() {
            return new Promise((resolve, reject) => {
                if (window.google && window.google.accounts) return resolve();
                const script = document.createElement("script");
                script.src = "https://accounts.google.com/gsi/client";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
                document.head.appendChild(script);
            });
        },

        getStoredToken() {
            const raw = localStorage.getItem(LS_KEYS.googleToken);
            if (!raw) return null;
            const token = JSON.parse(raw);
            if (token.expires_at && Date.now() > token.expires_at - 60000) return null; // expired/expiring
            return token;
        },

        async getAccessToken(interactive) {
            const existing = this.getStoredToken();
            if (existing) return existing.access_token;
            if (!interactive) throw new Error("No valid token and not allowed to prompt interactively.");

            await this.loadGis();
            return new Promise((resolve, reject) => {
                const client = google.accounts.oauth2.initTokenClient({
                    client_id: GOOGLE_CLIENT_ID,
                    scope: this.SCOPE,
                    callback: (resp) => {
                        if (resp.error) return reject(new Error(resp.error));
                        const token = {
                            access_token: resp.access_token,
                            expires_at: Date.now() + (resp.expires_in * 1000)
                        };
                        localStorage.setItem(LS_KEYS.googleToken, JSON.stringify(token));
                        resolve(resp.access_token);
                    }
                });
                client.requestAccessToken();
            });
        },

        async findExistingFileId(accessToken) {
            const res = await fetch(
                `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
            const data = await res.json();
            const match = (data.files || []).find(f => f.name === DRIVE_BACKUP_FILENAME);
            return match ? match.id : null;
        },

        async readBackup() {
            const accessToken = await this.getAccessToken(false);
            let fileId = localStorage.getItem(LS_KEYS.driveFileId);
            if (!fileId) {
                fileId = await this.findExistingFileId(accessToken);
                if (fileId) localStorage.setItem(LS_KEYS.driveFileId, fileId);
            }
            if (!fileId) return null;

            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (res.status === 404) { localStorage.removeItem(LS_KEYS.driveFileId); return null; }
            if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
            const text = await res.text();
            return text.trim() ? JSON.parse(text) : null;
        },

        async writeBackup(snapshot) {
            const accessToken = await this.getAccessToken(false);
            let fileId = localStorage.getItem(LS_KEYS.driveFileId);
            if (!fileId) fileId = await this.findExistingFileId(accessToken);

            const body = JSON.stringify(snapshot, null, 2);
            const metadata = { name: DRIVE_BACKUP_FILENAME, parents: ["appDataFolder"] };

            if (fileId) {
                const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body
                });
                if (!res.ok) throw new Error(`Drive write failed: ${res.status}`);
            } else {
                const form = new FormData();
                form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
                form.append("file", new Blob([body], { type: "application/json" }));
                const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}` },
                    body: form
                });
                if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
                const data = await res.json();
                localStorage.setItem(LS_KEYS.driveFileId, data.id);
            }
        },

        async setupInteractive() {
            await this.getAccessToken(true); // forces the consent prompt
        },

        clear() {
            localStorage.removeItem(LS_KEYS.googleToken);
            localStorage.removeItem(LS_KEYS.driveFileId);
        }
    };

    // -------------------------------------------------------------------------
    // PROVIDER: Dropbox (PKCE OAuth, app-folder scope)
    // -------------------------------------------------------------------------
    const Dropbox = {
        async sha256Base64Url(input) {
            const data = new TextEncoder().encode(input);
            const digest = await crypto.subtle.digest("SHA-256", data);
            const bytes = new Uint8Array(digest);
            let str = "";
            bytes.forEach(b => str += String.fromCharCode(b));
            return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        },

        randomVerifier() {
            const arr = new Uint8Array(32);
            crypto.getRandomValues(arr);
            return Array.from(arr, b => ("0" + b.toString(16)).slice(-2)).join("");
        },

        async beginAuth() {
            const verifier = this.randomVerifier();
            const challenge = await this.sha256Base64Url(verifier);
            sessionStorage.setItem("ee_dropbox_pkce_verifier", verifier);

            const params = new URLSearchParams({
                client_id: DROPBOX_APP_KEY,
                response_type: "code",
                code_challenge: challenge,
                code_challenge_method: "S256",
                redirect_uri: OAUTH_REDIRECT_URI,
                token_access_type: "offline",
                state: "dropbox"
            });
            window.location.href = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
        },

        async exchangeCodeForToken(code) {
            const verifier = sessionStorage.getItem("ee_dropbox_pkce_verifier");
            const params = new URLSearchParams({
                code,
                grant_type: "authorization_code",
                client_id: DROPBOX_APP_KEY,
                code_verifier: verifier,
                redirect_uri: OAUTH_REDIRECT_URI
            });
            const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString()
            });
            if (!res.ok) throw new Error(`Dropbox token exchange failed: ${res.status}`);
            const data = await res.json();
            this.storeToken(data);
        },

        storeToken(data) {
            const token = {
                access_token: data.access_token,
                refresh_token: data.refresh_token || (this.getStoredToken() || {}).refresh_token,
                expires_at: Date.now() + (data.expires_in * 1000)
            };
            localStorage.setItem(LS_KEYS.dropboxToken, JSON.stringify(token));
        },

        getStoredToken() {
            const raw = localStorage.getItem(LS_KEYS.dropboxToken);
            return raw ? JSON.parse(raw) : null;
        },

        async refreshAccessToken() {
            const stored = this.getStoredToken();
            if (!stored || !stored.refresh_token) throw new Error("No Dropbox refresh token available.");
            const params = new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: stored.refresh_token,
                client_id: DROPBOX_APP_KEY
            });
            const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString()
            });
            if (!res.ok) throw new Error(`Dropbox refresh failed: ${res.status}`);
            const data = await res.json();
            this.storeToken(data);
            return this.getStoredToken().access_token;
        },

        async getAccessToken() {
            const stored = this.getStoredToken();
            if (!stored) throw new Error("Not authenticated with Dropbox.");
            if (stored.expires_at && Date.now() > stored.expires_at - 60000) {
                return await this.refreshAccessToken();
            }
            return stored.access_token;
        },

        async readBackup() {
            const accessToken = await this.getAccessToken();
            const res = await fetch("https://content.dropboxapi.com/2/files/download", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_BACKUP_PATH })
                }
            });
            if (res.status === 409) return null; // path not found yet
            if (!res.ok) throw new Error(`Dropbox read failed: ${res.status}`);
            const text = await res.text();
            return text.trim() ? JSON.parse(text) : null;
        },

        async writeBackup(snapshot) {
            const accessToken = await this.getAccessToken();
            const body = JSON.stringify(snapshot, null, 2);
            const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/octet-stream",
                    "Dropbox-API-Arg": JSON.stringify({
                        path: DROPBOX_BACKUP_PATH,
                        mode: "overwrite",
                        mute: true
                    })
                },
                body
            });
            if (!res.ok) throw new Error(`Dropbox write failed: ${res.status}`);
        },

        clear() {
            localStorage.removeItem(LS_KEYS.dropboxToken);
        }
    };

    // -------------------------------------------------------------------------
    // Provider dispatch
    // -------------------------------------------------------------------------
    function providerFor(name) {
        if (name === "ondevice") return OnDevice;
        if (name === "drive") return GoogleDrive;
        if (name === "dropbox") return Dropbox;
        return null;
    }

    // -------------------------------------------------------------------------
    // Core sync routine
    // -------------------------------------------------------------------------
    async function trySync(isManualRetry) {
        const providerName = getProvider();
        if (!providerName) return;
        const provider = providerFor(providerName);
        if (!provider || isSyncing) return;

        if (!navigator.onLine && providerName !== "ondevice") {
            showBadge("Not synced — offline");
            return;
        }

        isSyncing = true;
        try {
            const localSnapshot = getCurrentStateSnapshot();
            await provider.writeBackup(localSnapshot);
            localStorage.setItem(LS_KEYS.lastSyncedAt, new Date().toISOString());
            dirtySinceLastSync = false;
            hideBadge();
        } catch (err) {
            console.warn("Backup sync failed:", err);
            showBadge(isManualRetry ? "Retry failed — tap to retry" : "Not synced — tap to retry");
        } finally {
            isSyncing = false;
        }
    }

    function notifyStateChanged() {
        if (!getProvider()) return;
        dirtySinceLastSync = true;
        if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
        // Small debounce so rapid-fire edits (e.g. typing) don't spam the API.
        pendingSaveTimer = setTimeout(() => trySync(false), 1200);
    }

    window.addEventListener("online", () => {
        if (dirtySinceLastSync) trySync(false);
    });

    // -------------------------------------------------------------------------
    // First-load / reconnection setup flow
    // -------------------------------------------------------------------------
    function buildSetupModal() {
        if (document.getElementById("backup-setup-modal")) return;

        const overlay = document.createElement("div");
        overlay.id = "backup-setup-modal";
        overlay.className = "modal-overlay hidden";
        overlay.innerHTML = `
            <div class="modal-box">
                <h2 class="modal-title">Back Up Your Data</h2>
                <p class="text-muted" style="margin-bottom:1.25rem; font-size:0.9rem; line-height:1.5;">
                    Choose where Engineered Exercise should automatically keep a backup of your
                    exercises, history, and schedule. You can change this later in the Data Tab.
                </p>
                <div id="backup-provider-choices" class="form-action-row" style="gap:0.6rem;"></div>
                <button id="backup-setup-skip" class="btn btn-secondary" style="margin-top:1rem;">Not Now</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById("backup-setup-skip").onclick = () => {
            localStorage.setItem(LS_KEYS.setupComplete, "1");
            overlay.classList.add("hidden");
        };
    }

    function showSetupModal() {
        buildSetupModal();
        const overlay = document.getElementById("backup-setup-modal");
        const choicesEl = document.getElementById("backup-provider-choices");
        choicesEl.innerHTML = "";

        const options = [];
        options.push({ id: "drive", label: "📁 Google Drive" });
        options.push({ id: "dropbox", label: "📦 Dropbox" });
        if (supportsFileSystemAccess()) {
            options.push({ id: "ondevice", label: "💾 On Device" });
        }

        options.forEach(opt => {
            const btn = document.createElement("button");
            btn.className = "btn btn-primary";
            btn.textContent = opt.label;
            btn.onclick = () => handleProviderChosen(opt.id);
            choicesEl.appendChild(btn);
        });

        overlay.classList.remove("hidden");
    }

    function hideSetupModal() {
        const overlay = document.getElementById("backup-setup-modal");
        if (overlay) overlay.classList.add("hidden");
    }

    async function handleProviderChosen(providerId) {
        try {
            if (providerId === "ondevice") {
                await showOnDeviceChoiceModal();
                return; // showOnDeviceChoiceModal completes setup itself
            }
            if (providerId === "drive") {
                await GoogleDrive.setupInteractive();
            }
            if (providerId === "dropbox") {
                // Dropbox requires a full page redirect — store intent and go.
                localStorage.setItem("ee_backup_pending_provider", "dropbox");
                await Dropbox.beginAuth();
                return; // page is navigating away
            }

            setProvider(providerId);
            await finishSetupWithRemoteCheck(providerId);
        } catch (err) {
            console.error("Backup provider setup failed:", err);
            alert("Couldn't connect to that provider. Please try again.");
        }
    }

    function showOnDeviceChoiceModal() {
        return new Promise((resolve) => {
            const overlay = document.getElementById("backup-setup-modal");
            const choicesEl = document.getElementById("backup-provider-choices");
            choicesEl.innerHTML = "";

            const newBtn = document.createElement("button");
            newBtn.className = "btn btn-primary";
            newBtn.textContent = "Create New Backup File";
            newBtn.onclick = async () => {
                try {
                    await OnDevice.chooseNewFile();
                    setProvider("ondevice");
                    await OnDevice.writeBackup(getCurrentStateSnapshot());
                    localStorage.setItem(LS_KEYS.lastSyncedAt, new Date().toISOString());
                    localStorage.setItem(LS_KEYS.setupComplete, "1");
                    hideSetupModal();
                    resolve();
                } catch (err) {
                    if (err.name !== "AbortError") alert("Couldn't create the backup file.");
                    resolve();
                }
            };

            const existingBtn = document.createElement("button");
            existingBtn.className = "btn btn-secondary";
            existingBtn.textContent = "Load Existing Backup File";
            existingBtn.onclick = async () => {
                try {
                    await OnDevice.chooseExistingFile();
                    const remoteSnapshot = await OnDevice.readBackup();
                    setProvider("ondevice");
                    await resolveRemoteVsLocal(remoteSnapshot, "ondevice");
                    resolve();
                } catch (err) {
                    if (err.name !== "AbortError") alert("Couldn't read that backup file.");
                    resolve();
                }
            };

            const backBtn = document.createElement("button");
            backBtn.className = "btn btn-secondary";
            backBtn.textContent = "← Back";
            backBtn.onclick = () => { showSetupModal(); resolve(); };

            choicesEl.appendChild(newBtn);
            choicesEl.appendChild(existingBtn);
            choicesEl.appendChild(backBtn);
        });
    }

    async function finishSetupWithRemoteCheck(providerId) {
        const provider = providerFor(providerId);
        let remoteSnapshot = null;
        try {
            remoteSnapshot = await provider.readBackup();
        } catch (err) {
            console.warn("Could not check for existing remote backup:", err);
        }
        await resolveRemoteVsLocal(remoteSnapshot, providerId);
    }

    // Always asks the user when a remote backup already exists, per spec.
    async function resolveRemoteVsLocal(remoteSnapshot, providerId) {
        hideSetupModal();
        const hasRemote = remoteSnapshot && (remoteSnapshot.history || remoteSnapshot.exercises);

        if (!hasRemote) {
            // Nothing remote yet — just push current local state up.
            await trySync(false);
            localStorage.setItem(LS_KEYS.setupComplete, "1");
            return;
        }

        triggerConfirmationModalCompat(
            "Existing Backup Found",
            "A backup already exists at this location. Load it and replace what's on this device, or keep this device's data and overwrite the backup?",
            async () => {
                // Confirm = Load Backup
                applyStateSnapshot(remoteSnapshot);
                localStorage.setItem(LS_KEYS.setupComplete, "1");
                localStorage.setItem(LS_KEYS.lastSyncedAt, new Date().toISOString());
            },
            async () => {
                // Cancel = Start Fresh (keep local, overwrite remote)
                await trySync(false);
                localStorage.setItem(LS_KEYS.setupComplete, "1");
            },
            "Load Backup",
            "Keep This Device"
        );
    }

    // Wraps the app's existing confirmation modal but customizes button text
    // and supports a cancel callback (the stock helper only fires on confirm).
    function triggerConfirmationModalCompat(title, text, onConfirm, onCancel, confirmLabel, cancelLabel) {
        const modal = document.getElementById("confirmation-modal");
        if (!modal) { onConfirm(); return; } // graceful fallback
        document.getElementById("modal-title").innerText = title;
        document.getElementById("modal-body").innerText = text;

        const cancelBtn = document.getElementById("modal-cancel-btn");
        const confirmBtn = document.getElementById("modal-confirm-btn");
        const originalCancelText = cancelBtn.textContent;
        const originalConfirmText = confirmBtn.textContent;
        if (confirmLabel) confirmBtn.textContent = confirmLabel;
        if (cancelLabel) cancelBtn.textContent = cancelLabel;

        modal.classList.remove("hidden");

        const closeHandler = () => {
            modal.classList.add("hidden");
            confirmBtn.textContent = originalConfirmText;
            cancelBtn.textContent = originalCancelText;
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        };

        document.getElementById("modal-cancel-btn").onclick = () => { onCancel && onCancel(); closeHandler(); };
        document.getElementById("modal-confirm-btn").onclick = () => { onConfirm && onConfirm(); closeHandler(); };
    }

    // -------------------------------------------------------------------------
    // Settings panel: "Change Backup Location"
    // -------------------------------------------------------------------------
    function openSettingsPanel() {
        // Disconnect from whatever's currently configured, then show the same
        // chooser used on first load.
        const current = getProvider();
        if (current) {
            const provider = providerFor(current);
            if (provider && provider.clear) provider.clear();
        }
        setProvider(null);
        hideBadge();
        showSetupModal();
    }

    // -------------------------------------------------------------------------
    // OAuth callback handling (for Dropbox; Google's token client doesn't
    // need a page redirect since it uses a popup).
    // -------------------------------------------------------------------------
    async function handleOAuthReturnIfApplicable() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        if (!code || state !== "dropbox") return;

        try {
            await Dropbox.exchangeCodeForToken(code);
            setProvider("dropbox");
            await finishSetupWithRemoteCheck("dropbox");
        } catch (err) {
            console.error("Dropbox OAuth completion failed:", err);
            alert("Dropbox connection failed. Please try again from Settings.");
        }
        // Clean the OAuth params out of the URL.
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    async function init() {
        ensureBadge();

        // If we just landed back from oauth-callback.html (it forwards here
        // with ?code=...&state=dropbox attached), finish that flow first.
        await handleOAuthReturnIfApplicable();

        const provider = getProvider();
        if (!provider) {
            if (!localStorage.getItem(LS_KEYS.setupComplete)) {
                showSetupModal();
            }
            return;
        }

        // Provider is configured — verify the save location is still valid.
        // If it's gone (e.g. on-device handle permission revoked, or the
        // user cleared site data on one provider but not another), fall back
        // to the setup popup rather than silently failing forever.
        try {
            if (provider === "ondevice") {
                const handle = await OnDevice.getHandle();
                if (!handle) throw new Error("Stored file handle missing.");
                // Don't force a permission prompt on load — just confirm it exists.
                // Permission will be (re)requested on the next actual sync.
            } else if (provider === "drive") {
                // Nothing to eagerly verify — token refresh happens on demand.
            } else if (provider === "dropbox") {
                if (!Dropbox.getStoredToken()) throw new Error("Dropbox token missing.");
            }
            // Location still looks valid — sync silently if anything changed
            // since last successful sync (e.g. closed mid-edit last session).
            await trySync(false);
        } catch (err) {
            console.warn("Backup location no longer valid, reopening setup:", err);
            setProvider(null);
            showSetupModal();
        }
    }

    return {
        init,
        notifyStateChanged,
        openSettingsPanel
    };
})();
