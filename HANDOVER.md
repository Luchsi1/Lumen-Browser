# Lumen Browser – Handover Document

State: end of the development session of 2026-11-27 (after the "Google client hints" fix). Version in package.json: 1.0.0.
The user writes mostly **German** – answer in German unless the user writes English. The user tests Windows builds himself and reports bugs back; he cannot run commands, he replaces files in a GitHub repo and re-runs a GitHub Actions workflow. All project docs except GITHUB-ANLEITUNG.md are in English.

---

## 1. Project overview

**Lumen** is a Windows desktop web browser: Electron 45 (Chromium 156, Node 22+ runtime APIs) + TypeScript + React 19 UI. Original spec (from the user): production quality, real functionality only (no mockups, fake data or no-op buttons), do not claim untested features work, explain limitations honestly, secure architecture (context isolation, no Node in renderers, persistent sessions).

Required feature set (all implemented in some form, see section 4 for status):
- Tabs: groups (named/coloured, collapse), pin, close/restore closed tab, session restore, mute, audio/loading indicators, keyboard shortcuts, drag reorder.
- Navigation bar/omnibox with suggestions (history, bookmarks, search), search engines, zoom, find in page, print, devtools, view source.
- Themes (system/light/dark + accent colour).
- uBlock-Origin-style ad blocker on an established engine (`@ghostery/adblocker`): list management, per-site popup, allowlist, statistics, cosmetic filters, scriptlets, redirect resources, popup blocking, custom rules, security lists.
- Chrome extension support (`electron-chrome-extensions`, `electron-chrome-web-store`) with a **static compatibility checker** (no pretending that unsupported APIs work).
- Bookmarks (tree, DnD, bar, HTML import/export), history, download manager.
- Privacy: private windows (in-memory session), cookie manager, third-party cookie blocking, per-site permissions, HTTPS upgrade, OS-credential password storage (Electron `safeStorage`/DPAPI), clear browsing data, GPC/DNT.
- Comprehensive persistent settings, transactional JSON storage with backups, configurable shortcuts.
- Tests, README, ADBLOCK.md, EXTENSIONS.md, Windows NSIS installer + portable .exe (+ ZIP) via GitHub Actions.

### Architecture
```
Main process (src/main, bundled by esbuild -> dist/main/main.js, CJS)
 ├─ AppData (data.ts)           global stores: settings, session, profiles list, ext records, adblock cache dir
 ├─ ProfileData (data.ts)       per-profile stores: bookmarks, history, downloads, permissions, passwords (JsonStore each)
 ├─ ProfileContext (profile.ts) one Electron Session per profile (partition "persist:profile-<id>") or per private window
 │                              ("lumen-private-<n>", in-memory). webRequest hooks, permissions, lumen:// protocol,
 │                              downloads, client hints.
 ├─ Browser (browser.ts)        windows (Win), tabs, groups, layout, overlay, commands/shortcuts, side panel, prompts
 ├─ Tab (tab.ts)                one WebContentsView per tab, lazily created (ensureView), discard/sleep, navigation events
 ├─ AdblockService (adblock.ts) + FilterEngineManager (adblock-engine.ts)
 ├─ ExtensionManager (extensions.ts) per profile; extension-compat.ts static analysis; crx.ts unpack
 ├─ ipc.ts                      ALL ipcMain handlers (~140 channels, see list in section 3)
 └─ main.ts                     app lifecycle, single-instance lock, argv URL handling, user-agent fallback

Renderer processes (Vite -> dist/renderer, multi-page: chrome.html, overlay.html, pages.html)
 ├─ chrome.html   Window UI (tab strip, toolbar, bookmarks bar). One WebContentsView on top/side.      preload/chrome.ts
 ├─ overlay.html  A second transparent WebContentsView drawn over the page for popups (menus, prompts, site panel, adblock popup)
 └─ pages.html    Internal pages served as lumen://<host>/ (newtab, settings, history, bookmarks, downloads, extensions,
                  adblock, passwords, blocked, error). Loaded inside tabs. preload/page.ts exposes `window.lumen` ONLY on lumen:.
Website tabs get preload/page.ts too but it exposes nothing to the page (password-form watcher + window.chrome shim).
```
Security model: all renderers `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The privileged custom protocol `lumen://` is the only way internal pages exist; `window.lumen.invoke(channel, ...)` is the bridge. IPC handlers verify the caller via `ctx(e)` (finds Win/profile from the sender).

