# Mobile App — Tech Stack Plan

## Product Overview

Ryot ("Roll Your Own Tracker") is a self-hosted personal tracking platform. The
full product vision and core principles live in `docs/soul.md` — read that first
if you haven't. The short version: users track anything (media, fitness, whiskey,
places, coffee) through a unified entity/event data model. It ships with curated
experiences for Media and Fitness and a schema-driven UI for anything else.

There are two user populations:

- **Cloud users** — Ryot hosts the instance at `app.ryot.io`. These users
  prioritise convenience over data control.
- **Self-hosted users** — users run the entire stack themselves on their own
  hardware (usually Docker on a home server or VPS). This is the primary
  audience. Self-hosted users tend to be technically sophisticated but still
  use Ryot on mobile as their primary device.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Docker image                        │
│                                                         │
│   ┌────────────────────┐   ┌───────────────────────┐   │
│   │   Hono backend     │   │   Web SPA (static)    │   │
│   │   apps/app-backend │──▶│  served from ./client │   │
│   │   REST + OpenAPI   │   │  (Expo web export)    │   │
│   └────────────────────┘   └───────────────────────┘   │
│           │                                             │
│           │  depends on                                 │
│   ┌────────────────────┐                                │
│   │  PostgreSQL + Redis│                                │
│   └────────────────────┘                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               Native mobile app                         │
│           apps/app-client  (this plan)                  │
│       iOS + Android + web (single codebase)             │
│                                                         │
│  Connects to backend at a user-configured server URL    │
│  (https://app.ryot.io for cloud, own URL for self-hosted│
└─────────────────────────────────────────────────────────┘
```

The backend is a Hono REST API with full OpenAPI documentation. It generates
TypeScript types automatically into `libs/generated/src/openapi/app-backend.d.ts`.
The mobile app is a pure API client — it never talks to the database directly.

The backend also serves the web frontend as static files. The Dockerfile builds
both the backend and the web export of the mobile app together, placing the web
output at `./client/` inside the container. Hono serves `index.html` for all
unmatched routes. This means a single Docker image covers both the native mobile
app (iOS/Android) and desktop/browser users.

---

## Departure from soul.md

`docs/soul.md` lists the mobile approach as "Responsive PWA." This plan
supersedes that entry. The PWA approach was the original plan but was changed
for the following reasons.

Application analytics (in-app, not website visits) show:

- 65% of cloud users access Ryot on mobile
- 43% of self-hosted users access Ryot on mobile

The features users have most requested — workout rest timers that survive phone
lock, background timer notifications, Dynamic Island integration, lock screen
timers, and home screen widgets — are impossible in a PWA. These are platform-
level capabilities. The PWA workarounds in V1 (service worker timers, web wake
lock, Howler.js audio) broke whenever the browser tab was backgrounded. A native
app solves this permanently.

The V2 frontend (`apps/app-frontend`) was at 26K LOC across 11 routes — still
early in development. Switching costs the least it ever will.

---

## Decision

Replace `apps/app-frontend` with a React Native application (`apps/app-client`)
using Expo Router. The backend is unchanged. The web serving model is preserved
— Expo Router exports a SPA (`web.output: "single"`) that the backend serves
identically to how it served the TanStack build.

Expo is used in **managed workflow** — no Xcode or Android Studio required for
day-to-day development. Builds run remotely on EAS Build servers. This keeps the
dev environment lean.

---

## Distribution

One app binary on the App Store and Google Play. On first launch the user sees
an onboarding screen to configure their server URL.

| User type | Server URL | How configured |
|---|---|---|
| Cloud | `https://app.ryot.io` | Pre-filled default, one tap |
| Self-hosted | Their own instance URL | Typed manually or via QR code / deep link from the Ryot web UI |

Self-hosted users on Android can also sideload an APK from GitHub releases,
bypassing the Play Store entirely. This is standard practice in the self-hosted
community and these users expect it.

### App Store Accounts Required

- Apple Developer Program: $99/year (required for iOS App Store and TestFlight)
- Google Play Console: $25 one-time (required for Play Store)

### EAS Billing

EAS (Expo Application Services) handles remote builds and OTA updates. The
Starter plan ($19/month, $45 build credit) comfortably covers a solo developer's
release cadence. OTA billing (MAUs) is the only variable cost and is controlled
as described below.

### OTA Updates

OTA (over-the-air JS updates via EAS Update) delivers JavaScript-only changes to
installed apps without going through app store review. This is important for
fixing bugs in cloud users' apps without a 1-3 day Apple review delay.

OTA is enabled for **cloud users only**. Self-hosted users are excluded because:

1. Every app install that downloads an OTA update counts as a monthly active user
   (MAU) in EAS billing. Self-hosted users (~10K mobile users) would make the
   cost unbounded.
2. Self-hosted users update through the app store like any other app.

Implementation — `app.json` sets `checkAutomatically: "NEVER"` globally. The
app then conditionally checks on startup:

```typescript
const CLOUD_URL = "https://app.ryot.io";

async function checkForUpdates() {
    const serverUrl = await getServerUrl();
    if (serverUrl !== CLOUD_URL) return; // self-hosted: skip entirely
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
}
```

Self-hosted users never contact EAS servers. Their EAS MAU cost is zero
regardless of how many users install the app.

### API Version Compatibility

Self-hosted users may run old backend versions. The app queries the backend
version on connect and shows a clear error if the app and backend are
incompatible. This prevents silent breakage when a user updates their Docker
image without updating the app or vice versa.

---

## Notifications

The word "notifications" covers two different things in Ryot. They must not be
confused.

### Local Notifications

Scheduled by the app directly on the device. No server involved. Fire even when
the app is backgrounded or the phone is locked. This is what users have been
asking for — rest timers that work when the screen is off.

| Use case | Mechanism |
|---|---|
| Rest timer completion ("rest over, start your set") | `expo-notifications` + `expo-task-manager` |
| Workout duration alerts | `expo-notifications` |
| Scheduled daily reminders | `expo-notifications` (user sets a time, app schedules locally) |

This completely replaces V1's service worker hack, which broke whenever the
browser tab was backgrounded.

### Remote Push Notifications (Deferred)

Server-triggered notifications (import complete, server-side events) require
APNs (Apple) and FCM (Google). APNs/FCM credentials are tied to the app's bundle
ID — a self-hosted backend cannot call Apple's servers directly without the app's
certificate. A Ryot-operated notification relay would be needed.

This is deferred from V1 of the mobile app. Self-hosted users continue using
V1's existing notification channels (Pushover, ntfy, Gotify, email, Slack,
Discord). Cloud users will gain native push in a later release.

