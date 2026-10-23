# Comic Frontinder

A standalone, browser-only booth discovery app. Discover learns your fandom and goods preferences; For You ranks all booths by those preferences; Liked booths keeps your visit list. Indonesian and English are included.

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

`dist/` is the complete deployment artifact and is intentionally ignored by Git. `verify:static` serves that build at both `/` and `/comic-frontinder-23/` and verifies HTML, hash routes, assets, and the separate worker over HTTP. It does not replace visual browser testing. Unit and DOM tests cover ranking, coverage experiments, queues, IndexedDB, update races, navigation, images, and saved state.

An optional live integration test checks the production API schema, CORS, and a real gallery image:

```powershell
$env:RUN_LIVE_CATALOG = '1'
npm test -- test/live.test.ts
Remove-Item Env:RUN_LIVE_CATALOG
```

## Deploy to GitHub Pages or another static host

The default branch is `master`. `.github/workflows/pages.yml` runs tests, typechecks, builds, and verifies static hosting on pull requests and pushes to `master`. Successful pushes to `master` deploy `dist/` to GitHub Pages. You can also run the workflow manually on `master`. Pull requests never deploy. The optional live catalog test stays disabled in CI so deployments do not depend on the data host being online.

Before the first deployment, open the repository's **Settings > Pages** and choose **GitHub Actions** as the build and deployment source. If GitHub still lists another default branch, set it to `master` after pushing the local branch. See [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

After committing the app and workflow, push the branch:

```powershell
git push -u origin master
```

The expected project URL is `https://senacand.github.io/comic-frontinder-23/`. The workflow reports the deployed URL in its `github-pages` environment. No personal access token or repository secrets are required; deployment uses the workflow's GitHub token with Pages and OIDC permissions scoped to the deploy job.

For another static host, run `npm ci` and `npm run build` from the project root, then publish **the contents of `dist/`**.

Vite uses `base: './'`, so the same build works at a hostname root or a project path such as `https://senacand.github.io/comic-frontinder-23/`. Hash navigation needs no rewrite rules or `404.html` fallback. Serve JavaScript, including the worker, with a JavaScript MIME type. Use HTTPS in production. No server environment variables, secrets, backend, or build-time catalog copy is needed.

The app fetches `https://cf23-config.nnt.gg/last-updated.json`, `/v1/catalog.json`, and `/v1/fandoms.json` directly. The data host must return a suitable `Access-Control-Allow-Origin` header. Catalog images are remote; fonts load from Google Fonts with system fallbacks. If your host sets a Content Security Policy, allow the data origin in `connect-src`, catalog image origins in `img-src`, same-origin workers in `worker-src`, and Google Fonts in `style-src`/`font-src` (or self-host/remove the font import). Never add `unsafe-eval`; it is unnecessary for the production build.

## Data and preference behavior

- Only exhibitors with HTTP(S) gallery images qualify. A thumbnail or circle-page link alone does not qualify. IDs remain strings and one exhibitor is one card.
- IndexedDB database `cf23-circle-crush` holds a single atomic catalog/fandom/version snapshot and a separate visitor record. The app has no offline service worker. Images use ordinary browser caching.
- Returning visitors use cached data immediately. Version checks run on opening, every five visible minutes, and when returning to the tab after five minutes. New catalog/fandom data is committed only after validation and a confirming manifest check.
- Updates affect future discovery batch requests, preserving queued cards. Recommendations and Liked booths use the newest snapshot. Background failures retry invisibly; first-load errors offer Retry. Storage failures fall back to memory for the session, never catalog JSON in localStorage.
- Every exhibitor has one latest decision. A Like contributes `1/n` positive evidence to each of its `n` recognized fandoms; a Pass contributes `0.2/n` negative evidence. Either contributes `1/n` confidence evidence. Repeated decisions replace earlier evidence.
- Fandom interest is `(positive − negative) / (1 + positive + negative)`; confidence is `evidence / (1 + evidence)`. Unknown fandoms have zero interest and zero confidence. Booth affinity averages its fandom interests.
- Registry `generic_tag` entries such as Original receive one quarter of their usual evidence on mixed-fandom booths. Required positive evidence is `1 + 2 × prevalence`, where prevalence is the fraction of eligible booths carrying that tag. A tag on 10% of booths needs 1.2 full likes' worth of divided evidence; one on 80% needs 2.6. Established generic scores and learning priority are reduced by catalog prevalence, retaining at least half their weight. Generic-only likes retain full evidence, and repeated decisions still replace rather than stack. Thresholds recalculate with the catalog without changing stored decisions. Legacy snapshots without fandom kinds are downloaded again; visitor decisions and saved booths are preserved.
- Goods preferences learn separately from the catalog’s structured offerings (comics, artbooks, commissions, and other media). Likes contribute 1/n positive evidence and passes 0.1/n negative evidence across distinct offerings; confidence uses 1/n evidence. An offering’s interest is scaled by 1 − 0.9 × catalog prevalence, reducing the influence of ubiquitous merchandise. Rankings multiply fandom affinity by 1 + 0.25 × goods affinity, so goods cannot create a recommendation without a positive fandom match. Learning adds a small goods uncertainty term (0.2), accounting for queued coverage.
- New decisions retain the offerings shown at the time. Old decisions keep their fandom evidence without inferred goods preferences. Cached snapshots without offerings support are refreshed even when the catalog version is unchanged, while queued cards and visitor data remain intact.
- Five-card batches contain two interest picks, two learning picks, and one seeded random pick. Before positive interests exist, interest slots become learning slots. Learning picks favor uncertain fandoms while accounting for queued coverage; ties favor fewer fandoms, then seeded randomness. Interest slots penalize repetition. Two batches are kept ready; image preloading is independent.
- Likes are excluded from Discover. Passes become eligible after 72 hours, but unseen booths always come first. Revisit explicitly reopens passed booths for one review round; a fresh pass starts its cooldown again. It does not erase interest evidence.
- For You includes previously liked and passed exhibitors, ranks by positive fandom affinity adjusted for goods preferences, and has no exploration/uncertainty boosts or randomized tie-breaking. Saving there records a Like. Unsave only removes the saved entry and preserves learning.
- Preferences are local to a browser origin and shared by deployments on that origin. Moving to another hostname starts a new profile. Multiple open tabs do not synchronize live; use one tab for consistent discovery progress. Removed saved exhibitors retain their last saved details and are labeled unavailable.

Booth and collection links open the external event map. No analytics, accounts, or server storage are included.
