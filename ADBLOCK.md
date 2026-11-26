# Ad blocker

## Engine

Lumen uses [`@ghostery/adblocker`](https://github.com/ghostery/adblocker), an established engine that parses Adblock Plus / EasyList and uBlock Origin filter syntax. It is wired into Electron by Lumen's own `webRequest` hooks (`src/main/adblock.ts`, `adblock-engine.ts`).

Two engines are built: the main one (ads, privacy, annoyances, custom rules) and a security one (malware/phishing lists) so a malicious domain is caught even where a site is on the allowlist for ads.

## What is blocked

- **Redirect stubs:** rules with `$redirect=...` (for example the neutered ad-SDK scripts that keep video players working) serve a harmless stand-in from `lumen://resource/...` instead of failing the request. Verified: a script with `redirect=noopjs` loaded the stub, while a plain block failed.
- **Network requests** matching filters, including `$third-party`, `$script`, `$image`, `$xmlhttprequest`, `$domain=`, `$important`, exceptions `@@`, `$redirect` resources, `$removeparam`, `$csp`.
- **Cosmetic filters** (`##.selector`, `example.com##...`, `#@#` exceptions, extended selectors) applied by a content script at document start, plus generic hiding.
- **Trackers** from EasyPrivacy and uBlock Privacy (switch off with *Settings, Privacy, Tracking protection*).
- **Malicious domains** from uBlock Badware and URLhaus. Navigations to them show `lumen://blocked`, from which you can allow the site explicitly.
- **Redirects to blocked sites** and **pop-ups** (script-opened windows without user gesture, or to blocked domains).
- **Strict mode** (off by default): all third-party scripts and frames unless allowed.
- Also: third-party cookies can be stripped, `Sec-GPC` and `DNT` headers are sent, optional HTTPS upgrade.

## Built-in lists

EasyList, EasyPrivacy, uBlock filters, uBlock Privacy, uBlock Unbreak, uBlock Quick fixes, HaGeZi Pro, uBlock Badware risks and URLhaus (on by default). Peter Lowe's list and Fanboy's Annoyances (off by default).

The Windows build downloads the enabled lists during packaging and ships them, so blocking works on first start offline. Lists then update automatically (interval configurable; default every 24 h) and can be updated manually. The engine is rebuilt in place, **no restart**.

## List management (`lumen://adblock`, also in Settings)

Enable/disable each list, add custom lists by URL, remove custom lists, update one or all, see last update time, rule count and the last error per list. If an update fails the previous copy stays in use.

## Your rules

One rule per line in the same syntax, import/export as a text file. Unsupported or invalid lines are listed under the editor and ignored; the rest still applies.

## Toolbar popup (shield button)

Shows blocked count on this page and this session, a per-site on/off switch (writes to the allowlist), the most recent blocked requests with the matching filter, and the domains blocked most. The allowlist can be edited under *Allowlist*.

## Limitations

- `$popup` is not supported by the engine; heuristics are used instead and some pop-ups may get through or some legitimate windows may be blocked.
- Scriptlets (`##+js(...)`) run through uBlock Origin's `resources.json` (downloaded with the lists and bundled in the installer). Verified: a `set` scriptlet changed a page value. They run only in the main frame of a page, and behavior against anti-adblock scripts is not equal to uBlock Origin's.
- **Twitch and other video ads inserted into the video stream itself (server-side ad insertion) cannot be removed by request or element filtering.** uBlock Origin has the same limit; it blocks Twitch's ad requests and banners, but the stream-embedded pre-roll can still play. Lumen does not include a Twitch-specific workaround. Not tested against twitch.tv (no access from the development environment).
- It is a network filter, not a content-script-level blocker, so it cannot match uBO's YouTube ad handling.
- Extensions that bring their own blocker (uBlock Origin as extension) will not block network requests (see EXTENSIONS.md).
- Tested here: rule matching (unit tests) and one live network and one live cosmetic rule. Real-world list performance and breakage rates on popular sites were **not** measured.

## Measured coverage (development environment)

A set of 74 typical ad, tracking and analytics requests (Google Ads, DoubleClick, Meta, Taboola, Criteo, Hotjar, Amazon, Prebid and others) was matched against the engine with the real lists: EasyList, EasyPrivacy and the uBlock lists blocked 61 of 74; adding HaGeZi Pro raised it to 71 of 74 (about 385,000 rules, 2.3 s one-time build). The three requests still allowed are cookie-consent scripts (OneTrust, Cookiebot) and a support widget (Zendesk) that no ad list blocks on purpose, because blocking them breaks sites. This is a rule-matching test, not a measurement on live websites, and it is not the same as the score of any online ad-block test page.
