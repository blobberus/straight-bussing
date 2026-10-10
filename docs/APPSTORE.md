# App Store release plan (unofficial UChicago shuttle tracker)

Researched 2026-10-07. Items marked (est.) are not verified from a first-party page, so re-check before paying.

**Step-by-step registration and submission (enrollment, signing without a Mac, App Store Connect, TestFlight, review): `docs/APPSTORE-SUBMIT.md`.**

Corrected 2026-10-10 (re-checked against Apple's pages for APPSTORE-SUBMIT.md): the iPhone app is now native SwiftUI
(`ios/`), so the Capacitor recommendation in section 3 is superseded; App Review times now come from Apple's own
figures; the fee-waiver rule, D-U-N-S timing and the rights guideline number (5.2.2, not 5.2.3) were fixed; Codemagic
prices are confirmed from Codemagic's docs; Xcode Cloud, cloud Mac minimums and the Xcode 26 upload rule were added.

## 1. Cost estimate

| Item | Low | Likely | High | Notes / source |
|---|---|---|---|---|
| Apple Developer Program (individual) | $99 | $99 | $99 | Yearly. No student program; the iOS Developer University Program was discontinued on 2024-05-15 and never allowed App Store distribution. https://developer.apple.com/programs/enroll/ , https://developer.apple.com/programs/ios/university/ |
| Org enrollment / D-U-N-S | $0 | $0 | $0 | Org needs a legal entity (LLC fees vary, est. $50-300 if you form one), a public website on its own domain and a work email on that domain, plus a free D-U-N-S (Apple: up to 5 business days, then up to 2 business days to reach Apple; https://developer.apple.com/help/account/membership/D-U-N-S/ ). Not needed for an individual account. |
| Fee waiver | $0 | n/a | n/a | Only for nonprofit, accredited school or government legal entities; individuals and sole proprietors are excluded. Condition is no Paid Applications Agreement and no selling of digital goods (not literally "free apps only"). An unofficial app by a student will not qualify unless it is run through a registered nonprofit. https://developer.apple.com/help/account/membership/fee-waivers/ |
| Mac + Xcode | $0 | $0-30 | $599 | Low: free CI (GitHub Actions `macos-26`, Xcode 26; uploads need Xcode 26+ since 2026-04-28). Likely: none, or a cloud Mac day for debugging: Scaleway M2 from 0.17 EUR/h with a 24 h minimum (about 4 EUR), AWS EC2 Mac also 24 h minimum. High: buy a Mac mini (est. $599). Xcode is free. |
| CI (Codemagic / GitHub Actions / Xcode Cloud) | $0 | $0 | $50 | GitHub Actions standard runners are free on public repos ($0.062/min macOS on private). Codemagic: 500 free macOS M2 min/month for personal accounts, then $0.095/min (Codemagic docs, checked 2026-10-10). Xcode Cloud: 25 compute hours/month included with membership, but the first workflow must be configured in Xcode on a Mac. https://docs.codemagic.io/billing/pricing/ , https://docs.github.com/en/billing/reference/actions-runner-pricing , https://developer.apple.com/xcode-cloud/ |
| Proxy hosting (small) | $0 | $60 | $120 | Free tiers (Cloudflare Workers, Fly, Render) vs about $5-10/mo VPS (est.). |
| Domain | $0 | $12 | $20 | Optional. Low uses a github.io or workers.dev URL (est.). |
| Privacy policy / support page hosting | $0 | $0 | $0 | GitHub Pages. Apple requires a policy URL in App Store Connect and a link inside the app (Guideline 5.1.1(i)), plus a support URL. |
| Push notifications (APNs) | $0 | $0 | $10 | APNs itself is free. You need a server to send; the proxy can do it (also drives Live Activity push-to-update). Time Sensitive notification entitlement is free. High covers a paid push relay. |
| **Year 1 total** | **~$99** | **~$170-200** | **~$900** | High includes buying a Mac. Version 1.0 without a push server is $99 (APPSTORE-SUBMIT.md section 2). |
| **Recurring per year** | **$99** | **~$170** | **~$300** | Apple fee plus hosting and domain. |

## 2. Feasibility

### Guideline 4.2 (minimum functionality)
- 4.2 says an app should "include features, content, and UI that elevate it beyond a repackaged website". 4.2.2 rejects web clippings, aggregators and link collections. A bare WKWebView around the PWA is the textbook rejection. https://developer.apple.com/app-store/review/guidelines/
- Reviewers have reportedly rejected apps where notifications, location and sharing were the only native extras, calling them not robust enough. Make the core experience clearly native and useful (reported by https://appflight.dev/learn/rejections/app-store-guideline-4-2-minimum-functionality/ , https://tapbound.com/blog/apple-guideline-4-2-minimum-functionality ).
- Native features that raise approval odds:
  - Core Location with "nearest stop" and walking distance to it, with a clear purpose string (5.1.1(ii)).
  - Local or push notifications such as "shuttle arriving at your stop in 5 min".
  - Home-screen and Lock Screen widgets, and Live Activities for a tracked bus.
  - Offline cached schedules and stop data, and saved favorite stops.
  - Native UI for lists and settings. Keep the map in a web view only if everything around it is native.
- In review notes, list the native features and attach a short screen recording.

### Third-party data, naming and IP (4.1, 5.2)
- Do not use "UChicago", "University of Chicago", "Maroon" or the university logos or colors as branding. 4.1 (copycats) and 5.2 (IP) cover impersonation. Use a neutral name such as "Straight Bussing" and state "Unofficial, not affiliated with the University of Chicago" in the description and the app.
- Passio data: the feed is public but unlicensed for redistribution as far as I found. Passio's terms or the university's transportation office may object, and 5.2.2 (third-party services: "Authorization must be provided upon request") / 5.2.1 (trademarks) let Apple reject or pull an app on a rights complaint. Mitigation: email UChicago Transportation (Department of Safety and Security) and Passio for written permission (attach it in App Review Information > Attachment; APPSTORE-SUBMIT.md step 1), cache politely through your proxy and rate-limit, show attribution, and keep a takedown plan. Treat this as the biggest non-technical risk.
- Privacy nutrition label: if location is used only on-device and nothing is sent to your server, declare "Data Not Collected". If the proxy logs IPs or you send push tokens, declare Identifiers and Diagnostics as needed. Also provide a privacy policy URL, and a privacy manifest if you use any SDK or API that Apple requires one for.
- TestFlight steps: enroll, create the App ID and the App Store Connect record, build and upload via Xcode or CI (signing certificates and provisioning), add internal testers (up to 100, no review), then add external testers (the first build needs a short Beta App Review, usually about a day). Builds expire after 90 days.

### Timeline (realistic)
| Phase | Duration |
|---|---|
| Enrollment (individual; Apple publishes no time, reports say 1-3 days, sometimes weeks; org adds D-U-N-S, up to about 1-2 weeks) | 1-3 days |
| ~~Capacitor wrap~~ Native SwiftUI app: drafted 2026-10-09 in `ios/`; left: signing + release CI, privacy link, screenshots | 1-2 sessions |
| TestFlight beta | 1-2 weeks |
| Permission outreach to Passio / UChicago (runs in parallel) | 2-6 weeks |
| App Review (first submit, often 1-3 rounds; Apple: at least 50% of submissions reviewed in < 24 h, 90% in < 48 h, https://developer.apple.com/distribute/app-review/ ) | 1-2 days per round |
| **Total** | **about 3-6 weeks** (permission is the long pole) |

## 3. Recommendation

Superseded 2026-10-09: the owner chose the **native SwiftUI** path (`ios/`, see `ios/README.md`), which removes most of
the 4.2 risk; items 2-4 below are kept for history. Follow `docs/APPSTORE-SUBMIT.md` to ship it.

1. Now: ship and polish the PWA. It costs $0, installs from Safari "Add to Home Screen", and has no review risk. Get written Passio/UChicago permission in the meantime.
2. If you want the App Store: use **Capacitor** with real native plugins (geolocation, local and push notifications, plus a small Swift WidgetKit extension). It reuses the existing code and can plausibly clear 4.2 if the native features are substantial.
3. Go **SwiftUI** only if reviewers reject the Capacitor build under 4.2 or you want a MapKit-native feel. Live Activities, Dynamic Island and widgets work with Capacitor too, through a Swift Widget Extension plus a small custom plugin (see `conversion to appstore.md` sections 6-9). It is more work, and you would rewrite the map and UI.
4. Budget about $100-200 for year 1 and use an individual account with CI or a borrowed Mac. Do not buy a Mac unless you go native.
5. Locked-phone bus alerts (2 stops / 1 stop away) and an always-accurate Live Activity need APNs pushes from a small server (the proxy row above; APNs is free). Push tokens leaving the device must be declared in the privacy label.

## Sources
- https://developer.apple.com/programs/enroll/
- https://developer.apple.com/help/account/membership/fee-waivers/
- https://developer.apple.com/app-store/review/guidelines/
- https://docs.codemagic.io/billing/pricing/
- https://docs.github.com/en/billing/reference/actions-runner-pricing
- https://appflight.dev/learn/rejections/app-store-guideline-4-2-minimum-functionality/
- https://www.tapbound.com/blog/apple-guideline-4-2-minimum-functionality
- Added 2026-10-10: https://developer.apple.com/programs/ios/university/ , https://developer.apple.com/help/account/membership/D-U-N-S/ , https://developer.apple.com/distribute/app-review/ , https://developer.apple.com/xcode-cloud/ , https://developer.apple.com/news/upcoming-requirements/ , https://www.scaleway.com/en/mac-mini-m2/ (full list in `docs/APPSTORE-SUBMIT.md`)