---

## Design System

### Approach

The web frontend uses Mantine — a web-only component library. For a universal
(iOS + Android + web) app, Mantine cannot be used.

The replacement is a two-layer approach:

**NativeWind v5** — Tailwind CSS for React Native. At build time, Tailwind class
names are compiled to `StyleSheet.create` objects for native and remain as CSS
for web. You write `className="bg-stone-900 dark:bg-white"` and it works on all
three platforms. The full Tailwind v4 utility set is available on web; a supported
subset works on native.

**Gluestack UI v3** — A component library built on NativeWind. Critically, it
uses the **shadcn/ui model**: components are copied into the repo via CLI rather
than installed as a package dependency. You own the source and modify it freely.
This is better than a traditional component library for a product with a strong
visual identity — you bend the component to the design rather than fighting the
library.

```bash
# Add a component — copies the source into src/components/ui/
npx gluestack-ui add button
npx gluestack-ui add input
npx gluestack-ui add modal
```

### Design Tokens

The design language from `docs/soul.md` (warm gold accent, stone neutrals,
journal aesthetic) is implemented as Tailwind CSS v4 theme tokens:

```css
/* global.css */
@theme {
    /* Accent — warm gold */
    --color-accent-50:  #fffbeb;
    --color-accent-500: #d4a574;
    --color-accent-900: #5a4318;

    /* Stone neutrals — warm, not blue-tinted */
    --color-stone-50:  #fafaf9;
    --color-stone-500: #78716c;
    --color-stone-950: #1c1917;

    /* Typography */
    --font-heading: "Space Grotesk", system-ui;
    --font-body:    "Outfit", system-ui;
    --font-mono:    "IBM Plex Mono", monospace;

    /* Radii */
    --radius-card: 12px;
}
```

