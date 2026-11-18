# Blasa — Frontend

Expo Router + React Native app (iOS, Android and web) for **Blasa**, a Tunisian
ride-sharing platform: passengers publish and book seats, drivers verify their
identity and vehicle, and brands sponsor campaigns.

## Stack

| Concern | Choice |
| --- | --- |
| Runtime | Expo SDK 58, React 19, React Native 0.88 |
| Routing | Expo Router (file-based, typed routes) |
| Styling | NativeWind (Tailwind) + design tokens |
| State | Zustand (persisted session store) |
| Contracts | Generated TypeScript client in `shared-types/api.ts` |
| Errors | Central catalog (`src/lib/errors.ts`) + Sentry bridge (`src/lib/monitoring.ts`) |

## Quick start

```bash
npm install
cp .env.example .env      # EXPO_PUBLIC_MOCK=1 by default
npx expo start            # press w for web, i for iOS, a for Android
```

**The app runs with no backend.** With `EXPO_PUBLIC_MOCK=1` every request is
answered by the in-memory router in `src/api/mock.ts`, so all screens, the auth
flow, uploads and the brand portal are testable offline. Set it to `0` to hit
the real Django API at `EXPO_PUBLIC_API_URL`.

Mock credentials:

- **Existing account** — phone `+21699000123`, password `blasa1234`
  (seeded as a verified driver with a vehicle and documents).
- **New signup** — enter any other email or phone; any 6-digit code is accepted,
  then you set your name, password and role and land on the empty-state screens.

## Scripts

```bash
npm run start        # expo start
npm run web          # web only
npm run lint         # expo lint
npm run typecheck    # tsc --noEmit
npm run sync:types   # refresh shared-types/api.ts from a monorepo checkout
```

## Structure

```
src/
  app/            routes (file-based)
    (auth)/       phone → details → role → verify
    (tabs)/       home, rides, bookings, chats, account
    ride/         publish + detail
    booking/      detail + tracking
    brand/        campaign list, detail, create
    chat/ user/   conversation and public profile
    start.tsx     post-login role gate
  api/            fetch client, mock router, endpoint wrappers
  services/       thin typed service layer per domain
  store/          zustand stores (session, …)
  components/     design-system primitives (Button, Field, Skeleton, RideCard …)
  lib/            errors, monitoring, geo, upload, formatting, contact helpers
shared-types/     generated API contract (do not edit by hand)
```

## Auth flow

1. One input for email **or** phone (`(auth)/phone.tsx`).
2. `contact/check/` decides what to reveal: an existing account with a password
   gets the password field inline; everything else continues with a 6-digit
   code, so the user only ever sees the field they need.
3. New accounts then set full name + password (`(auth)/details.tsx`) and pick a
   role (`(auth)/role.tsx`).
4. A driver role routes to document upload (`/verification?onboarding=1`) and
   only reaches the tabs once approved; passengers go straight to the tabs.
   Returning users land on `start.tsx`, the explicit passenger/driver choice.

## Errors and alerts

Users never see a raw backend message. Every failure is normalized into an
`ApiError` in `src/api/client.ts`, then mapped to product copy in
`src/lib/errors.ts`:

```ts
import { alertError } from '@/lib/errors';

try {
  await publishRide(payload);
} catch (error) {
  alertError(error, { fallback: 'Could not publish this ride.' });
}
```

Add new backend codes/details to `ERROR_MESSAGES` / `KNOWN_DETAILS` there rather
than hardcoding strings in screens. Unhandled exceptions are forwarded to Sentry
through `captureException()`.

## Loading states

`src/components/Skeleton.tsx` provides `Skeleton`, `SkeletonText`,
`SkeletonRow`, `SkeletonRideCard` and `AppBootSkeleton` (the boot screen used
while the session rehydrates). Prefer skeletons over spinners for first paint.

## Deployment

### Vercel (web build)

The repo ships `vercel.json`, so importing the project is enough — no dashboard
build settings to configure.

| Setting | Value |
| --- | --- |
| Install | `npm ci` |
| Build | `npx expo export --platform web` |
| Output | `dist` |
| Node | `22.x` (from `engines` in `package.json`) |

`app.json` sets `web.output: "single"`, so the export is a client-rendered
single-page bundle. `vercel.json` rewrites every non-file request to
`index.html`, which is what makes deep links like `/ride/abc123` work on a
hard refresh. Hashed bundles under `/_expo/` and `/assets/` are cached
immutably; `index.html` is always revalidated so a redeploy is picked up.

Set these in **Vercel → Project → Settings → Environment Variables** (they are
inlined at build time, so redeploy after changing them):

```
EXPO_PUBLIC_API_URL=https://blasa-api.onrender.com/api/v1
EXPO_PUBLIC_MOCK=0
EXPO_PUBLIC_SENTRY_DSN=            # optional
EXPO_PUBLIC_SENTRY_ENVIRONMENT=production
```

Then add the Vercel domain to the backend's `CORS_ALLOWED_ORIGINS`
(e.g. `https://blasa.vercel.app`) or the browser build cannot call the API.

```bash
vercel            # preview deployment
vercel --prod     # production
```

### Native builds

Use EAS Build for iOS/Android binaries. Leave `EXPO_PUBLIC_MOCK=0` in production.
