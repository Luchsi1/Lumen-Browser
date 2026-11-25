# Ad blocker

## Engine

Lumen uses [`@ghostery/adblocker`](https://github.com/ghostery/adblocker), an established engine that parses Adblock Plus / EasyList and uBlock Origin filter syntax. It is wired into Electron by Lumen's own `webRequest` hooks (`src/main/adblock.ts`, `adblock-engine.ts`).

Two engines are built: the main one (ads, privacy, annoyances, custom rules) and a security one (malware/phishing lists) so a malicious domain is caught even where a site is on the allowlist for ads.

## What is blocked

- **Network requests** matching filters, including `$third-party`, `$script`, `$image`, `$xmlhttprequest`, `$domain=`, `$important`, exceptions `@@`, `$redirect` resources, `$removeparam`, `$csp`.
- **Cosmetic filters** (`##.selector`, `example.com##...`, `#@#` exceptions, extended selectors) applied by a content script at document start, plus generic hiding.
- **Trackers** from EasyPrivacy and uBlock Privacy (switch off with *Settings, Privacy, Tracking protection*).
- **Malicious domains** from uBlock Badware and URLhaus. Navigations to them show `lumen://blocked`, from which you can allow the site explicitly.
- **Redirects to blocked sites** and **pop-ups** (script-opened windows without user gesture, or to blocked domains).
- **Strict mode** (off by default): all third-party scripts and frames unless allowed.
- Also: third-party cookies can be stripped, `Sec-GPC` and `DNT` headers are sent, optional HTTPS upgrade.

## Built-in lists

EasyList, EasyPrivacy, uBlock filters, uBlock Privacy, uBlock Unbreak, uBlock Badware risks, URLhaus (on by default). Peter Lowe's list and Fanboy's Annoyances (off by default).

The Windows build downloads the enabled lists during packaging and ships them, so blocking works on first start offline. Lists then update automatically (interval configurable; default every 24 h) and can be updated manually. The engine is rebuilt in place, **no restart**.

## List management (`lumen://adblock`, also in Settings)

Enable/disable each list, add custom lists by URL, remove custom lists, update one or all, see last update time, rule count and the last error per list. If an update fails the previous copy stays in use.

## Your rules

One rule per line in the same syntax, import/export as a text file. Unsupported or invalid lines are listed under the editor and ignored; the rest still applies.

## Toolbar popup (shield button)

Shows blocked count on this page and this session, a per-site on/off switch (writes to the allowlist), the most recent blocked requests with the matching filter, and the domains blocked most. The allowlist can be edited under *Allowlist*.

## Limitations

- `$popup` is not supported by the engine; heuristics are used instead and some pop-ups may get through or some legitimate windows may be blocked.
- Scriptlet injection (`##+js(...)`) depends on engine support for the resource set bundled with it; behavior against anti-adblock scripts is not equal to uBlock Origin's.
- It is a network filter, not a content-script-level blocker, so it cannot match uBO's YouTube ad handling.
- Extensions that bring their own blocker (uBlock Origin as extension) will not block network requests (see EXTENSIONS.md).
- Tested here: rule matching (unit tests) and one live network and one live cosmetic rule. Real-world list performance and breakage rates on popular sites were **not** measured.
