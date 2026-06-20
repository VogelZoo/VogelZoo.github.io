# Engineered Exercise — Project Reference

A personal fitness-tracking PWA. Vanilla JS, HTML, CSS — no build step, no
framework, no dependencies. Everything runs directly in the browser; data
lives entirely in `localStorage` on-device (no backend, no sync), with an
optional automatic backup layer (see "Backup & Sync" below).

Deployed as a static site to GitHub Pages at
`vogelzoo.github.io/Engineered-Exercise/`. All files sit flat in the repo
root — no subfolders.

## File structure

```
index.html              Markup + view containers + inline bootstrap scripts
app.js                  All application logic (~1300 lines, single file)
backup.js               Backup/sync module (On Device, Google Drive, Dropbox)
oauth-callback.html     OAuth redirect landing page for Drive/Dropbox
styles.css              All styling (dark theme, single file)
manifest.json           PWA manifest (icons, standalone display, portrait lock)
sw.js                   Service worker — offline caching of the app shell
icon-192.png            App icon, "any" purpose
icon-512.png            App icon, "any" purpose
icon-192-maskable.png   App icon, "maskable" purpose (safe-zone padded)
icon-512-maskable.png   App icon, "maskable" purpose (safe-zone padded)
apple-touch-icon.png    180x180, opaque, for iOS home-screen install
favicon.ico             Multi-res browser tab icon
```

No `package.json`, no bundler. Editing any file and reloading is the entire
dev loop.

## Views

`index.html` defines four `<section class="view">` blocks, toggled by
`switchView()` in `app.js` (nav buttons in the header call this):

- **`view-track`** — daily logging. Order top-to-bottom: Consistency Streak
  widget (injected by JS, not static HTML) → 7-Day Horizon → "Plan for
  [date]" suggestion box → Log Exercise form.
- **`view-plan`** — create/view the recurring schedule (weekly day-of-week or
  interval-based; supports a "Rest Day" plan type).
- **`view-stats`** — per-exercise progression chart (SVG, hand-rolled, no
  charting library), average-intensity-by-day chart, and the full history log
  grouped by date.
- **`view-settings`** ("Data" tab) — custom exercise CRUD, backup/sync status
  + provider switcher, and JSON backup/restore + CSV export.

## Data model

Three top-level arrays in `state`, persisted individually to `localStorage`
under these exact keys (the `ee_` prefix is the established convention —
match it for anything new):

| Key            | Shape                                    |
|----------------|-------------------------------------------|
| `ee_exercises` | `{ name, category, emoji?, metrics: [] }[]` |
| `ee_history`   | see below                                 |
| `ee_plans`     | see below                                  |

**History entry** (one logged session):
```js
{
  id: 1234567890,          // Date.now()
  date: "2026-06-20",      // "YYYY-MM-DD", local date — see Gotchas
  exerciseName: "Bench Press",
  intensity: 3,            // integer 1-5, or null if not rated
  data: { sets: 3, reps: 10, weight: 135 }  // keys vary by exercise.metrics
}
```

**Plan entry** (one scheduling rule):
```js
{
  id: 1234567890,
  exercise: "Bench Press",   // or "__rest__" for a rest-day rule
  type: "weekly" | "interval",
  day: "1",                  // weekly only; 0=Sun..6=Sat
  interval: "3",              // interval only; every N days
  startDate: "2026-06-01"     // interval only; anchor date for the cycle
}
```

A given exercise can have **multiple plan entries landing on the same date**
— that's the intended way to represent "do this twice today." Completion
logic (dropdown filtering, horizon strikethrough) counts plan-rule matches
vs. logged entries for that date, not booleans.

`metrics` on an exercise is a subset of: `sets`, `reps`, `weight`,
`timeSeconds`, `timeMinutes`, `distance` — drives which input fields render
dynamically in the log form (`buildDynamicFormFields`).

## Backup & Sync

`backup.js` is a self-contained module (global `BackupSync` object) that
optionally mirrors `ee_exercises`/`ee_history`/`ee_plans` to one of three
providers, chosen by the user:

- **On Device** — File System Access API (`showSaveFilePicker`/
  `showOpenFilePicker`). The `FileSystemFileHandle` is stored in IndexedDB
  (`ee_backup_db`), since handles aren't JSON-serializable and can't live in
  `localStorage`. **Not offered on iOS Safari** — it has no File System
  Access API at all, even installed as a PWA — feature-detected via
  `supportsFileSystemAccess()` and simply omitted from the picker.
- **Google Drive** — OAuth via Google Identity Services (popup-based token
  client, no page redirect needed), scope `drive.appdata`. The backup file
  lives in the hidden `appDataFolder`, invisible in the user's normal Drive
  UI. Requires `GOOGLE_CLIENT_ID` to be set at the top of `backup.js`.
- **Dropbox** — PKCE OAuth (`token_access_type: offline` for refresh
  tokens), app-folder scope (`Apps/Engineered Exercise/backup.json`).
  Requires a real page redirect, handled by `oauth-callback.html`, which
  just forwards `?code=&state=` back to `index.html` for `backup.js` to
  finish the token exchange. Requires `DROPBOX_APP_KEY` to be set at the top
  of `backup.js`.

