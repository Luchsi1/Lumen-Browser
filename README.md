# Lumen

A Chromium-based desktop browser for Windows built on Electron 45, TypeScript and React. Tabs, groups, bookmarks, history, downloads, private windows, a built-in ad blocker (EasyList / uBlock Origin filter syntax) and Chrome extension support.

> **Status:** All code was developed and tested on Linux. The Windows installer and portable exe are built by GitHub Actions and have **not** been run on Windows by the author. See [Testing status](#testing-status).

## Download / build

Follow `GITHUB-ANLEITUNG.md` (German, step by step) to get `Lumen-<version>-x64-nsis.exe` (installer) and `Lumen-<version>-portable.exe` from GitHub Actions.

Local development (any OS with Node 22.6+):

```
npm ci
npm run dev        # build and start with remote debugging on :9222
npm test           # unit tests
npm run typecheck
npm run dist       # on Windows: installer + portable into ./release
```

## Features

| Area | What is implemented |
|---|---|
| Tabs | Create, close, duplicate, drag to reorder, pin, groups (name, color, collapse), reopen closed tabs, session restore, background tabs, mute, loading/audio/secure indicators, discard of idle background tabs |
| Navigation | Back/forward/reload/stop/home, omnibox with URL detection, selectable search engine, suggestions from history/bookmarks (and optionally the search engine), keyboard navigation, site info panel, bookmark star |
| UI | Light/dark/system theme, accent color, bookmarks bar (optional), side panel (bookmarks/history/downloads), fullscreen, find in page, zoom per site |
| Ad blocker | See [ADBLOCK.md](ADBLOCK.md) |
| Extensions | See [EXTENSIONS.md](EXTENSIONS.md) |
| Bookmarks | Folders, nesting, drag and drop, edit, search, HTML import/export, bookmarks bar |
| History | Persistent, search, single-day filter, delete items, clear by period, can be turned off |
| Downloads | Progress, speed, ETA, pause/resume, cancel, retry, open, show in folder, ask-where option, default folder |
| Privacy | Private windows (in-memory session, nothing written to disk), cookie clearing, third-party cookie blocking, tracking protection lists, GPC/DNT headers, per-site permissions (camera, microphone, location, notifications, pop-ups), HTTPS upgrade with fallback, passwords encrypted with the OS (DPAPI on Windows), clear browsing data |
| Settings | `lumen://settings`. Every option is saved and applied immediately unless marked "restart required" |
| Data safety | Atomic writes (temp file, fsync, rename), rolling backups in `backups/`, automatic recovery from the newest valid backup |
| Shortcuts | Chrome-like defaults, all rebindable in Settings |

Data lives in `%APPDATA%\Lumen` (installer) or next to the exe's user-data folder for the portable build.

## Architecture

- `src/main`: Electron main process. `browser.ts` (windows, tabs, layout, session), `tab.ts` (one `WebContentsView` per tab), `profile.ts` (session per profile, network hooks, permissions), `adblock*.ts`, `extensions*.ts`, `downloads.ts`, `data.ts`/`store.ts` (storage), `ipc.ts` (every renderer-to-main call).
- `src/preload`: two small bridges. The browser UI gets `window.lumen` (invoke/on). Web pages get nothing, except `lumen://` pages and a password-form helper on http(s).
- `src/renderer`: React UI. `chrome` (tab strip, toolbar), `overlay` (popups drawn above web content), `pages` (`lumen://` internal pages).
- `src/shared`: types, defaults, URL logic and shortcut parsing used by both sides (unit-tested).

Security model: web content runs in sandboxed renderers with context isolation and no Node. The browser UI is loaded from local files with a strict CSP. Every IPC handler checks that the sender is a trusted browser-UI or `lumen://` frame. `lumen://` pages cannot be navigated to by web content.

## Testing status

Tested on Linux (Electron 45 under Xvfb):
- 52 unit tests: URL/omnibox logic, JSON store (atomic write, backup, recovery), ad-block engine matching, extension compatibility analysis, CRX unpacking (incl. zip-slip), shortcut parsing, bookmark HTML import/export.
- Typecheck is clean; build succeeds; the app starts both from source and from a packaged `app.asar`.
- Every internal page renders without console errors.
- Ad blocking end to end: a custom network rule blocked a script on a live page, a cosmetic rule hid an element, the session counter increased, other scripts still ran.
- Persistence across restart: bookmarks, history, settings. Session restore after a normal window close restored all three tabs.

**Not tested** (needs Windows, internet or real-world use):
- The NSIS installer, the portable exe, the Windows icon, uninstall, and Default Apps registration.
- DPAPI password encryption (the sandbox has no secure storage, so the page correctly reports it unavailable).
- Downloading the filter lists (the sandbox blocks it). The update code path ran and reported its error correctly; the lists are bundled during the GitHub build.
- Installing real Chrome extensions or Web Store installs.
- Audio indicators, hardware video acceleration, camera/microphone prompts, drag and drop in the UI by hand, high-DPI and multi-monitor behavior, and long-term stability or memory use.
- Performance relative to Chrome. Lumen uses Chromium via Electron, but this was not benchmarked.

## Known limitations

- Clearing cookies and site data always clears **all time**; only history and downloads honor the time range.
- `$popup` filter options are not supported by the engine. Pop-up blocking uses gesture checks plus blocked-domain matching instead.
- Extension limitations: see [EXTENSIONS.md](EXTENSIONS.md). In particular extension `webRequest` listeners do not fire and `declarativeNetRequest` rules are not applied.
- No extensions in private windows.
- No sync, no built-in translation, no PDF viewer customization beyond Chromium's own, no Widevine DRM (Netflix etc. may not play), no app auto-updater (install a new version over the old one).
- Installers are unsigned, so Windows SmartScreen shows a warning on first run ("More info" then "Run anyway").
- Fullscreen video hides the browser UI.
- The filter engine rebuilds on the main thread; with all lists enabled a rebuild takes seconds (cached afterwards).
- `window.open` without features opens a new tab without `window.opener`.