Dark mode uses `dark:` prefixes. The stone palette is intentionally warm — no
blue-tinted dark mode.

Platform-specific styles use modifiers:

```tsx
/* Web gets CSS grid; native gets flexbox column */
<View className="flex native:flex-col web:grid web:grid-cols-3 gap-4">
```

---

## State Management

Three tools manage state. Each has a specific domain. Do not mix them.

### TanStack Query — Server State

All data fetched from the backend. Handles caching, background refetch, loading
and error states. Never use `useEffect` + `fetch` for data loading.

```typescript
// Read data from backend
const { data } = apiClient.useQuery("get", "/api/trackers");

// Mutate backend data
const mutation = apiClient.useMutation("post", "/api/entities");
```

### TanStack Form — Form and Workout Session State

All forms in the app (create tracker, log event, settings). Also the entire
in-progress workout state. The workout is the most complex state in the app —
a deeply nested structure of exercises, sets, supersets, and timers — and
TanStack Form's array manipulation API handles it without immer.

```typescript
const workoutForm = useForm({
    defaultValues: loadWorkoutFromStorage() ?? getDefaultWorkout(),
});

// Add an exercise
workoutForm.pushFieldValue("exercises", newExercise);

// Update a set's reps
workoutForm.setFieldValue(`exercises[${exIdx}].sets[${setIdx}].statistic.reps`, 10);

// Remove an exercise
workoutForm.removeFieldValue("exercises", exIdx);

// Reorder exercises via drag-and-drop
workoutForm.moveFieldValues("exercises", fromIdx, toIdx);

// Confirm a set
workoutForm.setFieldValue(`exercises[${exIdx}].sets[${setIdx}].confirmedAt`, new Date().toISOString());
```

The workout form state is persisted to MMKV so an in-progress workout survives
app backgrounding and restarts. On app mount, the form is initialised from MMKV.
Changes are synced back via `form.store.subscribe`.

immer is not used anywhere in the codebase. TanStack Form's array API covers all
nested mutation patterns. For simple non-form state, plain spread syntax suffices.

### Jotai — Ephemeral UI State and Timer State

Small pieces of UI state that are not form state and are not server state. Timer
and stopwatch state for workout logging. Navigation state. The server URL atom.

```typescript
// Ephemeral (not persisted)
const currentTimerAtom = atom<WorkoutTimer | null>(null);

// Persisted to MMKV
const serverUrlAtom = atomWithPlatformStorage("server-url", CLOUD_URL);
const colorSchemeAtom = atomWithPlatformStorage("color-scheme", "auto");
```

`atomWithPlatformStorage` is a thin wrapper that uses MMKV on native and
`localStorage` on web (MMKV is a C++ library with no web runtime):

```typescript
import { Platform } from "react-native";
import { MMKV } from "react-native-mmkv";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

const mmkv = Platform.OS !== "web" ? new MMKV() : null;

const platformStorage = createJSONStorage(() =>
    mmkv
        ? {
              getItem: (k) => mmkv.getString(k) ?? null,
              setItem: (k, v) => mmkv.set(k, v),
              removeItem: (k) => mmkv.delete(k),
          }
        : localStorage,
);

export const atomWithPlatformStorage = <T>(key: string, initial: T) =>
    atomWithStorage(key, initial, platformStorage);
```

---

## Tech Stack Reference

### Framework and Navigation

| Concern | Library | Why |
|---|---|---|
| Framework | Expo (managed workflow) | No local Xcode/Android Studio required. Handles native build complexity. First-class Bun + monorepo support. |
| Routing / navigation | Expo Router | File-based routing matching TanStack Router's mental model. Built-in deep linking and web URL support. |
| Web output | `web.output: "single"` | SPA output compatible with the existing Dockerfile/Hono static serving setup |

