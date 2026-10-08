# App Store release plan (unofficial UChicago shuttle tracker)

Researched 2026-10-07. Items marked (est.) are not verified from a first-party page, so re-check before paying.

## 1. Cost estimate

| Item | Low | Likely | High | Notes / source |
|---|---|---|---|---|
| Apple Developer Program (individual) | $99 | $99 | $99 | Yearly. No separate "student" tier. https://developer.apple.com/programs/enroll/ |
| Org enrollment / D-U-N-S | $0 | $0 | $0 | Org needs a legal entity (LLC fees vary, est. $50-300 if you form one) plus a free D-U-N-S, which can take weeks. Not needed for an individual account. |
| Fee waiver | $0 | n/a | n/a | Only for nonprofit, accredited school or government legal entities, free apps only, not individuals. An unofficial app by a student will not qualify unless it is run through a registered nonprofit. https://developer.apple.com/help/account/membership/fee-waivers/ |
| Mac + Xcode | $0 | $0-30 | $599 | Low: borrow a Mac or use free CI. Likely: cloud Mac rental by the hour (MacinCloud-type, est. about $1/hr or $30/mo). High: buy a Mac mini (est. $599). Xcode is free. |
| CI (Codemagic / GitHub Actions) | $0 | $0 | $50 | Codemagic gives individuals 500 free macOS M2 min/month; pay-as-you-go is about $0.095/min (3rd-party, unverified). GitHub Actions macOS is $0.062/min on private repos, free on public repos. https://docs.codemagic.io/billing/pricing/ , https://docs.github.com/en/billing/reference/actions-runner-pricing |
| Proxy hosting (small) | $0 | $60 | $120 | Free tiers (Cloudflare Workers, Fly, Render) vs about $5-10/mo VPS (est.). |
| Domain | $0 | $12 | $20 | Optional. Low uses a github.io or workers.dev URL (est.). |
| Privacy policy / support page hosting | $0 | $0 | $0 | GitHub Pages. Apple requires a policy URL. |
| Push notifications (APNs) | $0 | $0 | $10 | APNs itself is free. You need a server to send; the proxy can do it (also drives Live Activity push-to-update). Time Sensitive notification entitlement is free. High covers a paid push relay. |
| **Year 1 total** | **~$99** | **~$170-200** | **~$900** | High includes buying a Mac. |
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
- Passio data: the feed is public but unlicensed for redistribution as far as I found. Passio's terms or the university's transportation office may object, and 5.2.3 / 5.2.1 let Apple pull an app on a rights complaint. Mitigation: email UChicago Campus Transportation and Passio for written permission, cache politely through your proxy and rate-limit, show attribution, and keep a takedown plan. Treat this as the biggest non-technical risk.
- Privacy nutrition label: if location is used only on-device and nothing is sent to your server, declare "Data Not Collected". If the proxy logs IPs or you send push tokens, declare Identifiers and Diagnostics as needed. Also provide a privacy policy URL, and a privacy manifest if you use any SDK or API that Apple requires one for.
- TestFlight steps: enroll, create the App ID and the App Store Connect record, build and upload via Xcode or CI (signing certificates and provisioning), add internal testers (up to 100, no review), then add external testers (the first build needs a short Beta App Review, usually about a day). Builds expire after 90 days.

### Timeline (realistic)
| Phase | Duration |
|---|---|
| Enrollment (individual; org with D-U-N-S adds 1-4 weeks) | 1-3 days |
| Capacitor wrap + location, notifications, widget | 2-4 weeks part-time |
| TestFlight beta | 1-2 weeks |
| Permission outreach to Passio / UChicago (runs in parallel) | 2-6 weeks |
| App Review (first submit, often 1-3 rounds) | 1-7 days per round |
| **Total** | **about 6-10 weeks** |

## 3. Recommendation

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