### Dependencies (package.json)
Runtime: `@ghostery/adblocker-electron-preload`, `electron-chrome-extensions@^4.10`, `electron-chrome-web-store@^0.13`.
Dev (bundled): `@ghostery/adblocker@^2.20.3`, `electron@^45.4.1`, `electron-builder@^26.18`, `esbuild`, `vite@^8`, `@vitejs/plugin-react`, `react@19`, `fflate` (CRX/zip), `tldts-experimental` (third-party detection), `typescript@5.9`. Externals kept out of esbuild bundle: electron, electron-chrome-extensions, electron-chrome-web-store, @ghostery/adblocker-electron-preload (they locate own files at runtime).

---

## 2. File structure (all under project root)

| File | Purpose |
|---|---|
| `package.json` | Scripts (`dev`, `build`, `typecheck`, `test`, `start`, `dist`, `dist:dir`, `fetch-lists`) and `build` (electron-builder) config: appId `com.lumen.browser`, NSIS (`oneClick:false`, perUser, `include: build/installer.nsh`), portable, zip; x64; `extraResources: resources/filterlists -> filterlists`; artifactNames `Lumen-Setup-${version}-${arch}.exe`, `Lumen-${version}-portable.exe`, `Lumen-${version}-${arch}.zip`. NO fileAssociations (removed after installer froze the user's Windows). |
| `.github/workflows/build-windows.yml` | windows-latest, Node 24: `npm ci` → typecheck → test → fetch lists (continue-on-error) → list bundled lists → `npm run build` → `npx electron-builder --win nsis portable zip --x64 --publish never` → upload `release/*.exe`, `*.zip`, `*.blockmap`. |
| `scripts/build.mjs` | esbuild for main + two preloads (preloads bundle everything; sandbox can only require electron), Vite for renderer. `--dev` = sourcemaps, no minify. |
| `scripts/dev.mjs` | dev launcher. |
| `scripts/fetch-lists.mjs` | Downloads enabled BUILTIN_LISTS + uBO `resources.json` into `resources/filterlists/` using `node:https` with redirects/retries (undici crashed on Windows). Run by CI so the installer ships offline-usable lists. |
| `build/icon.png`, `icon.ico` | App icon. |
| `build/installer.nsh` | `customInstall/customUnInstall`: HKCU registration so Lumen appears in Windows "Default apps". **Untested on Windows.** |
| `tsconfig.json`, `vite.config.ts` | TS strict config; Vite multi-page config (chrome/overlay/pages). |
| `README.md`, `ADBLOCK.md`, `EXTENSIONS.md` | Required docs (features, testing status, limitations; ad-block design + measured coverage; extension API support table). |
| `GITHUB-ANLEITUNG.md` | German step-by-step guide: upload to GitHub, run workflow, download artifacts, report errors. |
| `src/main/main.ts` | Entry. Single-instance lock, `app.userAgentFallback = chromeUserAgent()`, registers `lumen` scheme as privileged, `urlsFromArgv` (http(s) URLs and plain html/htm/xhtml/svg/pdf file paths → `file://`), creates AppData/AdblockService/Browser, restores session. |
| `src/main/browser.ts` (884 lines) | `Win` and `Browser` classes. Window creation/layout (constants `TAB_H=40`, `TOOLBAR_H=44`, `BOOKMARKS_H=32`, `SIDE_PANEL_W=340`), tab ops (`addTab`, `activate`, `closeTab`, `restoreClosedTab`, `duplicateTab`, `setPinned`, `setMuted`, `moveTab`, groups), `navigate`, `newTabUrl`/`newTabPageUrl`, `hostFor(w)` (TabHost adapter), overlay (`showOverlay/hideOverlay/resolvePrompt`), side panel, `askPassword`, command dispatcher (`cmd` IPC + before-input-event shortcuts). |
| `src/main/tab.ts` | `Tab` class: `ensureView()` (creates WebContentsView, sets preload, calls `applyClientHints` un-awaited, then loads), `navigate`, `discard` (sleep), `destroy`, popup/window.open policy (`GESTURE_WINDOW_MS`), external-scheme allowlist (`SAFE_EXTERNAL`), zoom, `state()`. `TabHost` interface = what Tab needs from Browser. |
| `src/main/profile.ts` (366 lines) | `chromeUserAgent()`, `lowEntropyHints()`, `highEntropyHint()`, `applyClientHints(wc)`, `ProfileContext`: session setup, lumen:// protocol handler (pages by host, `/assets/`, `lumen://resource/<id>` ad-block stubs), `installWebRequestHooks` (HTTPS upgrade + adblock in onBeforeRequest; Sec-CH-UA/GPC/DNT/3rd-party cookie stripping in onBeforeSendHeaders; Accept-CH capture, 3rd-party Set-Cookie stripping, adblock CSP in onHeadersReceived), `installPermissions`, cookie helpers `cookieSites()`/`removeCookiesFor()`. |
| `src/main/adblock.ts` | `AdblockService`: list download/update/cache (`<userData>/adblock/`), `seedFromBundle` (copies bundled lists from `resources/filterlists` on first run), build of main + security engines, `handleRequest` (block/redirect/modify), `cspFor`, per-site allowlist, popup-block notes, stats, `$redirect` stub map (`stubs`, `resourceUrl`, `getStub`), uBO `resources.json` management (`RESOURCES_URL`), cosmetic preload registration (`registerSession`, own IPC channels instead of ghostery's electron glue). Status object includes `scriptletCount`/`scriptletError`. |
| `src/main/adblock-engine.ts` | `FilterEngineManager`: wraps `FiltersEngine` (main + security), serialized engine cache (`CACHE_VERSION='v1'`), `match`, `matchSecurity`, `matchPopup`, `cosmetics`, `cspFor`, `setResources/applyResources`, `countRuleLines`. |
| `src/main/extensions.ts` | `ExtensionManager` per profile: wraps electron-chrome-extensions + web-store, install unpacked/CRX, enable/disable/reload/uninstall, logs (service-worker console levels mapped numeric→name), pinning, options page. |
| `src/main/extension-compat.ts` | Pure static analysis: `scanApiUsage`, `analyzeManifest` → `CompatReport` (per API: supported / partial / unsupported, MV2/MV3, host permissions), `describeHostAccess`. |
| `src/main/crx.ts` | CRX2/CRX3 header stripping + zip extraction with limits (5000 files, 500 MB), zip-slip guard. |
| `src/main/data.ts` | `AppData`, `ProfileData` (bookmarks tree ops incl. cycle check `isDescendant`, history `addVisit`, site permissions). |
| `src/main/store.ts` | `JsonStore<T>`: debounced atomic writes (tmp + rename), rotating backups, corrupt-file recovery from backup, `mergeDefaults` (deep merge with defaults). |
| `src/main/downloads.ts` | `DownloadManager` (will-download hook, pause/resume/cancel/retry, sanitize filename, persistence, private = memory only). |
| `src/main/passwords.ts` | `PasswordVault`: `safeStorage` encryption, `save` returns saved/updated/unchanged, `list` (no secrets), `reveal`. |
| `src/main/bookmark-html.ts` | Netscape bookmark HTML import/export. |
| `src/main/ipc.ts` (418 lines) | Every IPC handler; wrapper `handle(channel, fn)` gives `(ctx, event, ...args)`. Also `ipcMain.on('page:reportAsChrome')` (sync, answers page preload) and `pw:submit`/`pw:lookup` for password manager. |
| `src/preload/chrome.ts` | Exposes `window.lumen` (invoke/on) to chrome + overlay UI. |
| `src/preload/page.ts` | On `lumen:` pages exposes `window.lumen`. On http(s): password-form watcher (`setupPasswordManager`) and, if `reportAsChrome`, `addChromeObject()` (window.chrome.loadTimes/csi/app via `webFrame.executeJavaScript`). |
| `src/shared/types.ts` | All shared types (Settings, TabState, WindowState, Bookmark, DownloadRecord, AdblockStatus, ExtensionInfo, OverlayRequest, …). |
| `src/shared/defaults.ts` | `BUILTIN_LISTS` (EasyList, EasyPrivacy, uBO filters/privacy/unbreak/quick-fixes, HaGeZi Pro, badware, URLhaus, Peter Lowe, Fanboy Annoyances [off]), `DEFAULT_SHORTCUTS`, `SHORTCUT_LABELS`, `DEFAULT_SETTINGS`. |
| `src/shared/shortcuts.ts` | `parseAccelerator`, `matches`, `formatAccelerator` (pure). |
| `src/shared/url.ts` | URL helpers: omnibox input → URL/search, `isLocalOrPrivateHost`, `originOf`, etc. |
| `src/renderer/chrome/*` | `main.tsx` (window UI root), `TabStrip.tsx`, `Toolbar.tsx`, `BookmarksBar.tsx`, `ExtensionButtons.tsx`, `overlay-client.ts`, `chrome.css`. |
| `src/renderer/overlay/*` | `main.tsx`, `panels.tsx` (menus, permission prompts, password prompt, site info, adblock popup, profile menu, tab context menu…), `overlay.css`. |
| `src/renderer/pages/*` | `main.tsx` (router by `location.host`), `NewTab.tsx`, `Settings.tsx` (incl. CookieManager, shortcut editor), `History.tsx`, `Bookmarks.tsx`, `Downloads.tsx`, `Extensions.tsx`, `Adblock.tsx` (AdblockPage + AdblockSummary), `Passwords.tsx`, `Blocked.tsx`, `ErrorPage.tsx`, `shared.tsx`, `util.tsx`, `pages.css`. |
| `src/renderer/common/*` | `api.ts` (typed wrapper of window.lumen), `icons.tsx`, `theme.css`. |
| `tests/*.test.ts` | 53 tests, Node's built-in runner with type stripping: `adblock` (incl. scriptlet), `bookmark-html`, `crx`, `extension-compat`, `shortcuts`, `store`, `url`. |

---

## 3. Implementation details

### Tabs / windows
- One `WebContentsView` per tab, created lazily by `Tab.ensureView`. Inactive tabs are kept; `backgroundTabSleepMinutes` (30) lets `Tab.discard()` free them.
- **Tab close reentrancy**: `electron-chrome-extensions` calls back the host's `removeTab` when `api.removeTab(wc)` is invoked, so `Browser.closeTab` uses a `closing` Set guard and `closeTabNow` with safe splice. Don't remove this.
- `newTabUrl(profile)`: with setting `newTabOpens==='home'` uses the homepage setting; `newTabPageUrl` always `lumen://newtab`. `navigate()` maps `lumen://newtab` via `newTabPageUrl`.
- `hideOverlay` only refocuses the page if the overlay had focus. `tab.new` command focuses the chrome webContents and re-focuses the address bar on `did-navigate`/`dom-ready` (otherwise the page steals focus and the first typed text is lost). NewTab.tsx has no `autoFocus`.
- TabStrip: middle-click via `onAuxClick`; `freezeStrip()` fixes tab widths while closing with the mouse so the next tab doesn't slide under the cursor; released via `useEffect` when tab count grows; CSS `.strip-inner[data-frozen] .tab:not(.pinned)`.
- Shortcuts: handled in main via `before-input-event` using `shared/shortcuts.ts`; user overrides stored in `settings.shortcuts` (`settings:setShortcut`).

### lumen:// protocol (profile.ts `registerLumenProtocol`)
Host routes to the right page (`pages.html` + router); `/assets/*` served from `dist/renderer/assets` with path-traversal check; `lumen://resource/<id>` serves ad-block redirect stubs (Chromium refuses redirects from http(s) to `data:` URLs – that's why stubs exist).

### Ad blocker
- Engine: `@ghostery/adblocker` `FiltersEngine`; two engines (main lists; "security" category lists: badware, URLhaus…) so security blocks can be shown with a different reason. Own `webRequest` hooks; adblocker's electron glue is not used. Cosmetic filtering through `@ghostery/adblocker-electron-preload` registered via `ses.registerPreloadScript` with own IPC channels (`PRELOAD_CHANNEL_INJECT`, `PRELOAD_CHANNEL_MUT`).
- uBO `resources.json` (scriptlets + redirect resources) is downloaded/seeded and applied with `engine.updateResources`; `##+js(...)` rules need it. `$redirect` rules are answered with `{redirectURL: lumen://resource/<id>}`.
- Features: popup blocking, per-site allowlist (host), custom rules, strict third-party mode, CSP injection (`cspFor`), rule import/export, per-tab stats (`siteStats`), list add/remove/toggle/update, auto update interval, serialized engine cache keyed by list hashes.
- Measured coverage and known gaps: see ADBLOCK.md (Twitch SSAI/server-side-inserted ads cannot be blocked by filter lists).

### Client hints / "Report as Google Chrome" (latest work)
Problem: Google sign-in says "Anmeldung nicht möglich – Dieser Browser oder diese App ist unter Umständen nicht sicher".
Root cause found by diffing Lumen against Playwright Chromium (`/tmp` scratch, not in project): after `session.setUserAgent(chromeUserAgent())` Chromium **sends no `Sec-CH-UA*` request headers at all**, while `navigator.userAgentData` (set via CDP) was fine.
Current implementation (all gated by `settings.reportAsChrome`, default true):
1. `main.ts`: `app.userAgentFallback = chromeUserAgent()`; `profile.ts` `ses.setUserAgent(chromeUserAgent())` — UA `Mozilla/5.0 (<os>) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`.
2. `applyClientHints(wc)` (profile.ts): attaches `webContents.debugger` and sends CDP `Emulation.setUserAgentOverride` with `userAgentMetadata` (brands `Not.A/Brand`, `Chromium`, `Google Chrome`; fullVersionList; platform, platformVersion from `os.release()` build ≥ 22000 → `15.0.0`; architecture; bitness 64). Called **un-awaited** from `Tab.ensureView` because the command only resolves once the tab has a page — awaiting it blocked the first navigation (blank new tabs; earlier regression).
3. NEW: `onBeforeSendHeaders` adds `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` on https and localhost/127.0.0.1/[::1] requests; `onHeadersReceived` records `Accept-CH` per origin in `hintRequests` (max 500) and later requests to that origin get the requested `sec-ch-ua-*` high-entropy headers from `highEntropyHint()`.
4. NEW: `preload/page.ts` `addChromeObject()` defines `window.chrome.loadTimes/csi/app` (from the Performance API) in the main world; asks main synchronously through `ipcRenderer.sendSync('page:reportAsChrome')`.
Verified in the Linux sandbox against a local server and Playwright baseline only. **Google acceptance is untested** (no account, Google unreachable from sandbox).

### Persistence
`JsonStore`: debounced save, write to temp file + rename (atomic), keeps rotating backups, falls back to backup on corrupt JSON, `mergeDefaults` fills new settings keys after updates. `AppData.flushAll()` on quit. Private profile uses `ProfileData('', true)` (memory only). User data directory = Electron `userData`; `app:openUserData` and `app:backupNow` IPC exist.

### Passwords
`safeStorage.encryptString` (DPAPI on Windows). Page preload detects login forms (username field before password field, visible), sends `pw:submit`; main asks via overlay prompt (`askPassword`), `pw:lookup` for autofill. Not available in private windows (assumption: verify in code `passwords:available`).

### Extensions
Extension sessions use the profile's session. Compatibility checker is static (manifest + scanning scripts for `chrome.*` API usage) and is honest about unsupported APIs; EXTENSIONS.md contains the API table. Install: unpacked folder, `.crx`/`.zip`, Chrome Web Store through electron-chrome-web-store.

### IPC channel groups (ipc.ts)
`win:*`, `cmd`, `nav:go`, `tab:*`, `group:*`, `sidepanel:toggle`, `overlay:*`, `settings:*` (incl. `setShortcut`, `reset`, `chooseDownloadDir`), `app:*`, `bookmarks:*`, `history:*`, `downloads:*`, `omnibox:suggest`, `adblock:*`, `extensions:*`, `site:*`, `permissions:*`, `cert:proceed`, `data:*` (clear/usage/clearCache), `cookies:sites|remove|removeAll`, `profiles:*`, `passwords:*`, `pw:lookup|submit`, `find:*`, `page:zoomReset`, `page:reportAsChrome`, `window:action`, `win:siteSecurity`, `errorpage:retry`, `clipboard:write`.

---

## 4. Current state

### Works (live-tested on Linux/Xvfb by driving the real Electron app, or by the user on Windows)
- Internal pages (newtab, settings, history, bookmarks, downloads, extensions, adblock, passwords, error/blocked pages), persistence of settings/bookmarks/history, session restore, private window.
- Tabs, groups, pin, mute, restore, middle-click close (fixed), width freeze, shortcuts incl. real X11 key events, typing into the address bar on a new tab, new tab opens homepage (setting).
- Ad blocker: network + cosmetic + scriptlet + redirect stubs, HaGeZi list improved coverage; downloads; extension install + content script injection (unpacked test extension); cookie manager; opening local file paths from argv.
- User confirmed on Windows build: "everything else fixed and works" (tabs, adblock incl. video playback/fullscreen fixes, new-tab behaviour), installer no longer freezes (after removing file associations).
- 53 unit tests pass; `tsc --noEmit` clean.

### Not working / unverified
- **Google account sign-in**: still failed on the user's build *before* the latest client-hint header fix. The fix is delivered (zip with `src/main/profile.ts`, `src/main/ipc.ts`, `src/preload/page.ts`, `README.md`) but the user has not reported the result yet.
- **Untested on Windows by me**: NSIS installer behaviour/registration (`build/installer.nsh`), portable and ZIP builds, real filter lists on the Windows build, DPAPI password storage, real Chrome Web Store extensions, Twitch ads, taskbar/default-browser integration.
- Fullscreen occasionally impossible with ad block on (reported by user, not reproduced; later reported fixed together with other items — keep watching).

---

## 5. Recent changes (this and the immediately preceding sessions)
1. electron-builder fix: removed `${target}` macro from artifactName; fetch-lists rewritten with `node:https`; workflow prints bundled lists.
2. Installer froze Windows → removed `fileAssociations`, added ZIP target, kept HKCU registration in `build/installer.nsh`.
3. Client hints: first version `applyClientHints` (CDP), later made non-blocking (blank-tab regression).
4. Tab-close reentrancy fix (`closing` guard, safe splice), middle-click close via auxclick, width freeze.
5. Ad blocker: uBO `resources.json` loaded (scriptlets work), `$redirect` stubs via `lumen://resource/<id>`, added `ubo-quickfixes` and `hagezi-pro` lists, scriptlet status in UI, scriptlet test.
6. Focus fixes: `hideOverlay` conditional refocus; address bar refocus; no autoFocus on NewTab.
7. Settings: `newTabOpens` ('newtab'|'home'), `reportAsChrome`; cookie manager (`cookies:sites/remove/removeAll`); file-path argv opening.
8. Extension SW console levels mapped to names.
9. **Latest (this session)**: header diff vs real Chromium → added `Sec-CH-UA*` request headers + `Accept-CH` handling (profile.ts), `window.chrome` shim (preload/page.ts), `page:reportAsChrome` sync IPC (ipc.ts), README note updated. Other observed differences that were NOT changed: `Sec-GPC: 1` is sent when `trackingProtection` is on (Chrome doesn't send it); `Accept-Language` is just the locale (`en-US` in sandbox; Chrome adds `,en;q=0.9`); `navigator.languages` single entry in sandbox; `window.chrome` missing in iframes (page preload does not run in subframes); WebGL null only because the sandbox uses `--disable-gpu`.

---

## 6. Known issues and limitations
- Google sign-in may still be rejected (Google also uses bot-detection JS and server-side signals Lumen cannot control). If it still fails, get the exact message and whether it appears at the email or password step.
- Twitch server-side-inserted ads are not blockable with list-based blocking (documented in ADBLOCK.md).
- Extensions: only APIs implemented by electron-chrome-extensions work (see EXTENSIONS.md); MV3 service-worker lifecycle and many APIs partially/unsupported; checker is static, not a guarantee.
- No auto-update mechanism for Lumen itself; no code signing (Windows SmartScreen warning expected).
- No password import, no sync, no tab previews/hover cards, no crash-recovery UI beyond session restore.
- `package.json` `dist` script builds only nsis+portable; the workflow additionally builds zip (use the workflow command).
- `build/installer.nsh` never executed on a real Windows machine.
- Test harness caveats (sandbox only): CDP-dispatched key events do not trigger `before-input-event` (use XTEST via python-xlib); Playwright `connectOverCDP` hangs when the main debugger is attached; only `raw.githubusercontent.com` is reachable from the sandbox (no filter-list hosts, Google, Twitch).

---

## 7. Design decisions
- **Electron + WebContentsView per tab, overlay view for popups**: native page content can't be covered by DOM of the chrome view, so menus/prompts render in a separate transparent view on top.
- **Own webRequest pipeline for ad blocking** on the ghostery engine instead of its electron glue: needed for redirect stubs, popup counting, allowlist, stats, security-list separation, CSP.
- **`lumen://resource/<id>` for `$redirect`**: Chromium rejects http→data: redirects.
- **Privileged `lumen://` protocol + preload bridge only on lumen pages**: websites never see an API; internal pages are real React apps with real IPC.
- **Report as Chrome (default on)**: needed for Google services; implemented consistently (UA string, JS userAgentData, request headers, window.chrome) and switchable in Settings.
- **Un-awaited CDP call**: a hard-learned lesson, never await `applyClientHints` before first navigation.
- **No fileAssociations in NSIS**: they froze the user's Windows during install; default-browser registration via HKCU in installer.nsh + `app:setDefaultBrowser` instead.
- **JsonStore with atomic writes + backups** rather than a DB: simplicity, inspectable, testable.
- **Honest testing policy**: the user chose "Build everything, test what I can"; README's testing section lists what is verified and what is not. Keep it truthful.
- **Delivery model**: user uploads files to a GitHub repo; changes are delivered as zip with only the changed files (paths relative to project root) plus German instructions when relevant.

---

## 8. Development instructions
Requirements: Node ≥ 22.6 (CI uses 24), npm.
```
npm ci
npm run typecheck          # tsc --noEmit
npm test                   # node --experimental-strip-types --test tests/*.test.ts  (53 tests)
npm run build              # esbuild + vite -> dist/
npm run fetch-lists        # optional: fills resources/filterlists (needs internet)
npx electron .             # run (after build); on Linux add: --no-sandbox --disable-gpu --user-data-dir=/tmp/x
npx electron-builder --win nsis portable zip --x64 --publish never   # Windows artifacts in release/
```
Windows release: via GitHub Actions workflow `build-windows.yml` (user uploads files, runs workflow, downloads artifacts). `LUMEN_DEBUG_HINTS=1` logs client-hint application time.

Headless/live testing recipe used in the sandbox:
1. `Xvfb :99 -screen 0 1400x900x24 &`
2. `DISPLAY=:99 node_modules/electron/dist/electron --no-sandbox --disable-gpu --user-data-dir=/tmp/lud --remote-debugging-port=9333 .`
3. `curl localhost:9333/json` → pick the target whose url contains `chrome.html`; connect with `ws` (found at `/opt/npm-tools/node_modules/ws`), evaluate `window.lumen.invoke('nav:go', 'http://127.0.0.1:8090/…')` to drive navigation. Main-process eval via `--inspect=9230`. Real key/mouse via python-xlib XTEST (Xvfb window offset 60,40; chrome UI height ≈ 84 px).
4. Local test servers (python http.server) for headers/fingerprints; Playwright Chromium at `/opt/npm-tools/node_modules/playwright` as baseline.

---

## 9. Next steps (priority order)
1. **Get the result of the Google sign-in test** with the latest build. If still failing: capture the exact message/step; consider (a) running preload `addChromeObject` also in subframes (`nodeSubframeIntegration`-free approach: register a `ses.registerPreloadScript({type:'frame'})` for the shim), (b) setting `Accept-Language` to Chrome's `xx-YY,xx;q=0.9` form, (c) not sending `Sec-GPC` while `reportAsChrome` is on or making GPC a separate setting, (d) comparing more details against real Chrome (TLS can't be changed). Don't claim success without user confirmation.
2. **Verify the Windows deliverables** with the user: installer (does it complete, Start-menu entry, uninstall), portable exe, ZIP, "Default apps" registration from `installer.nsh`; fix or remove what misbehaves.
3. **Real-world ad-block validation on Windows**: confirm bundled lists are present (workflow "Show bundled lists" step), measure on test pages, check video playback/fullscreen regressions, YouTube/Twitch behaviour; extend ADBLOCK.md with results.
4. **Password manager on real login forms** (save/update prompt, autofill, private-window behaviour, multi-step logins); add password import (CSV) and export.
5. **Crash recovery / window restore robustness** (renderer crash page, reopen after unexpected exit, multiple windows/profiles restore).
6. **Extensions**: test with a few real popular MV3 extensions and Web Store installs on Windows; update EXTENSIONS.md table from the results.
7. Polish items not yet built: tab hover previews, reading/zoom per-site persistence check, update mechanism (electron-updater needs a release host), code signing guidance.
8. Keep README "testing status" and "known limitations" in sync with every change; deliver changes as zip of changed files + short German instructions; always list what remains untested.

## Memory (RAM) work, Nov 2026
- Filter engine (`adblock-engine.ts`, `adblock-compile.ts`, `adblock-worker.ts`): cache key from file size+mtime (list text is never read on a cached start), cache loaded without copying, rule counts stored in `engine-*.counts.json` (`getFilters()` costs ~70 MB), security engine has no cosmetic rules, resources.json re-read from disk instead of kept. Fresh compiles run in a short-lived utility process (`dist/main/adblock-worker.js`, unpacked from asar via `asarUnpack`), falling back to a worker thread, then in-process. `AdblockService.init()` and `rebuild()` are async; `main.ts` awaits init.
- Overlay (pop-up layer) view is created on first use and released after 90 s hidden (`browser.ts`).
- Tab sleep: under low free RAM (<12%), tabs idle 5+ min sleep, 3 per minute; "Never" is respected.
- Internal pages are lazy-loaded chunks; profile data saves are batched over 2 s.
- Cache version bumped to v2 (one recompile after upgrade).
