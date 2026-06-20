# Engineered Exercise — Project Reference

A personal fitness-tracking PWA. Vanilla JS, HTML, CSS — no build step, no
framework, no dependencies. Everything runs directly in the browser; data
lives entirely in `localStorage` on-device (no backend, no sync).

Deployed as a static site to GitHub Pages at
`vogelzoo.github.io/Engineered-Exercise/`. All files sit flat in the repo
root — no subfolders.

## File structure

```
index.html              Markup + view containers + inline bootstrap scripts
app.js                  All application logic (~1300 lines, single file)
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
- **`view-settings`** ("Data" tab) — custom exercise CRUD, and JSON
  backup/restore + CSV export.

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
  it on every deploy** that touches `index.html`/`app.js`/`styles.css`, or
  returning visitors can get served stale cached files.
- The splash screen's reboot-vs-reentry distinction is timer-based, not
  flag-based: a fresh page load always gets 2s, `visibilitychange` returning
  from background gets 0.5s. There's no real way to detect "was the OS
  process actually killed" from JS — this is the best available proxy.

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
