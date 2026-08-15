// =============================================================================
// Engineered Exercise — Backup & Sync Module
// =============================================================================
// Handles automatic backup of app data (see store.js) to an on-device file
// via the File System Access API. This is the only backup provider — no
// cloud accounts, no OAuth, no external services involved.
//
// Public surface used by app.js / index.html:
//   - BackupSync.init()                 call once on DOMContentLoaded
//   - BackupSync.notifyStateChanged()   call after every saveState()
//   - BackupSync.openSettingsPanel()    "Change Backup Location" button target
//
// Everything here is additive — if a user never sets up a backup file, this
// module is a no-op and the app behaves exactly as it did before.
// =============================================================================

const BackupSync = (() => {

    // --- INTERNAL STATE ------------------------------------------------------
    const LS_KEYS = {
        provider: "ee_backup_provider",       // "ondevice" | null
        lastSyncedAt: "ee_backup_last_synced_at",      // ISO timestamp of last successful sync
        setupComplete: "ee_backup_setup_complete"      // "1" once the user has chosen (even if "skip")
    };

    let dbPromise = null;        // IndexedDB handle, used to store the on-device FileSystemFileHandle
    let pendingSaveTimer = null; // debounce timer for auto-save
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

    // getCurrentStateSnapshot/applyStateSnapshot/mergeSnapshots are thin
    // delegations to Store — Store is the single source of truth for the
    // AppData shape, localStorage keys, and merge algorithm. Keeping that
    // logic in one place (rather than duplicated here) is what makes a
    // future native port straightforward: the sync provider layer below
    // only ever needs a JSON blob in and out, never direct storage-key
    // knowledge.
    function getCurrentStateSnapshot() {
        return Store.getSnapshot();
    }

    function applyStateSnapshot(snapshot) {
        const applied = Store.applySnapshot(snapshot);
        // Store has no DOM access by design — trigger the UI repaint here.
        if (applied && typeof initApp === "function") initApp();
        return applied;
    }

    function mergeSnapshots(local, remote, remoteIsNewer) {
        return Store.mergeSnapshots(local, remote, remoteIsNewer);
    }

    // -------------------------------------------------------------------------
    // PROVIDER: On Device (File System Access API) — the only provider.
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
    // Provider dispatch — trivial now, but kept as a seam in case another
    // on-device-style provider (e.g. a native file API in a Capacitor wrap)
    // is added later without reworking trySync/init/etc.
    // -------------------------------------------------------------------------
    function providerFor(name) {
        if (name === "ondevice") return OnDevice;
        return null;
    }

    // -------------------------------------------------------------------------
    // Core sync routine
    // -------------------------------------------------------------------------
    async function trySync() {
        const providerName = getProvider();
        if (!providerName) return;
        const provider = providerFor(providerName);
        if (!provider || isSyncing) return;

        isSyncing = true;
        try {
            const localSnapshot = getCurrentStateSnapshot();
            await provider.writeBackup(localSnapshot);
            localStorage.setItem(LS_KEYS.lastSyncedAt, new Date().toISOString());
            dirtySinceLastSync = false;
        } catch (err) {
            console.warn("Backup sync failed:", err);
            // No UI badge for this anymore — the On Device sync status is
            // still visible via "Last synced" in the Backup & Data settings
            // panel. The one nag badge in this app is the JSON-export
            // reminder (see app.js's BackupReminder), which isn't tied to
            // whether On Device sync succeeded.
        } finally {
            isSyncing = false;
        }
    }

    function notifyStateChanged() {
        if (!getProvider()) return;
        dirtySinceLastSync = true;
        if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
        // Small debounce so rapid-fire edits (e.g. typing) don't spam the API.
        pendingSaveTimer = setTimeout(() => trySync(), 1200);
    }

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
                    Save an on-device backup file of your exercises, history, and schedule.
                    Engineered Exercise will keep it updated automatically. You can change
                    the file later in the Data Tab.
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
        // On Device backup relies on the File System Access API, which is
        // Chromium-only (no Safari/Firefox support as of writing). Rather
        // than showing a modal with nothing usable in it, just skip setup
        // entirely on unsupported browsers — the app works fully without a
        // configured backup, same as any other optional feature.
        if (!supportsFileSystemAccess()) return;

        buildSetupModal();
        const overlay = document.getElementById("backup-setup-modal");
        const choicesEl = document.getElementById("backup-provider-choices");
        choicesEl.innerHTML = "";

        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = "💾 On Device";
        btn.onclick = () => handleProviderChosen("ondevice");
        choicesEl.appendChild(btn);

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
            await trySync();
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
                await trySync();
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
        if (!supportsFileSystemAccess()) {
            alert("On-device backup isn't supported in this browser. Try Chrome or Edge, or use Export Backup (JSON) from the Data tab instead.");
            return;
        }
        // Disconnect from whatever's currently configured, then show the same
        // chooser used on first load.
        const current = getProvider();
        if (current) {
            const provider = providerFor(current);
            if (provider && provider.clear) provider.clear();
        }
        setProvider(null);
        showSetupModal();
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    async function init() {
        const provider = getProvider();
        if (!provider) {
            if (!localStorage.getItem(LS_KEYS.setupComplete)) {
                showSetupModal();
            }
            return;
        }

        // Provider is configured — verify the save location is still valid.
        // If it's gone (e.g. on-device handle permission revoked, or the
        // user cleared site data), fall back to the setup popup rather than
        // silently failing forever.
        try {
            if (provider === "ondevice") {
                const handle = await OnDevice.getHandle();
                if (!handle) throw new Error("Stored file handle missing.");
                // Don't force a permission prompt on load — just confirm it exists.
                // Permission will be (re)requested on the next actual sync.
            }
            // Location still looks valid — sync silently if anything changed
            // since last successful sync (e.g. closed mid-edit last session).
            await trySync();
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
