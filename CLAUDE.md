# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (Vite HMR)
npm run build      # Production build
npm run preview    # Preview production build locally
npm run lint       # ESLint (flat config, no --fix by default)
```

There are no tests. There is no CI/CD pipeline.

## Architecture

This is a **single-page React + Vite app** — almost all application logic lives in `src/App.jsx` (~1,800 lines). There is no routing library; views are controlled by a `activeTab` state variable. There is no global state management library; everything is `useState` / `useEffect` within the main `App` component.

### File layout

| Path | Purpose |
|---|---|
| `src/App.jsx` | Entire application: Firebase init, pricing logic, all components, all state |
| `src/main.jsx` | React 19 `createRoot` entry point |
| `src/index.css` | Tailwind directives only |
| `public/` | Static assets (icons, hero image) |

### Internal structure of App.jsx (by line region)

1. **Holiday & pricing logic** (top) — `DEFAULT_RATE_CONFIG`, `isWeekendPriceFn`, `getPricePerNightFn`, `fetchHolidaysFromAPI`, `refreshHolidaysIfNeeded`
2. **Constants** — `ROOMS` (Shell / Beach / Pine with Tailwind colour schemes), `PATHS` (7 booking source channels), `INITIAL_DATA` (69 seed reservations)
3. **Firebase initialisation** — `firebaseConfig` and anonymous auth, Firestore `db` export
4. **Utility helpers** — `formatPhone`, `getLocalTodayStr`, `addDays`
5. **`SettingsTab` component** — Standalone child component for pricing & holiday management
6. **`App` component** — All remaining UI: calendar, list, add-form, search, statistics, modals

### Firebase / Firestore

Anonymous authentication is used. Three Firestore collections:

| Collection | Key documents / fields |
|---|---|
| `reservations` | Per-booking docs: `date`, `room`, `name`, `phone`, `path`, `nights`, `price`, `adults`, `kids`, `bbq`, `memo`, `createdAt` |
| `config` | `rateConfig` (pricing rules, seasons, holidays), `blockDates` (room unavailability map), `holidayMeta` (refresh timestamp) |

All Firebase credentials and the Korean public-holiday API key are **hardcoded** in `App.jsx`. There are no `.env` files.

### Authentication

A hardcoded PIN gate (`"9631"`) is the only access control. There is no backend; the app talks directly to Firestore from the browser.

### Pricing logic

`getPricePerNightFn(dateStr, room, rateConfig)` returns a price by checking (in order): Korean public holidays → weekend flag → season date ranges. The `rateConfig` object (stored in Firestore `config/rateConfig`) holds all tunable parameters. `fetchHolidaysFromAPI` calls the Korean government public data portal; `refreshHolidaysIfNeeded` runs this automatically once per day for the current and next calendar year.

### UI conventions

- Styling is **Tailwind CSS utility classes only** — no CSS modules, no styled-components.
- Icons come from `lucide-react`.
- Charts use `recharts`.
- There is no component library (no shadcn, MUI, etc.); all UI is hand-rolled JSX.
- Calendar, list, statistics, and the add-reservation form are all rendered inline inside `App` — they are not separate files or components.
- The `activeTab` state drives which view is shown; valid values are `'calendar'`, `'list'`, `'add'`, `'search'`, `'stats'`, `'settings'`.

### ESLint

Uses the new flat-config format (`eslint.config.js`). `react-hooks/exhaustive-deps` and `react-refresh/only-export-components` are enabled. `no-unused-vars` allows variables matching `/^[A-Z_]/` (i.e. upper-case constants).
