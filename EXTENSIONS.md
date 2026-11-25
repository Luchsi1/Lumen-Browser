# Chrome extension support

Lumen loads Chrome extensions through [`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-extensions) on top of Electron's extension support. Electron implements only a subset of Chrome's extension platform, so compatibility is partial and varies per extension. Lumen does not pretend otherwise.

## Installing

`lumen://extensions`:
- **Load unpacked**: choose a folder containing `manifest.json`.
- **Install .crx or .zip**: CRX2, CRX3 and plain zip files are unpacked into Lumen's data folder (protected against path traversal).
- **Chrome Web Store**: opens the store; the Add button installs via `electron-chrome-web-store`.

Extensions persist across restarts. Each can be enabled, disabled, reloaded, removed, and pinned to or hidden from the toolbar. Popups and options pages open from the toolbar button or extension page. The *Details* section shows permissions, all compatibility findings, and a debug log with load errors and console output.

## Compatibility checker

Before and after install Lumen scans the manifest and scripts and reports each API it finds as supported, partial, or unsupported. The result is a static estimate, **not a test run**:
- *No known gaps*: nothing unsupported was detected.
- *partial*: some features may fail.
- *limited / unsupported*: the main purpose probably cannot work.

## Not supported or limited

The compatibility checker uses the table in `src/main/extension-compat.ts`. Summary:

| API | Status in Lumen |
|---|---|
| `webRequest` | Listeners are accepted but never fire, because Lumen's ad blocker owns Electron's request hooks |
| `declarativeNetRequest` (+ Feedback) | Extension installs, rules are **not applied**. uBlock Origin Lite / AdGuard MV3 block nothing. Use the built-in blocker |
| `bookmarks`, `history`, `downloads`, `sessions`, `topSites`, `tabGroups` | Not available; extensions cannot read or change Lumen's data |
| `commands` | Extension keyboard shortcuts not implemented |
| `sidePanel`, `offscreen`, `identity`, `omnibox`, `proxy`, `privacy`, `tts`, `pageAction`, `declarativeContent` | Not implemented |
| `tabs`, `webNavigation`, `contextMenus`, `notifications`, `action`/`browserAction`, `management`, `extension`, `system`, `permissions` | Partial; specific gaps are listed per extension |
| `runtime`, `storage` (sync is local only), `windows`, `scripting`, `cookies`, `devtools` | Supported |

Other limits:
- Manifest V2 extensions may fail to load on current Electron; the reason is shown as an error.
- Permissions cannot be revoked at runtime; an extension keeps its manifest permissions. Disable or remove it instead.
- Extensions do not run in private windows.
- Native messaging is not supported.
- Extensions installed from the Chrome Web Store are set to auto-update through `electron-chrome-web-store`; unpacked and package installs are not updated (reinstall them).

## Tested

Unit tests cover the compatibility analysis and CRX unpacking. Loading and running real third-party extensions and installing from the Web Store was **not** tested in the development environment (no network access to the store, no Windows).