### UI

| Concern | Library | Why |
|---|---|---|
| Styling | NativeWind v5 | Tailwind CSS for React Native. Build-time compilation to native styles. Full web support. |
| Component primitives | Gluestack UI v3 | Copy-owned components (shadcn model). No fighting library defaults. |
| Icons | `lucide-react-native` | Direct port of `lucide-react` (used in web frontend). Same icons, same API. |
| Animations | `react-native-reanimated` v3 | Bundled with Expo. GPU-thread animations. |
| Gestures | `react-native-gesture-handler` v2 | Bundled with Expo. Required by Reanimated and drag-and-drop. |
| Toast notifications | `sonner-native` | Port of the Sonner web library. Consistent API, works on all three platforms. |

### Data and State

| Concern | Library |
|---|---|
| Server state | TanStack Query v5 |
| Forms + workout session state | TanStack Form |
| UI / timer state | Jotai |
| Persistence | `react-native-mmkv` (native) / `localStorage` (web) via `atomWithPlatformStorage` |
| API client | `openapi-fetch` + `@ryot/generated` |
| Validation | Zod v4 |
| Pattern matching | `ts-pattern` |
| Date handling | `dayjs` via `@ryot/ts-utils` |

### Authentication

| Concern | Library |
|---|---|
| Auth client | `better-auth` + `@better-auth/expo` (`expoClient` plugin) |
| Secure token storage | `expo-secure-store` |
| In-app browser (OAuth flows) | `expo-web-browser` |

### Lists and Drag-and-Drop

| Concern | Library | Why |
|---|---|---|
| Virtualized lists | `@legendapp/list` | Faster than FlatList and FlashList. No recycling footguns. Dynamic item sizes without estimation. |
| Drag to reorder (workout exercises) | `react-native-reanimated-dnd` | Explicit iOS/Android/web support. Built on Reanimated v3 + Gesture Handler v2 (already bundled). |

### Media and Files

| Concern | Library |
|---|---|
| Image picker | `expo-image-picker` |
| Image lightbox | Custom (Gluestack Modal + Reanimated pinch gesture, ~150 lines) |
| Video playback (media trailers) | `expo-video` |
| QR code display | `react-native-qrcode-svg` |
| Screenshot / share | `react-native-view-shot` + `expo-sharing` |
| SVG rendering | `react-native-svg` |

### Charts

| Concern | Library | Notes |
|---|---|---|
| Analytics + body measurements | Victory Native XL | Powered by React Native Skia (GPU-rendered). On web, requires Skia CanvasKit WASM (2.9 MB gzipped) loaded via `<WithSkiaWeb>` code-splitting — Skia only loads when a chart screen is visited, not on app launch. |

Victory Native XL is chosen over recharts (used in V1) because recharts is
web-only. It is chosen over react-native-gifted-charts because Skia rendering
is GPU-accelerated and handles large datasets without frame drops.

### Fitness-Specific

| Concern | Library |
|---|---|
| Screen wake lock (active workout) | `expo-keep-awake` |
| Audio feedback (set confirmation) | `expo-audio` |
| Local timer notifications | `expo-notifications` |
| Background task continuity | `expo-task-manager` |
| Media image carousels | `react-native-reanimated-carousel` |

### Forms and Input

| Concern | Library |
|---|---|
| OTP / PIN input (2FA screens) | `react-native-otp-entry` |
| Date picker | `@react-native-community/datetimepicker` |

### Fonts

Same three typefaces as the web frontend, loaded via `expo-font`:

- `@expo-google-fonts/space-grotesk` — headings
- `@expo-google-fonts/outfit` — body
- `@expo-google-fonts/ibm-plex-mono` — technical values

### Build and Tooling

| Concern | Tool |
|---|---|
| Package manager | Bun (Expo has first-class Bun + monorepo support) |
| Monorepo | Turbo (unchanged from rest of repo) |
| Linting | Biome (unchanged) |
| Unit testing | Bun test |
| E2E testing | Maestro (EAS natively supports Maestro test jobs in CI) |
| Native builds | EAS Build (remote cloud builds, no local Xcode required) |
| App store submission | EAS Submit |
| OTA JS updates | EAS Update (cloud users only — see OTA section) |

