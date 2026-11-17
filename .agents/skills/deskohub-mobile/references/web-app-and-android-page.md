# Web app and Android download

## `/app/` web app

The same Expo Router code exports to a static single-page web app that the
Workspace serves at `workspace.deskohub.cz/app/` as the installable PWA. It
shares the site's origin, so it uses the site's session cookie and consent
cookie directly.

- `app.json` sets `web.output: "single"` and `experiments.baseUrl: "/app"`.
  `build:web` (`expo export --platform web`) writes `dist/`.
- `apps/deskohub-workspace` task `mobile-web-app:build`
  (`features/mobile-web-app/build-mobile-web-app.ts`) depends on
  `deskohub-mobile#build:web` and replaces the git-ignored `public/app/` with
  the export. `build:compile` depends on it, so the export is in place before
  `next build`. The Workspace lists the app as a dependency only so a mobile
  change redeploys it.
- `next.config.mjs` rewrites undotted `/app/*` paths to `/app/index.html`,
  sends `X-Robots-Tag: noindex` for `/app/`, and the shell's `index.html` has
  a noindex meta too. `proxy.ts` sends `/app/` past the locale rewrite and
  redirects bare `/app` to `/app/` (308). `vercel.json` caches only the hashed
  `/app/_expo/static/*` files as immutable.
- `public/` in the app is the PWA shell: `index.html`, `manifest.webmanifest`
  (`id`, `start_url` and `scope` all `/app/`, `related_applications` naming the
  Android app), `sw.js` (network-first navigations with an offline page) and
  `offline.html`. The site's locale layout links `/app/manifest.webmanifest`
  from every page. Keep the manifest `id` fixed: a new id is a different app to
  installed PWAs.
- Leave `EXPO_PUBLIC_API_ORIGIN` unset for the web export: the bundle then
  uses the origin that served it. A set value wins and would move the API off
  the session cookie's origin.

To try it locally, build the export into the Workspace and start it:

```bash
bun turbo mobile-web-app:build --filter=deskohub-workspace
bun run --cwd apps/deskohub-workspace dev
```

Then open `http://localhost:3000/app/`. Rerun the first command after app
changes; the Workspace dev server doesn't watch the app. On a preview, the PWA
is at `<preview origin>/app/` behind the usual deployment protection.

## `/android` page and Obtainium

- `/{locale}/android`
  (`apps/deskohub-workspace/app/[locale]/(site)/(full-header)/android/page.tsx`)
  offers the latest APK, install guidance, the signing certificate
  fingerprint and an Obtainium link. It reads the release through
  `loadLatestAndroidRelease` (`deskohub-mobile-release` skill, latest-release
  endpoint).
- The page links the APK on the site's own domain:
  `/android/download/deskohub-X.Y.Z.apk` redirects (302) to that release's
  GitHub asset, and `/android/download` to the latest one; a version without
  a usable release answers 404. Both routes (`app/android/download/`) have no
  locale: the proxy matcher and the dotted-path locale rewrite in
  `next.config.mjs` skip them. They read releases through `AndroidReleases`;
  only a tagged version older than the latest asks GitHub for its own release.
- `features/mobile-distribution/obtainium-link.ts` builds
  `https://apps.obtainium.imranr.dev/redirect?r=<encoded obtainium://app JSON>`
  with `/android` as an HTML source: Obtainium picks the link matching
  `deskohub-[0-9.]+\.apk$` and reads the version from its file name. Keep the
  asset name, the download path's file name and the tag pattern in step with
  the release tooling. Obtainium warns at install when the picked link's
  domain differs from the source's; it compares the link before following
  redirects, so the on-domain link avoids the warning.
- On Android, `install-environment.ts` calls `getInstalledRelatedApps()`; when
  the app is installed, the footer offers to open it
  (`install-android-app.ts`: an `intent://` URL into the app, falling
  back to `/android`). Detection needs both halves of the association: the
  manifest's `related_applications` plus `/.well-known/assetlinks.json` on the
  site, and the app's `asset_statements` resource
  (`plugins/android-asset-statements.cjs`).

## Site pages the app opens (App Links)

Besides `/app/` (app.json), `app.config.ts` (`siteLinkFilter`) claims these
`workspace.deskohub.cz` pages, bare and under every site locale tag:
`/reservation/access/<id>` (the confirmation email's access link),
`/account/reservations` and `/account/{referrals,profile,security,
assistants,billing,danger}`. Production's filter is `autoVerify`
(the host-wide `handle_all_urls` grant in `assetlinks.json` covers it); a
build aimed at a preview claims the same paths there, unverified.
`src/routing/app-link.ts` maps each to its app screen (the access page to
`/reservations/<id>/access`) and drops the query and hash so the
`accessToken` never reaches routes, logs or analytics; a claimed URL it can't
read opens `/`.

- Chrome hands a link to the app when the set of apps that handle the URL
  changes, including on a server redirect or a script redirect within 15 s of
  a gesture or incoming intent; same-set navigations stay in Chrome
  ([external_intents](https://chromium.googlesource.com/chromium/src/+/main/components/external_intents/README.md)).
  So a claimed page can pull a web flow that ends on it into the app.
- Not claimed, for that reason: `/reservation/status/*` (the payment gateway
  returns web checkout there), `/reservation/{cowork,meeting-room,office}`
  (Book again and retry from the status page would lose the web selection),
  `/reservation/invoice/*`, `/account/invoices/*` and `/account/data-export`
  (downloads), `/account/legal` (public; the app's needs sign-in), the bare
  `/account` (see sign-in below),
  `/<tag>/auth/callback` (the site's magic-link return) and presentation
  pages. Pages the app itself opens in a browser tab (contact, legal
  documents, `/ai-assistants`, `/android`) must stay unclaimed;
  `app.config.test.ts` checks them.
- Website sign-in ends with `leaveDocument(..., { replace: true })` to its
  destination, by default the bare `/<tag>/account` (`getSignInDestination`
  falls back to `getAccountPath`). Leaving that page unclaimed keeps web
  sign-in in Chrome. A sign-in whose `returnTo` is a claimed page (such as
  the access page) may continue in the app, which shows the screen the
  customer asked for. Section links inside the website are Next `<Link>`
  soft navigations, which Chrome never hands to an app.
- `app.config.ts` can't import local modules, so it repeats the locale tags
  and paths; `app.config.test.ts` fails when they drift from
  `supportedLocales` or from what `appLinkRoute` maps to a screen. Add a new
  site locale there.
- Intent filters are native config in the fingerprint: a change reaches
  customers only in a new APK, never an OTA update.