**Both cloud providers need their redirect URI registered exactly** (Google
Cloud Console / Dropbox App Console) to match `OAUTH_REDIRECT_URI` in
`backup.js`, which is built from `oauth-callback.html`'s deployed URL.

**Integration point**: `saveState()` in `app.js` calls
`BackupSync.notifyStateChanged()` on every call — this is the single funnel
all mutations pass through (log CRUD, plan CRUD, exercise CRUD, import), so
hooking it once covers every mutation path. `notifyStateChanged()` debounces
(1.2s) and no-ops entirely if no provider is configured, so the feature is
fully inert until a user opts in.

**First-load flow**: if no provider is configured and setup hasn't been
explicitly skipped (`ee_backup_setup_complete` unset), a modal offers the
three choices. If the chosen provider already has a backup file at that
location, the user is always asked (via the existing confirmation modal,
relabeled) whether to load it or keep local data and overwrite. This same
modal is reachable any time via Settings → "Change Backup Location."

**Reconnection check**: on every load, if a provider *is* configured,
`BackupSync.init()` does a lightweight existence check (file handle present,
Dropbox token present) before attempting a sync. If the save location is
gone — handle permission revoked, token cleared, site data wiped on one
provider but not the browser as a whole — it clears the provider and
reopens the setup modal rather than failing silently forever.

**Conflict resolution**: on reconnect with an existing remote backup that
differs from local, and implicitly on every write, the merge strategy is
union-based: history entries merged by `id` (collisions take the
newer-considered snapshot), exercises merged by name (case-insensitive,
newer wins on conflict), plans merged by `id` (newer wins on conflict). See
`mergeSnapshots()` in `backup.js`.

**Offline behavior**: if a sync attempt fails (offline, API error, expired
token refresh failure), a small red "Not synced" badge appears
bottom-right, tappable to retry. It clears automatically on the next
successful sync, including the automatic retry that fires on the browser's
`online` event.

## Conventions / gotchas (learned the hard way — don't regress these)

- **Never use `.toISOString().split('T')[0]` for "today's date."** It's
  UTC-based and rolls the date over early/late depending on the user's
  timezone offset, which caused a real bug (Plan-for card off by hours).
  Always use `getLocalDateString(date)` instead — it builds `YYYY-MM-DD`
  from local `getFullYear/getMonth/getDate`.
- **Intensity is numeric 1-5, not a string.** Legacy data used
  `"Low"/"Medium"/"High"`; `migrateIntensityData()` (runs on every
  `initApp()`) converts those to `1/3/5` on load. `0`/`null` means "not
  rated" and must stay excluded from averages (see
  `renderIntensityChart`'s filtering).
- **"Most recent" must be computed by comparing actual `date` values, not by
  array order.** `state.history` is *usually* kept sorted, but imported
  backups or backfilled entries can break that assumption.
  `getMostRecentEntryForExercise()` is the shared helper for this — route
  any new "previous value" lookups through it rather than
  `state.history.find(...)` or `[0]`.
- **Haptics**: use the `haptic('light' | 'success' | 'warning')` helper, not
  `navigator.vibrate()` directly. It's already feature-detected and silently
  no-ops on iOS Safari, which has no Vibration API at all (even installed as
  a PWA) — don't expect haptics to work there.
- **The rotate-overlay media query must stay scoped with `max-height`.**
  `@media (orientation: landscape)` alone matches *any* wide window,
  including ordinary desktop browsers — it isn't phone-specific. It needs
  `and (max-height: 600px)` or it blocks the entire app on desktop.
- **`viewport-fit=cover` requires matching `env(safe-area-inset-*)`
  padding.** It's set for edge-to-edge PWA rendering; without the safe-area
  padding on `header`/`body`, content renders behind the iPhone
  notch/Dynamic Island.
- Service worker cache is versioned via `CACHE_VERSION` in `sw.js` — **bump
  it on every deploy** that touches `index.html`/`app.js`/`styles.css`/
  `backup.js`/`oauth-callback.html`, or returning visitors can get served
  stale cached files.
- The splash screen's reboot-vs-reentry distinction is timer-based, not
  flag-based: a fresh page load always gets 2s, `visibilitychange` returning
  from background gets 0.5s. There's no real way to detect "was the OS
  process actually killed" from JS — this is the best available proxy.
- **Backup credentials are placeholders.** `GOOGLE_CLIENT_ID` and
  `DROPBOX_APP_KEY` at the top of `backup.js` are unset by default — Drive
  and Dropbox setup will fail until real values from each provider's
  developer console are filled in. On Device works immediately with no
  configuration (where supported).

## Known intentional design choices (not bugs)

- A scheduled exercise appears in **two places** in the Log Exercise
  dropdown: starred at the top under "Scheduled For Selected Date" (only
  while instances remain unlogged for that date) and again in its normal
  category group (always). This is deliberate — quick access up top,
  still browsable normally.
- The 7-Day Horizon's "Today" suggestion box always shows the **full**
  planned list for the date, unfiltered — only the dropdown's star group and
  the horizon's individual tags reflect per-instance completion
  (strikethrough/removal).
- **Backup setup is opt-in and skippable.** Dismissing the first-load modal
  ("Not Now") sets `ee_backup_setup_complete` and the modal won't reappear
  unless the save location later becomes invalid or the user explicitly
  opens it from Settings — there's no recurring nag.