---

## V1 Feature Coverage

Features from `apps/frontend` (V1) and their status in the mobile app:

| V1 Feature | Mobile V1 Status | Notes |
|---|---|---|
| Media tracking (log, library, detail pages) | Ported | Core feature |
| Fitness / workout logging | Ported | Primary reason for going native |
| Rest timers | Ported | Now via `expo-notifications` — works with screen locked |
| Body measurements | Ported | Charts via Victory Native XL |
| Analytics | Ported | Charts via Victory Native XL |
| Calendar view | Ported | List-based (no calendar grid component needed — V1 was also a list) |
| Collections | Ported | |
| Saved views | Ported | |
| Settings (all pages) | Ported | |
| Two-factor auth | Ported | OTP input via `react-native-otp-entry` |
| Access link sharing | Ported | QR code via `react-native-qrcode-svg` |
| Screenshot / export analytics | Ported | Via `react-native-view-shot` + `expo-sharing` |
| Exercise image/video upload | Ported | Via `expo-image-picker` + existing presigned URL flow |
| Video trailers (YouTube/Dailymotion) | Ported | Via `expo-video` (replaces `<iframe>`) |
| Onboarding tour | Deferred | `react-joyride` is web-only; replace with native onboarding screens |
| Muscle group body highlighter | Deferred | No maintained RN equivalent for DOM SVG rendering |

---

## Platform Support Verification

All libraries verified against iOS, Android, and web before inclusion:

| Library | iOS | Android | Web | Notes |
|---|---|---|---|---|
| NativeWind v5 | ✅ | ✅ | ✅ | |
| Gluestack UI | ✅ | ✅ | ✅ | |
| TanStack Query / Form | ✅ | ✅ | ✅ | Pure JS |
| Zod, ts-pattern, dayjs | ✅ | ✅ | ✅ | Pure JS |
| openapi-fetch | ✅ | ✅ | ✅ | Uses global `fetch` |
| better-auth + expo client | ✅ | ✅ | ✅ | |
| Jotai | ✅ | ✅ | ✅ | Pure JS |
| react-native-mmkv | ✅ | ✅ | ❌ | `localStorage` fallback via `atomWithPlatformStorage` |
| @legendapp/list | ✅ | ✅ | ✅ | Via React Native Web |
| react-native-reanimated-dnd | ✅ | ✅ | ✅ | Explicitly documented |
| react-native-reanimated-carousel | ✅ | ✅ | ✅ | Improved web support in v4 |
| Victory Native XL | ✅ | ✅ | ✅ | Skia WASM on web; requires `<WithSkiaWeb>` setup |
| react-native-view-shot | ✅ | ✅ | ✅ | Uses `data-uri` format on web |
| react-native-qrcode-svg | ✅ | ✅ | ✅ | Via `react-native-svg` |
| expo-image-picker | ✅ | ✅ | ✅ | File input on web |
| expo-sharing | ✅ | ✅ | ✅ | Web Share API on web |
| expo-audio | ✅ | ✅ | ✅ | Web Audio API on web |
| expo-keep-awake | ✅ | ✅ | ✅ | Wake Lock API on web |
| sonner-native | ✅ | ✅ | ✅ | |
| lucide-react-native | ✅ | ✅ | ✅ | |

---

## What Transfers Unchanged from the Web Frontend

The bottom half of the stack is identical to `apps/app-frontend`. These require
no learning or adaptation:

- `@ryot/generated` — auto-generated OpenAPI TypeScript types from the backend
- `@ryot/ts-utils` — shared utility functions and date helpers
- All Zod schemas and validation patterns
- TanStack Query patterns (`useQuery`, `useMutation`, cache invalidation, optimistic updates)
- `openapi-fetch` API client setup
- `better-auth` auth flow (only the client plugin changes: `expoClient` instead of the web client)
- `ts-pattern` usage
- `dayjs` usage
- Biome linting configuration
- Turbo monorepo configuration
