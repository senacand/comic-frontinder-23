# Circle Crush · Comic Frontier 23

A standalone, browser-only booth discovery app. Discover learns your fandom preferences; For You ranks all booths by those preferences; Saved keeps your visit list. Indonesian and English are included.

## Run locally

Requires Node.js 22.12+ and npm.

```powershell
cd ComicFrontinder
npm ci
npm run dev
```

Open the URL Vite prints (normally `http://127.0.0.1:5173`). `#/discover`, `#/recommendations`, and `#/saved` support direct links and browser Back/Forward. On Discover, **P** passes and **L** likes when focus is outside interactive controls. Arrow keys navigate a focused catalog; horizontal touch gestures scroll images. Zoom opens a modal viewer; tap the image to enlarge it, or use pinch zoom on mobile.

## Build and check

```powershell
npm run typecheck
npm test
npm run build
npm run verify:static
npm run preview
```

`dist/` is the complete deployment artifact and is intentionally ignored by Git. `verify:static` serves that build at both `/` and `/cf23-discovery/` and verifies HTML, hash routes, assets, and the separate worker over HTTP. It does not replace visual browser testing. Unit and DOM tests cover ranking, coverage experiments, queues, IndexedDB, update races, navigation, images, and saved state.

An optional live integration test checks the production API schema, CORS, and a real gallery image:

```powershell
$env:RUN_LIVE_CATALOG = '1'
npm test -- test/live.test.ts
Remove-Item Env:RUN_LIVE_CATALOG
```

## Deploy to GitHub Pages or another static host

Build, then publish **the contents of `dist/`** to your static host. Use Node 22 and run `npm ci` and `npm run build` from the project root in CI. On GitHub Pages, upload `dist` with `actions/upload-pages-artifact`, then deploy that artifact with `actions/deploy-pages` from an appropriately configured Pages workflow.

Vite uses `base: './'`, so the same build works at a hostname root or a project path such as `https://example.github.io/circle-crush/`. Hash navigation needs no rewrite rules or `404.html` fallback. Serve JavaScript, including the worker, with a JavaScript MIME type. Use HTTPS in production. No server environment variables, secrets, backend, or build-time catalog copy is needed.

The app fetches `https://cf23-config.nnt.gg/last-updated.json`, `/v1/catalog.json`, and `/v1/fandoms.json` directly. The data host must return a suitable `Access-Control-Allow-Origin` header. Catalog images are remote; fonts load from Google Fonts with system fallbacks. If your host sets a Content Security Policy, allow the data origin in `connect-src`, catalog image origins in `img-src`, same-origin workers in `worker-src`, and Google Fonts in `style-src`/`font-src` (or self-host/remove the font import). Never add `unsafe-eval`; it is unnecessary for the production build.

## Data and preference behavior

- Only exhibitors with HTTP(S) gallery images qualify. A thumbnail or circle-page link alone does not qualify. IDs remain strings and one exhibitor is one card.
- IndexedDB database `cf23-circle-crush` holds a single atomic catalog/fandom/version snapshot and a separate visitor record. The app has no offline service worker. Images use ordinary browser caching.
- Returning visitors use cached data immediately. Version checks run on opening, every five visible minutes, and when returning to the tab after five minutes. New catalog/fandom data is committed only after validation and a confirming manifest check.
- Updates affect future discovery batch requests, preserving queued cards. Recommendations and Saved use the newest snapshot. Background failures retry invisibly; first-load errors offer Retry. Storage failures fall back to memory for the session, never catalog JSON in localStorage.
- Every exhibitor has one latest decision. A Like contributes `1/n` positive evidence to each of its `n` recognized fandoms; a Pass contributes `0.2/n` negative evidence. Either contributes `1/n` confidence evidence. Repeated decisions replace earlier evidence.
- Fandom interest is `(positive − negative) / (1 + positive + negative)`; confidence is `evidence / (1 + evidence)`. Unknown fandoms have zero interest and zero confidence. Booth affinity averages its fandom interests.
- Five-card batches contain two interest picks, two learning picks, and one seeded random pick. Before positive interests exist, interest slots become learning slots. Learning picks favor uncertain fandoms while accounting for queued coverage; ties favor fewer fandoms, then seeded randomness. Interest slots penalize repetition. Two batches are kept ready; image preloading is independent.
- Likes are excluded from Discover. Passes become eligible after 72 hours, but unseen booths always come first. Revisit explicitly reopens passed booths for one review round; a fresh pass starts its cooldown again. It does not erase interest evidence.
- For You includes previously liked and passed exhibitors, ranks strictly by positive affinity, and has no exploration/uncertainty boosts or randomized tie-breaking. Saving there records a Like. Unsave only removes the saved entry and preserves learning.
- Preferences are local to a browser origin and shared by deployments on that origin. Moving to another hostname starts a new profile. Multiple open tabs do not synchronize live; use one tab for consistent discovery progress. Removed saved exhibitors retain their last saved details and are labeled unavailable.

No analytics, accounts, server storage, or map integration are included.
